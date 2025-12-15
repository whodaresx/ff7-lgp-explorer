import { useState, useEffect, useCallback, useMemo } from 'react';
import { HexViewer } from './HexViewer.jsx';
import { TexPreview } from './TexPreview.jsx';
import { PModelPreview } from './PModelPreview.jsx';
import { SkeletonPreview } from './SkeletonPreview.jsx';
import { HRCPreview } from './HRCPreview.jsx';
import { RSDPreview } from './RSDPreview.jsx';
import { formatFileSize, isBattleTexFile, isPModelFile, isBattleSkeletonFile, isHRCFile, isRSDFile } from '../utils/fileTypes.ts';
import './QuickLook.css';

const HEX_COLUMN_WIDTHS = {
  16: 660,
  24: 920,
  32: 1180,
};

export function QuickLook({ filename, data, onClose, onLoadFile }) {
  const isTexFile = filename.toLowerCase().endsWith('.tex') || isBattleTexFile(filename);
  const isPFile = isPModelFile(filename);
  const isSkeletonFile = isBattleSkeletonFile(filename);
  const isHRC = isHRCFile(filename);
  const isRSD = isRSDFile(filename);
  const [hexColumns, setHexColumns] = useState(16);

  const modalWidth = useMemo(() => {
    if (isTexFile) return 900;
    if (isPFile) return 900;
    if (isSkeletonFile) return 900;
    if (isHRC) return 900;
    if (isRSD) return 900;
    return HEX_COLUMN_WIDTHS[hexColumns] || 900;
  }, [isTexFile, isPFile, isSkeletonFile, isHRC, isRSD, hexColumns]);

  const handleKeyDown = useCallback((e) => {
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

  return (
    <div className="quicklook-overlay" onClick={handleOverlayClick}>
      <div className="quicklook-modal" style={{ maxWidth: modalWidth }}>
        <div className="quicklook-header">
          <h2 className="quicklook-title">{filename} <span>(preview)</span></h2>
          <button className="quicklook-close" onClick={onClose} title="Close (Esc)">
            ×
          </button>
        </div>
        
        <div className="quicklook-content">
          {isTexFile ? (
            <TexPreview data={data} filename={filename} />
          ) : isPFile ? (
            <PModelPreview data={data} />
          ) : isSkeletonFile ? (
            <SkeletonPreview data={data} filename={filename} onLoadFile={onLoadFile} />
          ) : isHRC ? (
            <HRCPreview data={data} filename={filename} onLoadFile={onLoadFile} />
          ) : isRSD ? (
            <RSDPreview data={data} onLoadFile={onLoadFile} />
          ) : (
            <HexViewer data={data} columns={hexColumns} onColumnsChange={setHexColumns} />
          )}
        </div>

        <div className="quicklook-footer">
          <span>{formatFileSize(data.length)}</span>
          {isTexFile && <span>TEX Image</span>}
          {isPFile && <span>3D Model</span>}
          {isSkeletonFile && <span>Battle Skeleton</span>}
          {isHRC && <span>Field Skeleton</span>}
          {isRSD && <span>Resource Definition</span>}
          {!isTexFile && !isPFile && !isSkeletonFile && !isHRC && !isRSD && <span>Hex View</span>}
        </div>
      </div>
    </div>
  );
}
