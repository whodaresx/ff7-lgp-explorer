import { useState, useEffect, useCallback, useMemo } from 'react';
import { HexViewer } from './HexViewer.jsx';
import { TexPreview } from './TexPreview.jsx';
import { formatFileSize } from '../utils/fileTypes.ts';
import './QuickLook.css';

const HEX_COLUMN_WIDTHS = {
  16: 660,
  24: 920,
  32: 1180,
};

export function QuickLook({ filename, data, onClose }) {
  const isTexFile = filename.toLowerCase().endsWith('.tex');
  const [hexColumns, setHexColumns] = useState(16);

  const modalWidth = useMemo(() => {
    if (isTexFile) return 900;
    return HEX_COLUMN_WIDTHS[hexColumns] || 900;
  }, [isTexFile, hexColumns]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
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
          ) : (
            <HexViewer data={data} columns={hexColumns} onColumnsChange={setHexColumns} />
          )}
        </div>
        
        <div className="quicklook-footer">
          <span>{formatFileSize(data.length)}</span>
          {isTexFile && <span>TEX Image</span>}
          {!isTexFile && <span>Hex View</span>}
        </div>
      </div>
    </div>
  );
}
