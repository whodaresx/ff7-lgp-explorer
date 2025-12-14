import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { LGP } from './lgp.ts';
import { Toolbar } from './components/Toolbar.jsx';
import { FileList } from './components/FileList.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { QuickLook } from './components/QuickLook.jsx';
import { formatTotalSize, getFileType } from './utils/fileTypes.ts';
import './App.css';

function App() {
  const [lgp, setLgp] = useState(null);
  const [archiveVersion, setArchiveVersion] = useState(0);
  const [archiveName, setArchiveName] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [selectedIndices, setSelectedIndices] = useState(new Set());
  const [status, setStatus] = useState('Ready');
  const [searchQuery, setSearchQuery] = useState('');
  const [quickLookFile, setQuickLookFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sortColumn, setSortColumn] = useState('index');
  const [sortDirection, setSortDirection] = useState('asc');
  const lastSelectedIndex = useRef(null);
  const dragCounter = useRef(0);

  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const insertInputRef = useRef(null);
  const fileListRef = useRef(null);
  const searchInputRef = useRef(null);
  const pendingSelectionIndex = useRef(null);
  const typeaheadBuffer = useRef('');
  const typeaheadTimeout = useRef(null);

  // Build folder structure and file list from archive
  // archiveVersion is used to trigger re-computation when archive is modified
  const { folders, files, totalSize } = useMemo(() => {
    if (!lgp) return { folders: new Map(), files: [], totalSize: 0 };
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

    return { folders: folderMap, files: fileList, totalSize: total };
  }, [lgp, archiveVersion]);

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
  }, [files, folders, currentPath, searchQuery, sortColumn, sortDirection]);

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
      // Single file: download directly
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
      // Multiple files: create a zip
      setStatus(`Creating zip with ${selectedFiles.length} files...`);
      const zip = new JSZip();
      
      for (const file of selectedFiles) {
        const data = lgp.getFile(file.filename);
        if (data) {
          zip.file(file.filename, data);
        }
      }
      
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${archiveName.replace('.lgp', '')}_extract.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Extracted ${selectedFiles.length} files as zip`);
    }
  }, [lgp, files, selectedIndices, archiveName]);

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
      setArchiveVersion(v => v + 1);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
    e.target.value = '';
  }, [lgp, files, selectedIndices]);

  const handleAdd = useCallback(() => {
    insertInputRef.current?.click();
  }, []);

  const handleAddSelect = useCallback(async (e) => {
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
    setArchiveVersion(v => v + 1);
    e.target.value = '';
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
    setSelectedIndices(new Set());
  }, []);

  const handleSort = useCallback((column) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

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

  // Keyboard handling for QuickLook and navigation
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
      
      // Slash key or Cmd/Ctrl+F focuses search
      if ((e.key === '/' || (e.key === 'f' && (e.metaKey || e.ctrlKey))) && lgp) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
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
  }, [selectedIndices, quickLookFile, openQuickLook, lgp, displayFiles, currentPath]);

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
      setStatus(`Loaded ${file.name}`);
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  }, []);

  // Build breadcrumb
  const breadcrumbParts = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
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
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-text">Open or drag & drop an LGP archive</div>
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
        onChange={handleAddSelect}
      />
      
      {quickLookFile && (
        <QuickLook
          filename={quickLookFile.filename}
          data={quickLookFile.data}
          onClose={closeQuickLook}
          onLoadFile={(name) => lgp?.getFile(name)}
        />
      )}
    </div>
  );
}

export default App;
