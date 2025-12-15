const extensionMap: Record<string, string> = {
  tex: 'TEX Image',
  tut: 'Tutorial Script',
  p: 'Model',
  hrc: 'Skeleton',
  rsd: 'Resource',
  a: 'Animation',
  da: 'Animation',
};

const filenamePatterns: [RegExp, string][] = [
  [/^[a-z0-9_]+$/i, 'Field'],
];

// 4-letter battle files: first 2 letters identify the model, last 2 determine type
function getBattleFileType(filename: string): string | null {
  if (!/^[a-z]{4}$/i.test(filename)) return null;
  
  const suffix = filename.slice(2, 4).toLowerCase();
  
  if (suffix === 'aa') return 'Battle Skeleton';
  if (suffix === 'ab') return 'Battle (unknown)';
  if (suffix >= 'ac' && suffix <= 'al') return 'TEX Image';
  if (suffix === 'da') return 'Battle Animation';
  if ((suffix >= 'am' && suffix <= 'az') || (suffix >= 'ba' && suffix <= 'bz')) return 'Battle Model';
  
  return null;
}

export function isBattleTexFile(filename: string): boolean {
  if (!/^[a-z]{4}$/i.test(filename)) return false;
  const suffix = filename.slice(2, 4).toLowerCase();
  return suffix >= 'ac' && suffix <= 'al';
}

export function isBattleSkeletonFile(filename: string): boolean {
  if (!/^[a-z]{4}$/i.test(filename)) return false;
  const suffix = filename.slice(2, 4).toLowerCase();
  return suffix === 'aa';
}

export function isHRCFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.hrc');
}

export function isRSDFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.rsd');
}

export function isPModelFile(filename: string): boolean {
  const lower = filename.toLowerCase();

  // Check for .p extension
  if (lower.endsWith('.p')) return true;

  // Check for .p00 through .p99 extensions (used in magic.lgp)
  if (/\.p\d{2}$/.test(lower)) return true;

  // Check 4-letter battle model naming convention
  // **am to **bz are battle models (P files without extension)
  if (/^[a-z]{4}$/i.test(lower)) {
    const suffix = lower.slice(2, 4);
    // am-az and ba-bz are model files
    if ((suffix >= 'am' && suffix <= 'az') || (suffix >= 'ba' && suffix <= 'bz')) {
      return true;
    }
  }

  return false;
}

export function getFileType(filename: string): string {
  const lower = filename.toLowerCase();
  
  if (filename.startsWith('maplist')) return 'Map List';

  // Check 4-letter battle file patterns first
  const battleType = getBattleFileType(lower);
  if (battleType) return battleType;
  
  // Check filename patterns
  for (const [pattern, type] of filenamePatterns) {
    if (pattern.test(lower)) {
      return type;
    }
  }
  
  // Get extension
  const lastDot = lower.lastIndexOf('.');
  if (lastDot === -1) {
    return 'Unknown';
  }
  
  const ext = lower.slice(lastDot + 1);
  return extensionMap[ext] || 'Unknown';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatTotalSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  
  return `${size.toFixed(2)} ${units[i]}`;
}
