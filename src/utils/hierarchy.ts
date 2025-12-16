// Hierarchy view utilities for building file relationship trees
import { HRCFile } from '../hrcfile';
import { RSDFile } from '../rsdfile';
import { SkeletonFile } from '../skeleton';
import { isBattleSkeletonFile } from './fileTypes';
import type { LGP } from '../lgp';

export interface HierarchyNode {
  filename: string;
  tocIndex: number;
  filesize: number;
  children: HierarchyNode[];
}

export interface FlatHierarchyItem {
  filename: string;
  tocIndex: number;
  displayIndex: number;
  filesize: number;
  depth: number;
  hasChildren: boolean;
  childCount: number;
  folderPath: string;
}

export interface BuildProgress {
  phase: 'hrc' | 'rsd' | 'skeleton' | 'building';
  current: number;
  total: number;
  message: string;
}

export type ProgressCallback = (progress: BuildProgress) => void;

// Detect if archive uses battle naming conventions (4-letter files with *aa skeletons)
export function isBattleArchive(filenames: string[]): boolean {
  const battlePattern = /^[a-z]{4}$/i;
  const battleFiles = filenames.filter(f => battlePattern.test(f));
  if (battleFiles.length < 10) return false;

  const hasSkeletons = battleFiles.some(f => isBattleSkeletonFile(f));
  return hasSkeletons;
}

// Helper to yield to the main thread properly
const yieldToMain = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => resolve());
  } else {
    setTimeout(resolve, 0);
  }
});

