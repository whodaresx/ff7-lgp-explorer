const extensionMap: Record<string, string> = {
  // Textures
  tex: 'Texture',
  tga: 'Texture',
  png: 'Texture',
  bmp: 'Texture',
  jpg: 'Texture',
  jpeg: 'Texture',
  
  // Images
  tim: 'Image',
  
  // Models
  p: 'Model',
  hrc: 'Skeleton',
  rsd: 'Resource',
  
  // Animations
  a: 'Animation',
  da: 'Animation',
  
  // Audio
  wav: 'Audio',
  mid: 'MIDI',
  ogg: 'Audio',
  mp3: 'Audio',
  
  // Video
  avi: 'Video',
  
  // Scripts/Data
  bin: 'Binary',
  dat: 'Data',
  lzs: 'Compressed',
  
  // Text
  txt: 'Text',
  ini: 'Config',
  cfg: 'Config',
  
  // FF7 specific
  lgp: 'Archive',
};

const filenamePatterns: [RegExp, string][] = [
  [/^[a-z]{4}\.bin$/i, 'Field Script'],
  [/^[a-z]{4}$/i, 'Field'],
  [/^world.*\.lgp$/i, 'World Archive'],
  [/^battle.*\.lgp$/i, 'Battle Archive'],
  [/^magic.*\.lgp$/i, 'Magic Archive'],
];

export function getFileType(filename: string): string {
  const lower = filename.toLowerCase();
  
  // Check filename patterns first
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
