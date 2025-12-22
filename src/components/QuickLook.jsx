import { useState, useEffect, useCallback, useMemo } from 'react';
import { HexViewer } from './HexViewer.jsx';
import { TexPreview } from './TexPreview.jsx';
import { PModelPreview } from './PModelPreview.jsx';
import { SkeletonPreview } from './SkeletonPreview.jsx';
import { HRCPreview } from './HRCPreview.jsx';
import { RSDPreview } from './RSDPreview.jsx';
import { FieldPreview } from './FieldPreview.jsx';
import { formatFileSize, isBattleTexFile, isPModelFile, isBattleSkeletonFile, isMagicSkeletonFile, isHRCFile, isRSDFile, isTextureFile, isFieldFile } from '../utils/fileTypes.ts';
import { usePersistedState } from '../utils/settings.ts';
import './QuickLook.css';

const HEX_COLUMN_WIDTHS = {
  16: 676,
  24: 928,
  32: 1190,
};

// SVG Icons
const DockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="1" y="2" width="6" height="12" rx="1" />
    <rect x="9" y="2" width="6" height="12" rx="1" />
  </svg>
);

const ExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
  </svg>
);

export function QuickLook({ filename, data, onClose, onLoadFile, mode = 'modal', onDock, onUndock, onFindReferences }) {
  const isTexFile = filename.toLowerCase().endsWith('.tex') || isBattleTexFile(filename);
  const isPFile = isPModelFile(filename);
  const isSkeletonFile = isBattleSkeletonFile(filename) || isMagicSkeletonFile(filename);
  const isHRC = isHRCFile(filename);
  const isRSD = isRSDFile(filename);
  const isField = isFieldFile(filename);
  const [hexColumns, setHexColumns] = usePersistedState('hexColumns');
  const [viewMode, setViewMode] = usePersistedState('previewMode');
  const [plaintextWidth, setPlaintextWidth] = useState('Normal'); // 'Normal' | 'Full'

  // Check if showing a specialized preview (not hex mode)
  const isSpecializedPreview = viewMode !== 'hex' && (isTexFile || isPFile || isSkeletonFile || isHRC || isRSD || isField);
  // Check if showing hex view
  const isHexView = !isSpecializedPreview;
  // Check if plaintext is in full width mode
  const isPlaintextFullWidth = isHexView && plaintextWidth === 'Full';

  const getFileTypeName = () => {
    if (isTexFile) return 'TEX Image';
    if (isPFile) return '3D Model';
    if (isSkeletonFile) return isMagicSkeletonFile(filename) ? 'Magic Skeleton' : 'Battle Skeleton';
    if (isHRC) return 'Field Skeleton';
    if (isRSD) return 'Resource Definition';
    if (isField) return 'Field';
    return 'Preview';
  };

  const modalWidth = useMemo(() => {
    if (isTexFile) return 900;
    if (isPFile) return 900;
    if (isSkeletonFile) return 900;
    if (isHRC) return 900;
    if (isRSD) return 900;
    if (isField) return 900;
    return HEX_COLUMN_WIDTHS[hexColumns] || 900;
  }, [isTexFile, isPFile, isSkeletonFile, isHRC, isRSD, isField, hexColumns]);

  const handleKeyDown = useCallback((e) => {
    // Close on Escape/Space in both modes
    if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const content = (
    <>
      <div className="quicklook-header">
        <h2 className="quicklook-title">{filename} <span>(preview)</span></h2>
        <div className="quicklook-header-buttons">
          {mode === 'modal' && onDock && (
            <button className="quicklook-button" onClick={onDock} title="Dock on the side">
              <DockIcon />
            </button>
          )}
          {mode === 'docked' && onUndock && (
            <button className="quicklook-button" onClick={onUndock} title="Fullscreen view">
              <ExpandIcon />
            </button>
          )}
          <button className="quicklook-button quicklook-close-button" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
      </div>

      <div className="quicklook-content">
        {viewMode === 'hex' ? (
          <HexViewer data={data} columns={hexColumns} onColumnsChange={setHexColumns} onPlaintextWidthChange={setPlaintextWidth} mode={mode} />
        ) : isTexFile ? (
          <TexPreview data={data} filename={filename} />
        ) : isPFile ? (
          <PModelPreview data={data} />
        ) : isSkeletonFile ? (
          <SkeletonPreview data={data} filename={filename} onLoadFile={onLoadFile} />
        ) : isHRC ? (
          <HRCPreview data={data} filename={filename} onLoadFile={onLoadFile} />
        ) : isRSD ? (
          <RSDPreview data={data} onLoadFile={onLoadFile} />
        ) : isField ? (
          <FieldPreview data={data} filename={filename} />
        ) : (
          <HexViewer data={data} columns={hexColumns} onColumnsChange={setHexColumns} onPlaintextWidthChange={setPlaintextWidth} mode={mode} />
        )}
      </div>

      <div className="quicklook-footer">
        <span>{formatFileSize(data.length)}</span>
        {viewMode === 'hex' ? (
          <span>Hex View</span>
        ) : (
          <>
            {isTexFile && <span>TEX Image</span>}
            {isPFile && <span>3D Model</span>}
            {isSkeletonFile && <span>{isMagicSkeletonFile(filename) ? 'Magic Skeleton' : 'Battle Skeleton'}</span>}
            {isHRC && <span>Field Skeleton</span>}
            {isRSD && <span>Resource Definition</span>}
            {isField && <span>Field</span>}
            {!isTexFile && !isPFile && !isSkeletonFile && !isHRC && !isRSD && !isField && <span>Hex View</span>}
          </>
        )}
        {isTextureFile(filename) && onFindReferences && (
          <a
            href="#"
            className="quicklook-view-toggle"
            onClick={(e) => {
              e.preventDefault();
              onFindReferences(filename);
            }}
          >
            Find references
          </a>
        )}
        {(isTexFile || isPFile || isSkeletonFile || isHRC || isRSD || isField) && (
          <span style={{ marginLeft: 'auto' }}>
            {viewMode === 'hex' ? (
              <a
                href="#"
                className="quicklook-view-toggle"
                onClick={(e) => {
                  e.preventDefault();
                  setViewMode('auto');
                }}
              >
                View as {getFileTypeName()}
              </a>
            ) : (
              <a
                href="#"
                className="quicklook-view-toggle"
                onClick={(e) => {
                  e.preventDefault();
                  setViewMode('hex');
                }}
              >
                View as Hex/Text
              </a>
            )}
          </span>
        )}
      </div>
    </>
  );

  if (mode === 'docked') {
    return (
      <div className="quicklook-docked">
        {content}
      </div>
    );
  }

  return (
    <div className="quicklook-overlay" onClick={handleOverlayClick}>
      <div
        className={`quicklook-modal ${isSpecializedPreview || isPlaintextFullWidth ? 'quicklook-modal-fullscreen' : ''} ${isHexView && !isPlaintextFullWidth ? 'quicklook-modal-fullscreen-height' : ''}`}
        style={isSpecializedPreview || isPlaintextFullWidth ? {} : { maxWidth: modalWidth }}
      >
        {content}
      </div>
    </div>
  );
}