// Build hierarchy for field archives (HRC → RSD → P/TEX)
export async function buildFieldHierarchy(lgp: LGP, onProgress?: ProgressCallback): Promise<HierarchyNode[]> {
  const toc = lgp.archive.toc;
  const fileMap = new Map(
    toc.map((e, i) => [e.filename.toLowerCase(), { ...e, tocIndex: i }])
  );

  // Track which files are referenced (to find orphans)
  const referenced = new Set<string>();

  // Step 1: Find and parse all HRC files
  const hrcFiles = toc.filter(e => e.filename.toLowerCase().endsWith('.hrc'));
  const parsedHRCs = new Map<string, { hrc: HRCFile; entry: typeof toc[0] & { tocIndex: number } }>();

  for (let i = 0; i < hrcFiles.length; i++) {
    const entry = hrcFiles[i];
    try {
      const data = lgp.getFile(entry.filename);
      if (data) {
        const tocEntry = fileMap.get(entry.filename.toLowerCase())!;
        parsedHRCs.set(entry.filename.toLowerCase(), {
          hrc: new HRCFile(data),
          entry: tocEntry,
        });
      }
    } catch { /* skip invalid files */ }

    // Yield to main thread every 20 files to keep UI responsive
    if ((i + 1) % 20 === 0 || i === hrcFiles.length - 1) {
      onProgress?.({
        phase: 'hrc',
        current: i + 1,
        total: hrcFiles.length,
        message: `Parsing HRC files (${i + 1}/${hrcFiles.length})`,
      });
      await yieldToMain();
    }
  }

  // Step 2: Find and parse all RSD files
  const rsdFiles = toc.filter(e => e.filename.toLowerCase().endsWith('.rsd'));
  const parsedRSDs = new Map<string, { rsd: RSDFile; entry: typeof toc[0] & { tocIndex: number } }>();

  for (let i = 0; i < rsdFiles.length; i++) {
    const entry = rsdFiles[i];
    try {
      const data = lgp.getFile(entry.filename);
      if (data) {
        const tocEntry = fileMap.get(entry.filename.toLowerCase())!;
        parsedRSDs.set(entry.filename.toLowerCase(), {
          rsd: new RSDFile(data),
          entry: tocEntry,
        });
      }
    } catch { /* skip invalid files */ }

    // Yield to main thread every 20 files to keep UI responsive
    if ((i + 1) % 20 === 0 || i === rsdFiles.length - 1) {
      onProgress?.({
        phase: 'rsd',
        current: i + 1,
        total: rsdFiles.length,
        message: `Parsing RSD files (${i + 1}/${rsdFiles.length})`,
      });
      await yieldToMain();
    }
  }

  onProgress?.({
    phase: 'building',
    current: 0,
    total: 1,
    message: 'Building hierarchy tree...',
  });

  // Step 3: Build RSD → P/TEX mappings
  const rsdToChildren = new Map<string, HierarchyNode[]>();

  for (const [filename, { rsd, entry }] of parsedRSDs) {
    const children: HierarchyNode[] = [];

    // Add P model
    const pModel = rsd.getPModelFilename();
    if (pModel) {
      const pEntry = fileMap.get(pModel.toLowerCase());
      if (pEntry) {
        referenced.add(pModel.toLowerCase());
        children.push({
          filename: pEntry.filename,
          tocIndex: pEntry.tocIndex,
          filesize: pEntry.filesize,
          children: [],
        });
      }
    }

    // Add textures
    for (const tex of rsd.getTextureFilenames()) {
      const texEntry = fileMap.get(tex.toLowerCase());
      if (texEntry) {
        referenced.add(tex.toLowerCase());
        children.push({
          filename: texEntry.filename,
          tocIndex: texEntry.tocIndex,
          filesize: texEntry.filesize,
          children: [],
        });
      }
    }

    rsdToChildren.set(filename, children);
  }

  // Step 4: Build HRC nodes with RSD children
  const hrcNodes: HierarchyNode[] = [];
  const rsdReferencedByHRC = new Set<string>();

  for (const [filename, { hrc, entry }] of parsedHRCs) {
    referenced.add(filename);

    const node: HierarchyNode = {
      filename: entry.filename,
      tocIndex: entry.tocIndex,
      filesize: entry.filesize,
      children: [],
    };

    // Get RSD references from bones
    for (const bone of hrc.data.bones) {
      for (const rsdName of bone.resources) {
        const rsdFilename = `${rsdName}.rsd`.toLowerCase();
        rsdReferencedByHRC.add(rsdFilename);
        referenced.add(rsdFilename);

        const rsdEntry = fileMap.get(rsdFilename);
        if (rsdEntry) {
          // Clone children so same RSD can appear under multiple HRCs
          const rsdChildren = rsdToChildren.get(rsdFilename) || [];
          node.children.push({
            filename: rsdEntry.filename,
            tocIndex: rsdEntry.tocIndex,
            filesize: rsdEntry.filesize,
            children: rsdChildren.map(c => ({ ...c, children: [] })),
          });
        }
      }
    }

    hrcNodes.push(node);
  }

  // Step 5: Find orphan RSDs (not referenced by any HRC)
  const orphanRsdNodes: HierarchyNode[] = [];
  for (const [filename, { entry }] of parsedRSDs) {
    if (!rsdReferencedByHRC.has(filename)) {
      const rsdChildren = rsdToChildren.get(filename) || [];
      orphanRsdNodes.push({
        filename: entry.filename,
        tocIndex: entry.tocIndex,
        filesize: entry.filesize,
        children: rsdChildren.map(c => ({ ...c, children: [] })),
      });
      referenced.add(filename);
    }
  }

  // Step 6: Find completely orphan files
  const orphanFiles: HierarchyNode[] = [];
  for (const [filename, entry] of fileMap) {
    if (!referenced.has(filename)) {
      orphanFiles.push({
        filename: entry.filename,
        tocIndex: entry.tocIndex,
        filesize: entry.filesize,
        children: [],
      });
    }
  }

  // Combine: HRCs, orphan RSDs, orphan files
  return [...hrcNodes, ...orphanRsdNodes, ...orphanFiles];
}

