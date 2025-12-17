import { useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getFileType, formatFileSize } from '../utils/fileTypes.ts';
import charNames from '../assets/char-names.json';
import battleNames from '../assets/battle-names.json';
import './FileList.css';

const ROW_HEIGHT = 32;

// Get display name for a file based on archive type
function getDisplayName(filename, archiveType) {
  if (!archiveType) return null;

  // Extract 4-letter code from filename (without extension)
  const baseName = filename.toLowerCase().replace(/\.[^.]+$/, '');
  if (baseName.length !== 4) return null;

  if (archiveType === 'char') {
    return charNames[baseName] || null;
  } else if (archiveType === 'battle') {
    return battleNames[baseName] || null;
  }
  return null;
}

export const FileList = forwardRef(function FileList({
  files,
  currentPath,
  selectedIndices,
  onSelect,
  onNavigate,
  onDoubleClick,
  sortColumn,
  sortDirection,
  onSort,
  viewMode = 'list',
  onViewModeChange,
  expandedNodes,
  onToggleExpand,
  hierarchyLoading = false,
  hierarchyProgress = null,
  archiveName = '',
}, ref) {
  const parentRef = useRef(null);

  // Determine archive type for display names column
  const archiveType = useMemo(() => {
    const name = archiveName.toLowerCase();
    if (name === 'char.lgp') return 'char';
    if (name === 'battle.lgp') return 'battle';
    return null;
  }, [archiveName]);
  
  // Scroll to top when path changes
  useEffect(() => {
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [currentPath]);
  
  // In hierarchy view, don't show parent folder navigation
  const hasParent = viewMode === 'list' && currentPath !== '';
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

  // Handle expand/collapse click
  const handleExpandClick = useCallback((e, tocIndex) => {
    e.stopPropagation();
    onToggleExpand?.(tocIndex);
  }, [onToggleExpand]);

  return (
    <div className="file-list-container">
      <div className={`file-list-header ${archiveType ? 'has-display-name' : ''}`}>
        <span className="col-index sortable" onClick={() => onSort('index')}>
          # {sortColumn === 'index' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
        </span>
        <span className="col-name sortable" onClick={() => onSort('name')}>
          Name {sortColumn === 'name' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
        </span>
        {archiveType && (
          <span className="col-display-name sortable" onClick={() => onSort('displayName')}>
            Display Name {sortColumn === 'displayName' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
          </span>
        )}
        <span className="col-size sortable" onClick={() => onSort('size')}>
          Size {sortColumn === 'size' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
        </span>
        <span className="col-type sortable" onClick={() => onSort('type')}>
          Type {sortColumn === 'type' && <span className="sort-arrow">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
        </span>
      </div>
      
      {hierarchyLoading && viewMode === 'hierarchy' && (
        <div className="hierarchy-loading">
          <div className="hierarchy-loading-message">
            {hierarchyProgress?.message || 'Building file hierarchy...'}
          </div>
          {hierarchyProgress && hierarchyProgress.total > 0 && (
            <div className="hierarchy-progress">
              <div className="hierarchy-progress-bar">
                <div
                  className="hierarchy-progress-fill"
                  style={{ width: `${Math.round((hierarchyProgress.current / hierarchyProgress.total) * 100)}%` }}
                />
              </div>
              <div className="hierarchy-progress-text">
                {Math.round((hierarchyProgress.current / hierarchyProgress.total) * 100)}%
              </div>
            </div>
          )}
        </div>
      )}
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
            const isHierarchyItem = viewMode === 'hierarchy' && typeof item.depth === 'number';
            const depth = isHierarchyItem ? item.depth : 0;
            const hasChildren = isHierarchyItem && item.hasChildren;
            const isExpanded = hasChildren && expandedNodes?.has(item.tocIndex);

            return (
              <div
                key={virtualRow.key}
                className={`file-row ${isSelected ? 'selected' : ''} ${item.isParent || item.isFolder ? 'folder-row' : ''} ${isHierarchyItem ? 'hierarchy-row' : ''} ${archiveType ? 'has-display-name' : ''}`}
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
                    {archiveType && <span className="col-display-name"></span>}
                    <span className="col-size"></span>
                    <span className="col-type">Parent folder</span>
                  </>
                ) : item.isFolder ? (
                  <>
                    <span className="col-index"></span>
                    <span className="col-name folder-name">📁 {item.name}</span>
                    {archiveType && <span className="col-display-name"></span>}
                    <span className="col-size">{item.fileCount} files</span>
                    <span className="col-type">Folder</span>
                  </>
                ) : (
                  <>
                    <span className="col-index">{String(item.displayIndex).padStart(4, '0')}</span>
                    <span className="col-name">
                      {isHierarchyItem && depth > 0 && (
                        <span className="tree-indent" style={{ width: depth * 20 }}>
                          └─
                        </span>
                      )}
                      {hasChildren ? (
                        <span
                          className="expand-toggle"
                          onClick={(e) => handleExpandClick(e, item.tocIndex)}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </span>
                      ) : isHierarchyItem ? (
                        <span className="expand-placeholder"></span>
                      ) : null}
                      <span className="file-icon">📄</span> {item.filename}
                      {hasChildren && !isExpanded && (
                        <span className="child-count">({item.childCount})</span>
                      )}
                    </span>
                    {archiveType && (
                      <span className="col-display-name">{getDisplayName(item.filename, archiveType)}</span>
                    )}
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
