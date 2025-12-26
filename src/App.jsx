import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { LGP } from './lgp.ts';
import { Toolbar } from './components/Toolbar.jsx';
import { FileList } from './components/FileList.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { QuickLook } from './components/QuickLook.jsx';
import { formatTotalSize, getFileType, parseRSDTextureRefs } from './utils/fileTypes.ts';
import { usePersistedState } from './utils/settings.ts';
import { buildHierarchy, flattenHierarchy, getAllParentIndices, filterHierarchyBySearch } from './utils/hierarchy.ts';
import { Analytics } from "@vercel/analytics/react";
import {
  openFile,
  saveFile,
  extractSingleFile,
  extractMultipleFiles,
  openFileForReplace,
  openFilesForAdd,
} from './utils/fileService.ts';
import charNames from './assets/char-names.json';
import battleNames from './assets/battle-names.json';
import './App.css';

// Get display name for a file based on archive type
function getDisplayName(filename, archiveType) {
  if (!archiveType) return null;
  const baseName = filename.toLowerCase().replace(/\.[^.]+$/, '');
  if (baseName.length !== 4) return null;
  if (archiveType === 'char') return charNames[baseName] || null;
  if (archiveType === 'battle') return battleNames[baseName] || null;
  return null;
}

function App() {
  const [lgp, setLgp] = useState(null);
  const [archiveVersion, setArchiveVersion] = useState(0);
  const [archiveName, setArchiveName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [status, setStatus] = useState('Ready');
  const [searchQuery, setSearchQuery] = useState('');
  const [quickLookFile, setQuickLookFile] = useState(null);
  const [previewMode, setPreviewMode] = useState('hidden'); // 'hidden' | 'modal' | 'docked'
  const [isDragging, setIsDragging] = useState(false);
  const [sortColumn, setSortColumn] = useState('index');
  const [sortDirection, setSortDirection] = useState('asc');
  const [previewLayout, setPreviewLayout] = usePersistedState('previewLayout');
  const [viewMode, setViewMode] = usePersistedState('viewMode');
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [hierarchyState, setHierarchyState] = useState({
    status: 'idle', // 'idle' | 'building' | 'ready'
    tree: null,
    error: null,
  });
  const [hierarchyProgress, setHierarchyProgress] = useState(null);
  const hierarchyBuildRef = useRef(null); // Track current build to prevent race conditions
  const lastSelectedIndex = useRef(null);
  const dragCounter = useRef(0);

  const fileListRef = useRef(null);
  const searchInputRef = useRef(null);
  const pendingSelectionIndex = useRef(null);
  const typeaheadBuffer = useRef('');
  const typeaheadTimeout = useRef(null);
  const prevViewModeStateRef = useRef({ viewMode: 'list', hierarchyStatus: 'idle' });
  const justLoadedHierarchyRef = useRef(false);
  const prevExpandedNodesRef = useRef(null);

  // Track window width for responsive layout
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Force modal mode on narrow screens
  const effectivePreviewMode = previewMode === 'docked' && windowWidth < 900 ? 'modal' : previewMode;

  // Determine archive type for display name lookups
  const archiveType = useMemo(() => {
    const name = archiveName.toLowerCase();
    if (name === 'char.lgp') return 'char';
    if (name === 'battle.lgp') return 'battle';
    return null;
  }, [archiveName]);

  // Build folder structure and file list from archive
  // archiveVersion is used to trigger re-computation when archive is modified
  const { folders, files, filesByTocIndex, totalSize } = useMemo(() => {
    if (!lgp) return { folders: new Map(), files: [], filesByTocIndex: new Map(), totalSize: 0 };
    void archiveVersion; // Use archiveVersion to trigger re-computation

    const folderMap = new Map();
    const fileList = [];
    let total = 0;

    // Build path lookup from pathGroups
    const pathLookup = new Map();
    lgp.archive.pathGroups.forEach((group) => {
      group.paths.forEach(pathEntry => {
        pathLookup.set(pathEntry.tocIndex, pathEntry.folderName);
      });
    });

    lgp.archive.toc.forEach((entry, index) => {
      const folderPath = entry.pathIndex > 0 
        ? pathLookup.get(index) || '' 
        : '';
      
      total += entry.filesize;

      // Track folders
      if (folderPath) {
        const parts = folderPath.split('/').filter(Boolean);
        let path = '';
        for (const part of parts) {
          const parentPath = path;
          path = path ? `${path}/${part}` : part;
          
          if (!folderMap.has(path)) {
            folderMap.set(path, { 
              name: part, 
              parentPath, 
              fullPath: path,
              fileCount: 0 
            });
          }
          // Increment file count for this folder and all parent folders
          folderMap.get(path).fileCount++;
        }
      }

      fileList.push({
        ...entry,
        tocIndex: index,
        displayIndex: index + 1,
        folderPath,
      });
    });

    // Create a lookup map for O(1) access by tocIndex
    const filesByTocIndex = new Map();
    for (const file of fileList) {
      filesByTocIndex.set(file.tocIndex, file);
    }

    return { folders: folderMap, files: fileList, filesByTocIndex, totalSize: total };
  }, [lgp, archiveVersion]);

  // Build hierarchy when switching to hierarchy view
  // Note: We separate the "start build" logic from the effect to avoid cleanup issues
  const startHierarchyBuild = useCallback(() => {
    if (!lgp || hierarchyBuildRef.current) return; // Already building

    const buildId = Date.now();
    hierarchyBuildRef.current = buildId;

    setHierarchyState({ status: 'building', tree: null, error: null });
    setHierarchyProgress(null);

    const onProgress = (progress) => {
      if (hierarchyBuildRef.current !== buildId) return;
      setHierarchyProgress(progress);
    };

    buildHierarchy(lgp, onProgress).then(tree => {
      if (hierarchyBuildRef.current !== buildId) return;
      hierarchyBuildRef.current = null;
      setHierarchyState({ status: 'ready', tree, error: null });
      setHierarchyProgress(null);
      justLoadedHierarchyRef.current = true;
      // Start with all nodes collapsed
      setExpandedNodes(new Set());
    }).catch(err => {
      if (hierarchyBuildRef.current !== buildId) return;
      hierarchyBuildRef.current = null;
      setHierarchyState({ status: 'idle', tree: null, error: err.message });
      setHierarchyProgress(null);
    });
  }, [lgp]);

  // Trigger hierarchy build when switching to hierarchy view
  useEffect(() => {
    if (viewMode === 'hierarchy' && hierarchyState.status === 'idle' && lgp) {
      startHierarchyBuild();
    }
  }, [viewMode, hierarchyState.status, lgp, startHierarchyBuild]);

  // Reset hierarchy state when archive changes
  const prevLgpRef = useRef(lgp);
  useEffect(() => {
    if (prevLgpRef.current !== lgp) {
      prevLgpRef.current = lgp;
      hierarchyBuildRef.current = null; // Cancel any in-progress build
      setHierarchyState({ status: 'idle', tree: null, error: null });
      setHierarchyProgress(null);
      setExpandedNodes(new Set());
    }
  }, [lgp]);

  // Flatten hierarchy based on expanded state
  const hierarchyItems = useMemo(() => {
    if (viewMode !== 'hierarchy' || !hierarchyState.tree) return null;
    return flattenHierarchy(hierarchyState.tree, expandedNodes);
  }, [viewMode, hierarchyState.tree, expandedNodes]);

  // Filter files based on current path and search query
  const displayFiles = useMemo(() => {
    // Use hierarchy items when in hierarchy view
    if (viewMode === 'hierarchy' && hierarchyItems) {
      // Apply search filter (keeps parent nodes visible when children match)
      if (searchQuery && hierarchyState.tree) {
        const { items } = filterHierarchyBySearch(hierarchyItems, searchQuery, hierarchyState.tree, archiveType);
        return items;
      }

      // Return items as-is (hierarchy is already ordered by parent-child relationships)
      return hierarchyItems;
    }

    // List view logic (existing)
    let filtered = files;

    // Filter by current path
    if (currentPath) {
      filtered = filtered.filter(f => f.folderPath === currentPath);
    } else {
      filtered = filtered.filter(f => !f.folderPath);
    }

    // Get subfolders at current level
    const subfolders = [];
    for (const [, folder] of folders) {
      if (folder.parentPath === currentPath) {
        subfolders.push({
          isFolder: true,
          name: folder.name,
          folderPath: folder.fullPath,
          fileCount: folder.fileCount,
        });
      }
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(f => {
        if (f.filename.toLowerCase().includes(query)) return true;
        // Also check display name for char.lgp and battle.lgp
        const displayName = getDisplayName(f.filename, archiveType);
        return displayName && displayName.toLowerCase().includes(query);
      });
      // Also filter folders by name when searching
      const filteredFolders = subfolders.filter(f =>
        f.name.toLowerCase().includes(query)
      );
      subfolders.length = 0;
      subfolders.push(...filteredFolders);
    }

    // Sort folders first by name
    subfolders.sort((a, b) => a.name.localeCompare(b.name));

    // Sort files
    const sortedFiles = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'index':
          cmp = a.tocIndex - b.tocIndex;
          break;
        case 'name':
          cmp = a.filename.localeCompare(b.filename);
          break;
        case 'size':
          cmp = a.filesize - b.filesize;
          break;
        case 'type': {
          const typeA = getFileType(a.filename);
          const typeB = getFileType(b.filename);
          cmp = typeA.localeCompare(typeB);
          // Secondary sort by name when types are equal
          if (cmp === 0) {
            cmp = a.filename.localeCompare(b.filename);
          }
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return [...subfolders, ...sortedFiles];
  }, [files, folders, currentPath, searchQuery, sortColumn, sortDirection, viewMode, hierarchyItems, hierarchyState.tree, archiveType]);

  const handleOpen = useCallback(async () => {
    const result = await openFile([{ name: 'LGP Archive', extensions: ['lgp'] }]);
    if (!result) return;

    setStatus(`Loading ${result.name}...`);
    try {
      const archive = new LGP(result.data);
      setLgp(archive);
      setArchiveName(result.name);
      setCurrentPath('');
      setSelectedIndices(new Set());
      setSearchQuery('');
      setViewMode('list');
      setQuickLookFile(null);
      setPreviewMode('hidden');
      setStatus(`Loaded ${result.name}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }, [setViewMode]);

  const handleSave = useCallback(async () => {
    if (!lgp) return;

    setStatus('Saving archive...');
    try {
      const data = lgp.writeArchive();
      const success = await saveFile(data, {
        defaultName: archiveName || 'archive.lgp',
        filters: [{ name: 'LGP Archive', extensions: ['lgp'] }],
      });
      if (success) {
        setStatus('Archive saved');
      } else {
        setStatus('Save cancelled');
      }
    } catch (err) {
      setStatus(`Error saving: ${err.message}`);
    }
  }, [lgp, archiveName]);

  const handleExtract = useCallback(async () => {
    if (!lgp || selectedIndices.size === 0) return;

    const selectedFiles = files.filter(f => selectedIndices.has(f.tocIndex));

    if (selectedFiles.length === 1) {
      // Single file: download directly
      const file = selectedFiles[0];
      const data = lgp.getFile(file.filename);
      if (!data) {
        setStatus(`Error: Could not read ${file.filename}`);
        return;
      }

      const success = await extractSingleFile(data, file.filename);
      if (success) {
        setStatus(`Extracted ${file.filename}`);
      } else {
        setStatus('Extraction cancelled');
      }
    } else {
      // Multiple files: use folder picker (Tauri) or zip (web)
      setStatus(`Extracting ${selectedFiles.length} files...`);

      const filesToExtract = [];
      for (const file of selectedFiles) {
        const data = lgp.getFile(file.filename);
        if (data) {
          filesToExtract.push({ filename: file.filename, data });
        }
      }

      const success = await extractMultipleFiles(filesToExtract, archiveName);
      if (success) {
        setStatus(`Extracted ${filesToExtract.length} files`);
      } else {
        setStatus('Extraction cancelled');
      }
    }
  }, [lgp, files, selectedIndices, archiveName]);

  const handleReplace = useCallback(async () => {
    if (selectedIndices.size !== 1) {
      setStatus('Select exactly one file to replace');
      return;
    }
    if (!lgp) return;

    const selectedIndex = [...selectedIndices][0];
    const targetFile = files.find(f => f.tocIndex === selectedIndex);
    if (!targetFile) return;

    const result = await openFileForReplace();
    if (!result) return;

    try {
      lgp.setFile(targetFile.filename, result.data);
      setStatus(`Replaced ${targetFile.filename} with ${result.name}`);
      setArchiveVersion(v => v + 1);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }, [lgp, files, selectedIndices]);

  const handleAdd = useCallback(async () => {
    if (!lgp) return;

    const inputFiles = await openFilesForAdd();
    if (!inputFiles || inputFiles.length === 0) return;

    setStatus(`Inserting ${inputFiles.length} file(s)...`);
    let inserted = 0;
    let skipped = 0;

    for (const file of inputFiles) {
      try {
        if (lgp.insertFile(file.name, file.data)) {
          inserted++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Error inserting ${file.name}:`, err);
      }
    }

    const skippedMsg = skipped > 0 ? ` (${skipped} skipped - already exist)` : '';
    setStatus(`Inserted ${inserted} file(s)${skippedMsg}`);
    setArchiveVersion(v => v + 1);
  }, [lgp]);

  const handleRemove = useCallback(() => {
    if (!lgp || selectedIndices.size === 0) return;
    
    // Get file items (non-folders) in display order
    const fileItems = displayFiles.filter(f => !f.isFolder);
    const selectedFiles = fileItems.filter(f => selectedIndices.has(f.tocIndex));
    
    if (selectedFiles.length === 0) return;
    
    // Find the position of the first selected file
    // After deletion, the file below will slide up to this position
    const firstSelectedIdx = Math.min(...selectedFiles.map(f => fileItems.indexOf(f)));
    
    // Store the target index for selection after re-render
    pendingSelectionIndex.current = firstSelectedIdx;
    
    for (const file of selectedFiles) {
      lgp.removeFile(file.filename);
    }
    
    // Clear selection temporarily - will be restored by useEffect after re-render
    setSelectedIndices(new Set());
    setStatus(`Removed ${selectedFiles.length} file(s)`);
    setArchiveVersion(v => v + 1);
  }, [lgp, displayFiles, selectedIndices]);
  
  // Apply pending selection after archive changes and re-render
  useEffect(() => {
    if (pendingSelectionIndex.current !== null) {
      const targetIndex = pendingSelectionIndex.current;
      pendingSelectionIndex.current = null;
      
      const fileItems = displayFiles.filter(f => !f.isFolder);
      if (fileItems.length > 0 && targetIndex >= 0) {
        const index = Math.min(targetIndex, fileItems.length - 1);
        const targetFile = fileItems[index];
        setSelectedIndices(new Set([targetFile.tocIndex]));
        lastSelectedIndex.current = targetFile.tocIndex;
      }
    }
  }, [archiveVersion, displayFiles]);

  const handleSelect = useCallback((index, modifiers) => {
    setSelectedIndices(prev => {
      const next = new Set();

      if (modifiers.shift && lastSelectedIndex.current !== null) {
        // Range select - select from anchor to clicked item
        const visibleIndices = displayFiles
          .filter(f => !f.isFolder)
          .map(f => f.tocIndex);

        const startPos = visibleIndices.indexOf(lastSelectedIndex.current);
        const endPos = visibleIndices.indexOf(index);

        if (startPos !== -1 && endPos !== -1) {
          const rangeStart = Math.min(startPos, endPos);
          const rangeEnd = Math.max(startPos, endPos);
          for (let i = rangeStart; i <= rangeEnd; i++) {
            next.add(visibleIndices[i]);
          }
        }
        // Don't update lastSelectedIndex on shift-click (keep anchor)
        return next;
      } else if (modifiers.ctrl) {
        // Toggle select - keep existing and toggle clicked
        for (const i of prev) next.add(i);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
      } else {
        // Single select
        next.add(index);
      }

      lastSelectedIndex.current = index;
      return next;
    });
  }, [displayFiles]);

  const handleNavigate = useCallback((path) => {
    if (path === '..') {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      setCurrentPath(parts.join('/'));
    } else {
      setCurrentPath(path);
    }
    setSelectedIndices(new Set());
  }, [currentPath]);

  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query);
    // Don't clear selection - we'll scroll to the selected file if it's still visible
  }, []);

  const handleSort = useCallback((column) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  const openQuickLookForFile = useCallback((file, mode) => {
    if (!lgp || !file) return;

    const data = lgp.getFile(file.filename);
    if (!data) {
      setStatus(`Error: Could not read ${file.filename}`);
      return;
    }

    const targetMode = mode || previewLayout;
    setQuickLookFile({ filename: file.filename, data });
    setPreviewMode(targetMode);
    setPreviewLayout(targetMode);
  }, [lgp, previewLayout, setPreviewLayout]);

  // Find which .rsd files reference a given texture file
  const handleFindReferences = useCallback((textureFilename) => {
    if (!lgp) return;

    // Get basename without extension for matching
    // .rsd files often reference .TIM but actual files are .TEX
    const lastDot = textureFilename.lastIndexOf('.');
    const baseName = lastDot > 0 ? textureFilename.slice(0, lastDot) : textureFilename;
    const baseNameLower = baseName.toLowerCase();

    // Get all .rsd files from the archive
    const rsdFiles = lgp.archive.toc.filter(entry =>
      entry.filename.toLowerCase().endsWith('.rsd')
    );

    if (rsdFiles.length === 0) {
      setStatus(`No .rsd files found in archive`);
      return;
    }

    setStatus(`Searching ${rsdFiles.length} .rsd files...`);

    // Search for references - use indexOf for fast initial filtering
    const references = [];
    const decoder = new TextDecoder('utf-8');

    for (const entry of rsdFiles) {
      const data = lgp.getFile(entry.filename);
      if (!data) continue;

      // Convert to text and do fast case-insensitive search
      const text = decoder.decode(data);
      if (!text.toLowerCase().includes(baseNameLower)) continue;

      // Parse properly to confirm it's actually a TEX reference
      const texRefs = parseRSDTextureRefs(text);
      for (const ref of texRefs) {
        const refLastDot = ref.lastIndexOf('.');
        const refBase = refLastDot > 0 ? ref.slice(0, refLastDot) : ref;
        if (refBase.toLowerCase() === baseNameLower) {
          references.push(entry.filename);
          break;
        }
      }
    }

    if (references.length === 0) {
      setStatus(`No references found for ${textureFilename}`);
    } else if (references.length === 1) {
      setStatus({ message: 'Found reference:', references });
    } else {
      setStatus({ message: `Found ${references.length} references:`, references });
    }
  }, [lgp]);

  // Keep a ref to current displayFiles for use in callbacks
  const displayFilesRef = useRef(displayFiles);
  useEffect(() => {
    displayFilesRef.current = displayFiles;
  }, [displayFiles]);

  // Scroll to selected file when switching view modes
  useEffect(() => {
    const prev = prevViewModeStateRef.current;
    const current = { viewMode, hierarchyStatus: hierarchyState.status };
    prevViewModeStateRef.current = current;

    // Detect completed view mode switch
    let shouldScroll = false;

    // Switched to list view
    if (prev.viewMode !== 'list' && current.viewMode === 'list') {
      shouldScroll = true;
    }

    // Switched to hierarchy AND hierarchy is now ready
    if (current.viewMode === 'hierarchy' && current.hierarchyStatus === 'ready') {
      if (prev.viewMode !== 'hierarchy' || prev.hierarchyStatus !== 'ready') {
        shouldScroll = true;
      }
    }

    if (!shouldScroll) return;

    // Scroll after DOM update
    setTimeout(() => {
      if (!fileListRef.current) return;

      const currentDisplayFiles = displayFilesRef.current;
      if (selectedIndices.size > 0) {
        const selectedTocIndex = [...selectedIndices][0];
        const displayIndex = currentDisplayFiles.findIndex(f => f.tocIndex === selectedTocIndex);
        if (displayIndex >= 0) {
          fileListRef.current.scrollToIndex(displayIndex);
        } else {
          fileListRef.current.scrollToIndex(0);
        }
      } else {
        fileListRef.current.scrollToIndex(0);
      }
    }, 0);
  }, [viewMode, hierarchyState.status, selectedIndices]);

  // Scroll to selected file when expanding/collapsing nodes in hierarchy view
  useEffect(() => {
    // Only in hierarchy view
    if (viewMode !== 'hierarchy') {
      prevExpandedNodesRef.current = expandedNodes;
      return;
    }

    // Skip if expandedNodes didn't change
    if (prevExpandedNodesRef.current === expandedNodes) return;
    prevExpandedNodesRef.current = expandedNodes;

    // Skip if this is the initial population after hierarchy load
    // (the view mode switch effect handles that case)
    if (justLoadedHierarchyRef.current) {
      justLoadedHierarchyRef.current = false;
      return;
    }

    // Scroll to selected file after DOM update
    setTimeout(() => {
      if (!fileListRef.current) return;

      const currentDisplayFiles = displayFilesRef.current;
      if (selectedIndices.size > 0) {
        const selectedTocIndex = [...selectedIndices][0];
        const displayIndex = currentDisplayFiles.findIndex(f => f.tocIndex === selectedTocIndex);
        if (displayIndex >= 0) {
          fileListRef.current.scrollToIndex(displayIndex);
        } else {
          // Selected file might be hidden (collapsed parent), scroll to top
          fileListRef.current.scrollToIndex(0);
        }
      } else {
        fileListRef.current.scrollToIndex(0);
      }
    }, 0);
  }, [viewMode, expandedNodes, selectedIndices]);

  // Scroll to selected file when search query changes
  const prevSearchQueryRef = useRef(searchQuery);
  useEffect(() => {
    const prevQuery = prevSearchQueryRef.current;
    prevSearchQueryRef.current = searchQuery;

    // Skip initial render
    if (prevQuery === searchQuery) return;

    // Scroll to selected file after DOM update
    setTimeout(() => {
      if (!fileListRef.current) return;

      const currentDisplayFiles = displayFilesRef.current;
      if (selectedIndices.size > 0) {
        const selectedTocIndex = [...selectedIndices][0];
        const displayIndex = currentDisplayFiles.findIndex(f => f.tocIndex === selectedTocIndex);
        if (displayIndex >= 0) {
          fileListRef.current.scrollToIndex(displayIndex);
        }
        // If selected file is not in filtered results, don't scroll (keep current position)
      }
    }, 0);
  }, [searchQuery, selectedIndices]);

  // Select a file by filename (used when clicking references in status bar)
  const handleSelectFile = useCallback((filename) => {
    if (!lgp) return;

    // Find the file in the archive
    const file = files.find(f => f.filename.toLowerCase() === filename.toLowerCase());
    if (!file) {
      setStatus(`File not found: ${filename}`);
      return;
    }

    // Clear search query if it would filter out the file
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesFilename = file.filename.toLowerCase().includes(query);
      const displayName = getDisplayName(file.filename, archiveType);
      const matchesDisplayName = displayName && displayName.toLowerCase().includes(query);
      if (!matchesFilename && !matchesDisplayName) {
        setSearchQuery('');
      }
    }

    // Navigate to root if we're in a subfolder (rsd files are typically at root)
    if (currentPath && !file.folderPath) {
      setCurrentPath('');
    } else if (file.folderPath && file.folderPath !== currentPath) {
      setCurrentPath(file.folderPath);
    }

    // Select the file
    setSelectedIndices(new Set([file.tocIndex]));
    lastSelectedIndex.current = file.tocIndex;

    // Scroll to file after state updates complete
    const tocIndex = file.tocIndex;
    setTimeout(() => {
      const currentDisplayFiles = displayFilesRef.current;
      const displayIndex = currentDisplayFiles.findIndex(f => f.tocIndex === tocIndex);
      if (displayIndex >= 0 && fileListRef.current) {
        fileListRef.current.scrollToIndex(displayIndex);
      }
    }, 100);
  }, [lgp, files, searchQuery, currentPath, archiveType]);

  const openQuickLook = useCallback(() => {
    if (!lgp || selectedIndices.size !== 1) return;
    
    const selectedIndex = [...selectedIndices][0];
    const file = files.find(f => f.tocIndex === selectedIndex);
    if (!file) return;
    
    openQuickLookForFile(file);
  }, [lgp, selectedIndices, files, openQuickLookForFile]);

  const closeQuickLook = useCallback(() => {
    setQuickLookFile(null);
    setPreviewMode('hidden');
  }, []);

  const dockPreview = useCallback(() => {
    setPreviewMode('docked');
    setPreviewLayout('docked');
  }, [setPreviewLayout]);

  const undockPreview = useCallback(() => {
    setPreviewMode('modal');
    setPreviewLayout('modal');
  }, [setPreviewLayout]);

  // Auto-update preview when selection changes in docked mode
  useEffect(() => {
    if (effectivePreviewMode !== 'docked' || !lgp) return;

    // Get the last selected file
    if (selectedIndices.size === 0) return;

    const selectedIndex = [...selectedIndices].pop();
    const file = filesByTocIndex.get(selectedIndex);
    if (!file) return;

    // Don't reload if it's the same file
    if (quickLookFile?.filename === file.filename) return;

    const data = lgp.getFile(file.filename);
    if (data) {
      // Defer the state update to avoid cascading renders
      queueMicrotask(() => {
        setQuickLookFile({ filename: file.filename, data });
      });
    }
  }, [effectivePreviewMode, selectedIndices, filesByTocIndex, lgp, quickLookFile?.filename]);

  // Keyboard handling for QuickLook and navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Don't trigger any navigation if QuickLook modal is open
      if (effectivePreviewMode === 'modal') return;

      // Space opens preview when hidden, but not when docked (QuickLook handles it)
      if (e.code === 'Space' && selectedIndices.size === 1 && effectivePreviewMode === 'hidden') {
        e.preventDefault();
        openQuickLook();
      }
      
      // Slash key or Cmd/Ctrl+F focuses search
      if ((e.key === '/' || (e.key === 'f' && (e.metaKey || e.ctrlKey))) && lgp) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Left/Right arrow for expand/collapse in hierarchy view
      if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && viewMode === 'hierarchy' && selectedIndices.size === 1) {
        const selectedTocIndex = [...selectedIndices][0];
        const selectedItem = displayFiles.find(f => f.tocIndex === selectedTocIndex);

        if (selectedItem?.hasChildren) {
          const isExpanded = expandedNodes.has(selectedTocIndex);

          if (e.code === 'ArrowLeft' && isExpanded) {
            e.preventDefault();
            setExpandedNodes(prev => {
              const next = new Set(prev);
              next.delete(selectedTocIndex);
              return next;
            });
            return;
          } else if (e.code === 'ArrowRight' && !isExpanded) {
            e.preventDefault();
            setExpandedNodes(prev => {
              const next = new Set(prev);
              next.add(selectedTocIndex);
              return next;
            });
            return;
          }
        }
      }

      // Arrow key and page navigation
      const navKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
      if (navKeys.includes(e.code) && lgp && displayFiles.length > 0) {
        e.preventDefault();
        
        // Get only files (not folders) from displayFiles
        const fileItems = displayFiles.filter(f => !f.isFolder);
        if (fileItems.length === 0) return;
        
        // Find current selection position (use last selected as anchor for shift)
        let currentIndex = -1;
        if (selectedIndices.size >= 1) {
          // For shift selection, find position of last selected item
          const selectedTocIndex = [...selectedIndices].pop();
          currentIndex = fileItems.findIndex(f => f.tocIndex === selectedTocIndex);
        }
        
        // Find anchor position for shift selection
        let anchorIndex = currentIndex;
        if (e.shiftKey && lastSelectedIndex.current !== null) {
          anchorIndex = fileItems.findIndex(f => f.tocIndex === lastSelectedIndex.current);
          if (anchorIndex === -1) anchorIndex = currentIndex;
        }
        
        let newIndex;
        const pageSize = fileListRef.current?.getPageSize() || 10;
        
        switch (e.code) {
          case 'ArrowUp':
            newIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
            break;
          case 'ArrowDown':
            newIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, fileItems.length - 1);
            break;
          case 'PageUp':
            newIndex = currentIndex <= 0 ? 0 : Math.max(0, currentIndex - pageSize);
            break;
          case 'PageDown':
            newIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + pageSize, fileItems.length - 1);
            break;
          case 'Home':
            newIndex = 0;
            break;
          case 'End':
            newIndex = fileItems.length - 1;
            break;
          default:
            return;
        }
        
        if (e.shiftKey && anchorIndex !== -1) {
          // Range select from anchor to new position
          const rangeStart = Math.min(anchorIndex, newIndex);
          const rangeEnd = Math.max(anchorIndex, newIndex);
          const newSelection = new Set();
          for (let i = rangeStart; i <= rangeEnd; i++) {
            newSelection.add(fileItems[i].tocIndex);
          }
          setSelectedIndices(newSelection);
          // Don't update lastSelectedIndex (keep anchor)
        } else {
          // Single select
          const newFile = fileItems[newIndex];
          setSelectedIndices(new Set([newFile.tocIndex]));
          lastSelectedIndex.current = newFile.tocIndex;
        }
        
        // Scroll to the new position
        const displayIndex = displayFiles.findIndex(f => f.tocIndex === fileItems[newIndex].tocIndex);
        if (displayIndex >= 0 && fileListRef.current) {
          fileListRef.current.scrollToIndex(displayIndex + (currentPath ? 1 : 0));
        }
        return;
      }
      
      // Type-ahead file selection
      if (lgp && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const char = e.key.toLowerCase();
        
        // Clear existing timeout and set new one
        if (typeaheadTimeout.current) {
          clearTimeout(typeaheadTimeout.current);
        }
        typeaheadTimeout.current = setTimeout(() => {
          typeaheadBuffer.current = '';
        }, 500);
        
        // Append character to buffer
        typeaheadBuffer.current += char;
        const searchStr = typeaheadBuffer.current;
        
        // Search for matching file
        const fileItems = displayFiles.filter(f => !f.isFolder);
        const matchIndex = fileItems.findIndex(f => 
          f.filename.toLowerCase().startsWith(searchStr)
        );
        
        if (matchIndex !== -1) {
          const matchedFile = fileItems[matchIndex];
          setSelectedIndices(new Set([matchedFile.tocIndex]));
          lastSelectedIndex.current = matchedFile.tocIndex;
          
          // Scroll to the matched file
          const displayIndex = displayFiles.findIndex(f => f.tocIndex === matchedFile.tocIndex);
          if (displayIndex >= 0 && fileListRef.current) {
            fileListRef.current.scrollToIndex(displayIndex + (currentPath ? 1 : 0));
          }
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndices, effectivePreviewMode, openQuickLook, lgp, displayFiles, currentPath, viewMode, expandedNodes]);

  // Drag & drop handlers
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    const file = droppedFiles[0];
    if (!file.name.toLowerCase().endsWith('.lgp')) {
      setStatus('Please drop an LGP file');
      return;
    }

    setStatus(`Loading ${file.name}...`);
    try {
      const buffer = await file.arrayBuffer();
      const archive = new LGP(buffer);
      setLgp(archive);
      setArchiveName(file.name);
      setCurrentPath('');
      setSelectedIndices(new Set());
      setSearchQuery('');
      setViewMode('list');
      setQuickLookFile(null);
      setPreviewMode('hidden');
      setStatus(`Loaded ${file.name}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }, [setViewMode]);

  // Build breadcrumb
  const breadcrumbParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
  <>
    <div 
      className="app"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <div className="drop-overlay-icon">📦</div>
            <div className="drop-overlay-text">Drop LGP file to open</div>
          </div>
        </div>
      )}
      <Toolbar
        ref={searchInputRef}
        onOpen={handleOpen}
        onSave={handleSave}
        onExtract={handleExtract}
        onReplace={handleReplace}
        onAdd={handleAdd}
        onRemove={handleRemove}
        hasArchive={!!lgp}
        hasSelection={selectedIndices.size > 0}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
      />
      
      <div className={`split-view ${effectivePreviewMode === 'docked' ? 'split-view-active' : ''}`}>
        <div className={`main-content ${archiveType ? 'has-display-name' : ''}`}>
          {lgp && (
            <div className="breadcrumb">
              <div className="breadcrumb-path">
                <span
                  className="breadcrumb-item"
                  onClick={() => { setCurrentPath(''); setSelectedIndices(new Set()); }}
                >
                  {archiveName}
                </span>
                {viewMode === 'list' && breadcrumbParts.map((part, i) => (
                  <span key={i}>
                    <span className="breadcrumb-separator">/</span>
                    <span
                      className="breadcrumb-item"
                      onClick={() => {
                        const newPath = breadcrumbParts.slice(0, i + 1).join('/');
                        setCurrentPath(newPath);
                        setSelectedIndices(new Set());
                      }}
                    >
                      {part}
                    </span>
                  </span>
                ))}
              </div>
              <div className="view-mode-toggle">
                {viewMode === 'hierarchy' && hierarchyState.status === 'ready' && (
                  <button
                    className="expand-collapse-btn"
                    onClick={() => {
                      if (expandedNodes.size > 0) {
                        setExpandedNodes(new Set());
                      } else {
                        setExpandedNodes(getAllParentIndices(hierarchyState.tree));
                      }
                    }}
                  >
                    {expandedNodes.size > 0 ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
                <button
                  className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => setViewMode('list')}
                  title="List view"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 3h12M1 7h12M1 11h12" />
                  </svg>
                </button>
                <button
                  className={`view-mode-btn ${viewMode === 'hierarchy' ? 'active' : ''}`}
                  onClick={() => setViewMode('hierarchy')}
                  title="Hierarchy view"
                >
                  <svg width="14" height="14" viewBox="-1 -1 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 2h5M4 2v4M4 6h4M4 6v4M4 10h4" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {lgp ? (
            <FileList
              ref={fileListRef}
              files={displayFiles}
              currentPath={currentPath}
              selectedIndices={selectedIndices}
              onSelect={handleSelect}
              onNavigate={handleNavigate}
              onDoubleClick={openQuickLookForFile}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSort={handleSort}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              expandedNodes={expandedNodes}
              onToggleExpand={(tocIndex) => {
                setExpandedNodes(prev => {
                  const next = new Set(prev);
                  if (next.has(tocIndex)) {
                    next.delete(tocIndex);
                  } else {
                    next.add(tocIndex);
                  }
                  return next;
                });
              }}
              hierarchyLoading={hierarchyState.status === 'building'}
              hierarchyProgress={hierarchyProgress}
              archiveName={archiveName}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📦</div>
              <div className="empty-state-text">Open or drag & drop an LGP archive</div>
            </div>
          )}
        </div>

        {effectivePreviewMode === 'docked' && quickLookFile && (
          <QuickLook
            filename={quickLookFile.filename}
            data={quickLookFile.data}
            onClose={closeQuickLook}
            onLoadFile={(name) => lgp?.getFile(name)}
            mode="docked"
            onUndock={undockPreview}
            onFindReferences={handleFindReferences}
          />
        )}
      </div>
      
      <StatusBar
        status={status}
        fileCount={lgp ? lgp.archive.toc.length : 0}
        totalSize={formatTotalSize(totalSize)}
        selectedCount={selectedIndices.size}
        onSelectFile={handleSelectFile}
      />
      
      
      {effectivePreviewMode === 'modal' && quickLookFile && (
        <QuickLook
          filename={quickLookFile.filename}
          data={quickLookFile.data}
          onClose={closeQuickLook}
          onLoadFile={(name) => lgp?.getFile(name)}
          mode="modal"
          onDock={windowWidth >= 900 ? dockPreview : undefined}
          onFindReferences={handleFindReferences}
        />
      )}
    </div>
    <Analytics />
  </>
  );
}

export default App;