// Build hierarchy for battle archives (Skeleton → Models/Textures/Animations)
export async function buildBattleHierarchy(lgp: LGP, onProgress?: ProgressCallback): Promise<HierarchyNode[]> {
  const toc = lgp.archive.toc;
  const fileMap = new Map(
    toc.map((e, i) => [e.filename.toLowerCase(), { ...e, tocIndex: i }])
  );

  const referenced = new Set<string>();
  const skeletonNodes: HierarchyNode[] = [];

  // Find all skeleton files (*aa pattern)
  const skeletonFiles = toc.filter(e => isBattleSkeletonFile(e.filename));

  for (let i = 0; i < skeletonFiles.length; i++) {
    const entry = skeletonFiles[i];
    try {
      const data = lgp.getFile(entry.filename);
      if (!data) continue;

      const skeleton = new SkeletonFile(data);
      const baseName = entry.filename.slice(0, 2);
      const relatedFiles = skeleton.getRelatedFiles(baseName);
      const tocEntry = fileMap.get(entry.filename.toLowerCase())!;

      referenced.add(entry.filename.toLowerCase());

      const node: HierarchyNode = {
        filename: tocEntry.filename,
        tocIndex: tocEntry.tocIndex,
        filesize: tocEntry.filesize,
        children: [],
      };

      // Add related files as children
      for (const related of relatedFiles) {
        const relatedFilename = related.name.toLowerCase();
        const relatedEntry = fileMap.get(relatedFilename);

        if (relatedEntry) {
          referenced.add(relatedFilename);
          node.children.push({
            filename: relatedEntry.filename,
            tocIndex: relatedEntry.tocIndex,
            filesize: relatedEntry.filesize,
            children: [],
          });
        }
      }

      skeletonNodes.push(node);
    } catch { /* skip invalid files */ }

    // Yield to main thread every 20 files to keep UI responsive
    if ((i + 1) % 20 === 0 || i === skeletonFiles.length - 1) {
      onProgress?.({
        phase: 'skeleton',
        current: i + 1,
        total: skeletonFiles.length,
        message: `Parsing skeleton files (${i + 1}/${skeletonFiles.length})`,
      });
      await yieldToMain();
    }
  }

  onProgress?.({
    phase: 'building',
    current: 0,
    total: 1,
    message: 'Building hierarchy tree...',
  });

  // Find orphan files
  const orphanFiles: HierarchyNode[] = [];
  for (const [filename, entry] of fileMap) {
    if (!referenced.has(filename)) {
      orphanFiles.push({
        filename: entry.filename,
        tocIndex: entry.tocIndex,
        filesize: entry.filesize,
        children: [],
      });
    }
  }

  return [...skeletonNodes, ...orphanFiles];
}

// Build hierarchy (auto-detect archive type)
export async function buildHierarchy(lgp: LGP, onProgress?: ProgressCallback): Promise<HierarchyNode[]> {
  const filenames = lgp.archive.toc.map(e => e.filename);

  if (isBattleArchive(filenames)) {
    return buildBattleHierarchy(lgp, onProgress);
  }
  return buildFieldHierarchy(lgp, onProgress);
}

// Flatten tree for virtual scrolling
export function flattenHierarchy(
  nodes: HierarchyNode[],
  expandedNodes: Set<number>
): FlatHierarchyItem[] {
  const result: FlatHierarchyItem[] = [];

  const traverse = (nodes: HierarchyNode[], depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedNodes.has(node.tocIndex);

      result.push({
        filename: node.filename,
        tocIndex: node.tocIndex,
        displayIndex: node.tocIndex + 1,
        filesize: node.filesize,
        depth,
        hasChildren,
        childCount: node.children.length,
        folderPath: '',
      });

      // Only traverse children if expanded
      if (hasChildren && isExpanded) {
        traverse(node.children, depth + 1);
      }
    }
  };

  traverse(nodes, 0);
  return result;
}

// Get all parent tocIndices (for initializing expanded state)
export function getAllParentIndices(nodes: HierarchyNode[]): Set<number> {
  const parents = new Set<number>();

  const traverse = (nodes: HierarchyNode[]) => {
    for (const node of nodes) {
      if (node.children.length > 0) {
        parents.add(node.tocIndex);
        traverse(node.children);
      }
    }
  };

  traverse(nodes);
  return parents;
}

// Filter hierarchy by search query, keeping ancestors of matches
export function filterHierarchyBySearch(
  items: FlatHierarchyItem[],
  query: string,
  nodes: HierarchyNode[]
): { items: FlatHierarchyItem[]; expandedNodes: Set<number> } {
  const queryLower = query.toLowerCase();
  const matchingIndices = new Set<number>();
  const ancestorIndices = new Set<number>();

  // Find all matching nodes and their ancestors
  const findMatches = (nodes: HierarchyNode[], ancestors: number[]) => {
    for (const node of nodes) {
      const currentAncestors = [...ancestors];

      if (node.filename.toLowerCase().includes(queryLower)) {
        matchingIndices.add(node.tocIndex);
        // Mark all ancestors
        for (const ancestorIdx of currentAncestors) {
          ancestorIndices.add(ancestorIdx);
        }
      }

      if (node.children.length > 0) {
        findMatches(node.children, [...currentAncestors, node.tocIndex]);
      }
    }
  };

  findMatches(nodes, []);

  // Items to show: matching items + their ancestors
  const visibleIndices = new Set([...matchingIndices, ...ancestorIndices]);

  // Ancestors should be expanded
  const expandedNodes = ancestorIndices;

  // Filter and re-flatten with proper expansion
  const filteredItems = items.filter(item => visibleIndices.has(item.tocIndex));

  return { items: filteredItems, expandedNodes };
}
