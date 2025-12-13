import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getFileType, formatFileSize } from '../utils/fileTypes.ts';
import './FileList.css';

const ROW_HEIGHT = 32;

export const FileList = forwardRef(function FileList({ 
  files, 
  currentPath,
  selectedIndices, 
  onSelect, 
  onNavigate,
  onDoubleClick
}, ref) {
  const parentRef = useRef(null);
  
  // Scroll to top when path changes
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [currentPath]);
  
  const hasParent = currentPath !== '';
  const displayItems = hasParent 
    ? [{ isParent: true }, ...files]
    : files;

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex: (index) => {
      virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    getPageSize: () => {
      if (!parentRef.current) return 10;
      return Math.floor(parentRef.current.clientHeight / ROW_HEIGHT);
    },
    getVisibleRange: () => {
      const items = virtualizer.getVirtualItems();
      if (items.length === 0) return { start: 0, end: 0 };
      return { start: items[0].index, end: items[items.length - 1].index };
    }
  }), [virtualizer]);

  const handleRowClick = useCallback((e, item) => {
    if (item.isParent) {
      onNavigate('..');
      return;
    }
    if (item.isFolder) {
      onNavigate(item.folderPath);
      return;
    }
    
    const actualIndex = item.tocIndex;
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    
    onSelect(actualIndex, { ctrl: isCtrl, shift: isShift });
  }, [onSelect, onNavigate]);

  const handleRowDoubleClick = useCallback((item) => {
    if (!item.isParent && !item.isFolder) {
      onDoubleClick?.(item);
    }
  }, [onDoubleClick]);

  return (
    <div className="file-list-container">
      <div className="file-list-header">
        <span className="col-index">#</span>
        <span className="col-name">Name</span>
        <span className="col-size">Size</span>
        <span className="col-type">Type</span>
      </div>
      
      <div ref={parentRef} className="file-list-scroll">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = displayItems[virtualRow.index];
            const isSelected = !item.isParent && !item.isFolder && selectedIndices.has(item.tocIndex);
            
            return (
              <div
                key={virtualRow.key}
                className={`file-row ${isSelected ? 'selected' : ''} ${item.isParent || item.isFolder ? 'folder-row' : ''}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={(e) => handleRowClick(e, item)}
                onDoubleClick={() => handleRowDoubleClick(item)}
              >
                {item.isParent ? (
                  <>
                    <span className="col-index"></span>
                    <span className="col-name folder-name">📁 ..</span>
                    <span className="col-size"></span>
                    <span className="col-type">Parent folder</span>
                  </>
                ) : item.isFolder ? (
                  <>
                    <span className="col-index"></span>
                    <span className="col-name folder-name">📁 {item.name}</span>
                    <span className="col-size">{item.fileCount} files</span>
                    <span className="col-type">Folder</span>
                  </>
                ) : (
                  <>
                    <span className="col-index">{String(item.displayIndex).padStart(4, '0')}</span>
                    <span className="col-name"><span className="file-icon">📄</span> {item.filename}</span>
                    <span className="col-size">{formatFileSize(item.filesize)}</span>
                    <span className="col-type">{getFileType(item.filename)}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
