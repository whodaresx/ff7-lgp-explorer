import { useState, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import './HexViewer.css';

const COLUMN_OPTIONS = [16, 24, 32];
const VIEW_TYPES = ['Hex', 'Plaintext'];

export function HexViewer({ data, columns, onColumnsChange }) {
  const [viewType, setViewType] = useState('Hex');
  const parentRef = useRef(null);

  const rows = useMemo(() => {
    const result = [];
    for (let i = 0; i < data.length; i += columns) {
      result.push({
        offset: i,
        bytes: data.slice(i, Math.min(i + columns, data.length))
      });
    }
    return result;
  }, [data, columns]);

  const plaintextContent = useMemo(() => {
    let text = '';
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      if (byte >= 32 && byte < 127) {
        text += String.fromCharCode(byte);
      } else if (byte === 10 || byte === 13) {
        text += '\n';
      } else {
        text += '.';
      }
    }
    return text;
  }, [data]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 50,
  });

  const formatOffset = (offset) => {
    return offset.toString(16).toUpperCase().padStart(8, '0');
  };

  const renderHex = (bytes) => {
    const elements = [];
    for (let i = 0; i < columns; i++) {
      if (i > 0) elements.push(' ');
      if (i < bytes.length) {
        const byte = bytes[i];
        const hex = byte.toString(16).toUpperCase().padStart(2, '0');
        if (byte === 0) {
          elements.push(<span key={i} className="hex-zero">{hex}</span>);
        } else {
          elements.push(<span key={i}>{hex}</span>);
        }
      } else {
        elements.push(<span key={i}>  </span>);
      }
    }
    return elements;
  };

  const formatAscii = (bytes) => {
    let ascii = '';
    for (let i = 0; i < columns; i++) {
      if (i < bytes.length) {
        const byte = bytes[i];
        if (byte >= 32 && byte < 127) {
          ascii += String.fromCharCode(byte);
        } else {
          ascii += '.';
        }
      } else {
        ascii += '\u00A0'; // non-breaking space for padding
      }
    }
    return ascii;
  };

  return (
    <div className="hex-viewer">
      <div className="hex-toolbar">
        <span className="hex-toolbar-label">Type:</span>
        <div className="hex-segmented">
          {VIEW_TYPES.map(type => (
            <button
              key={type}
              className={`hex-segment ${viewType === type ? 'active' : ''}`}
              onClick={() => setViewType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        {viewType === 'Hex' && (
          <>
            <span className="hex-toolbar-label">Columns:</span>
            <div className="hex-segmented">
              {COLUMN_OPTIONS.map(col => (
                <button
                  key={col}
                  className={`hex-segment ${columns === col ? 'active' : ''}`}
                  onClick={() => onColumnsChange(col)}
                >
                  {col}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      
      {viewType === 'Hex' ? (
        <>
          <div className="hex-header">
            <span className="hex-offset">Offset</span>
            <span className="hex-bytes">
              {Array.from({ length: columns }, (_, i) => 
                i.toString(16).toUpperCase().padStart(2, '0')
              ).join(' ')}
            </span>
            <span className="hex-ascii">ASCII</span>
          </div>
          
          <div ref={parentRef} className="hex-scroll">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    className="hex-row"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <span className="hex-offset">{formatOffset(row.offset)}</span>
                    <span className="hex-bytes">{renderHex(row.bytes)}</span>
                    <span className="hex-ascii">{formatAscii(row.bytes)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="plaintext-scroll">
          <pre className="plaintext-content">{plaintextContent}</pre>
        </div>
      )}
    </div>
  );
}
