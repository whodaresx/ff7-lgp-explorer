import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { LGP } from './lgp.ts';
import { Toolbar } from './components/Toolbar.jsx';
import { FileList } from './components/FileList.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { QuickLook } from './components/QuickLook.jsx';
import { formatTotalSize } from './utils/fileTypes.ts';
import './App.css';

function App() {
  const [lgp, setLgp] = useState(null);
  const [archiveName, setArchiveName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [status, setStatus] = useState('Ready');
  const [searchQuery, setSearchQuery] = useState('');
  const [quickLookFile, setQuickLookFile] = useState(null);
  const lastSelectedIndex = useRef(null);

  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const insertInputRef = useRef(null);

  // Build folder structure and file list from archive
  const { folders, files, totalSize } = useMemo(() => {
    if (!lgp) return { folders: new Map(), files: [], totalSize: 0 };

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

    return { folders: folderMap, files: fileList, totalSize: total };
  }, [lgp]);

  // Filter files based on current path and search query
  const displayFiles = useMemo(() => {
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
      filtered = filtered.filter(f => 
        f.filename.toLowerCase().includes(query)
      );
      // Also filter folders by name when searching
      const filteredFolders = subfolders.filter(f =>
        f.name.toLowerCase().includes(query)
      );
      return [...filteredFolders, ...filtered];
    }

    // Sort folders first, then files
    subfolders.sort((a, b) => a.name.localeCompare(b.name));
    
    return [...subfolders, ...filtered];
  }, [files, folders, currentPath, searchQuery]);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus(`Loading ${file.name}...`);
    try {
      const buffer = await file.arrayBuffer();
      const archive = new LGP(buffer);
      setLgp(archive);
      setArchiveName(file.name);
      setCurrentPath('');
      setSelectedIndices(new Set());
      setSearchQuery('');
      setStatus(`Loaded ${file.name}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
    e.target.value = '';
  }, []);

  const handleSave = useCallback(() => {
    if (!lgp) return;
    
    setStatus('Saving archive...');
    try {
      const data = lgp.writeArchive();
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = archiveName || 'archive.lgp';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Archive saved');
    } catch (err) {
      setStatus(`Error saving: ${err.message}`);
    }
  }, [lgp, archiveName]);

  const handleExtract = useCallback(async () => {
    if (!lgp || selectedIndices.size === 0) return;

    const selectedFiles = files.filter(f => selectedIndices.has(f.tocIndex));
    
    if (selectedFiles.length === 1) {
      const file = selectedFiles[0];
      const data = lgp.getFile(file.filename);
      if (!data) {
        setStatus(`Error: Could not read ${file.filename}`);
        return;
      }
      
      const blob = new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Extracted ${file.filename}`);
    } else {
      // Extract multiple files with delay to avoid browser blocking
      setStatus(`Extracting ${selectedFiles.length} files...`);
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const data = lgp.getFile(file.filename);
        if (!data) continue;
        
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        a.click();
        URL.revokeObjectURL(url);
        
        // Small delay between downloads to prevent browser blocking
        if (i < selectedFiles.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      setStatus(`Extracted ${selectedFiles.length} files`);
    }
  }, [lgp, files, selectedIndices]);

  const handleReplace = useCallback(() => {
    if (selectedIndices.size !== 1) {
      setStatus('Select exactly one file to replace');
      return;
    }
    replaceInputRef.current?.click();
  }, [selectedIndices]);

  const handleReplaceSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !lgp) return;

    const selectedIndex = [...selectedIndices][0];
    const targetFile = files.find(f => f.tocIndex === selectedIndex);
    if (!targetFile) return;

    try {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      lgp.setFile(targetFile.filename, data);
      setStatus(`Replaced ${targetFile.filename} with ${file.name}`);
      // Force re-render
      setLgp({ ...lgp });
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
    e.target.value = '';
  }, [lgp, files, selectedIndices]);

  const handleInsert = useCallback(() => {
    insertInputRef.current?.click();
  }, []);

  const handleInsertSelect = useCallback(async (e) => {
    const inputFiles = e.target.files;
    if (!inputFiles || inputFiles.length === 0 || !lgp) return;

    setStatus(`Inserting ${inputFiles.length} file(s)...`);
    let inserted = 0;
    let skipped = 0;
    
    for (const file of inputFiles) {
      try {
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        
        if (lgp.insertFile(file.name, data)) {
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
    setLgp({ ...lgp });
    e.target.value = '';
  }, [lgp]);

  const handleSelect = useCallback((index, modifiers) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      
      if (modifiers.shift && lastSelectedIndex.current !== null) {
        // Range select
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
      } else if (modifiers.ctrl) {
        // Toggle select
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
      } else {
        // Single select
        next.clear();
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
    setSelectedIndices(new Set());
  }, []);

  const openQuickLookForFile = useCallback((file) => {
    if (!lgp || !file) return;
    
    const data = lgp.getFile(file.filename);
    if (!data) {
      setStatus(`Error: Could not read ${file.filename}`);
      return;
    }
    
    setQuickLookFile({ filename: file.filename, data });
  }, [lgp]);

  const openQuickLook = useCallback(() => {
    if (!lgp || selectedIndices.size !== 1) return;
    
    const selectedIndex = [...selectedIndices][0];
    const file = files.find(f => f.tocIndex === selectedIndex);
    if (!file) return;
    
    openQuickLookForFile(file);
  }, [lgp, selectedIndices, files, openQuickLookForFile]);

  const closeQuickLook = useCallback(() => {
    setQuickLookFile(null);
  }, []);

  // Keyboard handling for QuickLook
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      // Don't trigger if QuickLook is already open
      if (quickLookFile) return;
      
      if (e.code === 'Space' && selectedIndices.size === 1) {
        e.preventDefault();
        openQuickLook();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndices, quickLookFile, openQuickLook]);

  // Build breadcrumb
  const breadcrumbParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div className="app">
      <Toolbar
        onOpen={handleOpen}
        onSave={handleSave}
        onExtract={handleExtract}
        onReplace={handleReplace}
        onInsert={handleInsert}
        hasArchive={!!lgp}
        hasSelection={selectedIndices.size > 0}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
      />
      
      <div className="main-content">
        {lgp && (
          <div className="breadcrumb">
            <span 
              className="breadcrumb-item" 
              onClick={() => { setCurrentPath(''); setSelectedIndices(new Set()); }}
            >
              {archiveName}
            </span>
            {breadcrumbParts.map((part, i) => (
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
        )}
        
        {lgp ? (
          <FileList
            files={displayFiles}
            currentPath={currentPath}
            selectedIndices={selectedIndices}
            onSelect={handleSelect}
            onNavigate={handleNavigate}
            onDoubleClick={openQuickLookForFile}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-text">Open an LGP archive to get started</div>
          </div>
        )}
      </div>
      
      <StatusBar
        status={status}
        fileCount={lgp ? lgp.archive.toc.length : 0}
        totalSize={formatTotalSize(totalSize)}
        selectedCount={selectedIndices.size}
      />
      
      <input
        ref={fileInputRef}
        type="file"
        accept=".lgp"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      <input
        ref={replaceInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleReplaceSelect}
      />
      <input
        ref={insertInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleInsertSelect}
      />
      
      {quickLookFile && (
        <QuickLook
          filename={quickLookFile.filename}
          data={quickLookFile.data}
          onClose={closeQuickLook}
        />
      )}
    </div>
  );
}

export default App;
