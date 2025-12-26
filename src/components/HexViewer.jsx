import { useState, useRef, useMemo, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Lzss } from '../lzss';
import './HexViewer.css';

const COLUMN_OPTIONS = [16, 24, 32];
const VIEW_TYPES = ['Hex', 'Plaintext'];
const WIDTH_OPTIONS = ['Normal', 'Full'];
const COMPRESSION_OPTIONS = ['Raw', 'Decompress'];

export function HexViewer({ data, columns, onColumnsChange, onPlaintextWidthChange, mode = 'modal' }) {
  const parentRef = useRef(null);
  const [plaintextWidth, setPlaintextWidth] = useState('Normal');
  const [compressionMode, setCompressionMode] = useState('Raw');

  const handlePlaintextWidthChange = (width) => {
    setPlaintextWidth(width);
    if (onPlaintextWidthChange) {
      onPlaintextWidthChange(width);
    }
  };

  // Reset compression mode when data changes
  useEffect(() => {
    setCompressionMode('Raw');
  }, [data]);

  // Attempt LZSS decompression when requested
  const { displayData, decompressionError, decompressionInfo } = useMemo(() => {
    if (compressionMode === 'Raw') {
      return { displayData: data, decompressionError: null, decompressionInfo: null };
    }

    try {
      const lzss = new Lzss();

      // Many FF7 compressed files have a 4-byte little-endian header with the compressed size
      // Try decompressing with header skip first
      if (data.length > 4) {
        const headerValue = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
        const compressedData = data.subarray(4);

        // If header value roughly matches the remaining data length, it's likely a size header
        if (headerValue > 0 && headerValue <= compressedData.length + 100) {
          try {
            const decompressed = lzss.decompress(compressedData);
            return {
              displayData: decompressed,
              decompressionError: null,
              decompressionInfo: `Decompressed: ${compressedData.length} → ${decompressed.length} bytes`
            };
          } catch {
            // Fall through to try without header
          }
        }
      }

      // Try decompressing without header skip
      const decompressed = lzss.decompress(data);
      return {
        displayData: decompressed,
        decompressionError: null,
        decompressionInfo: `Decompressed: ${data.length} → ${decompressed.length} bytes`
      };
    } catch (err) {
      return {
        displayData: data,
        decompressionError: `Decompression failed: ${err.message}`,
        decompressionInfo: null
      };
    }
  }, [data, compressionMode]);

  // Auto-detect if content is likely plaintext by checking first 100 bytes
  const isLikelyText = useMemo(() => {
    const checkLength = Math.min(100, displayData.length);
    for (let i = 0; i < checkLength; i++) {
      const byte = displayData[i];
      // Printable ASCII (32-126), tab (9), LF (10), CR (13)
      if (!((byte >= 32 && byte < 127) || byte === 9 || byte === 10 || byte === 13)) {
        return false;
      }
    }
    return checkLength > 0;
  }, [displayData]);

  const [viewType, setViewType] = useState(isLikelyText ? 'Plaintext' : 'Hex');

  // Reset view type when opening a different file or when compression mode changes
  useEffect(() => {
    setViewType(isLikelyText ? 'Plaintext' : 'Hex');
  }, [data, displayData, isLikelyText]);

  // Only compute row count, not actual row data (avoid O(n) slice calls upfront)
  const rowCount = useMemo(() => Math.ceil(displayData.length / columns), [displayData.length, columns]);

  // Lazily compute plaintext content only when in Plaintext view mode
  // Also check isLikelyText to avoid computing on binary files during the render
  // before the useEffect resets viewType
  const plaintextContent = useMemo(() => {
    if (viewType !== 'Plaintext' || !isLikelyText) return '';

    // Use array and join for O(n) instead of O(n²) string concatenation
    const chars = new Array(displayData.length);
    let j = 0;
    for (let i = 0; i < displayData.length; i++) {
      const byte = displayData[i];
      if (byte >= 32 && byte < 127) {
        chars[j++] = String.fromCharCode(byte);
      } else if (byte === 13 && displayData[i + 1] === 10) {
        // CRLF (0D 0A) - treat as single line break
        chars[j++] = '\n';
        i++;
      } else if (byte === 10 || byte === 13) {
        chars[j++] = '\n';
      } else {
        chars[j++] = '.';
      }
    }
    return chars.slice(0, j).join('');
  }, [displayData, viewType, isLikelyText]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 50,
  });

  // Compute row data on-demand for a given index (avoids pre-computing all rows)
  const getRowData = (index) => {
    const offset = index * columns;
    return {
      offset,
      bytes: displayData.subarray(offset, Math.min(offset + columns, displayData.length))
    };
  };

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
        if (byte === 32) {
          // Use non-breaking space to prevent alignment issues
          ascii += '\u00A0';
        } else if (byte > 32 && byte < 127) {
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
        <span className="hex-toolbar-label">Data:</span>
        <div className="hex-segmented">
          {COMPRESSION_OPTIONS.map(opt => (
            <button
              key={opt}
              className={`hex-segment ${compressionMode === opt ? 'active' : ''}`}
              onClick={() => setCompressionMode(opt)}
            >
              {opt}
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
        {viewType === 'Plaintext' && mode === 'modal' && (
          <>
            <span className="hex-toolbar-label">Width:</span>
            <div className="hex-segmented">
              {WIDTH_OPTIONS.map(width => (
                <button
                  key={width}
                  className={`hex-segment ${plaintextWidth === width ? 'active' : ''}`}
                  onClick={() => handlePlaintextWidthChange(width)}
                >
                  {width}
                </button>
              ))}
            </div>
          </>
        )}
        {decompressionInfo && (
          <span className="hex-toolbar-info">{decompressionInfo}</span>
        )}
        {decompressionError && (
          <span className="hex-toolbar-error">{decompressionError}</span>
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
                const row = getRowData(virtualRow.index);
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
          <pre className="plaintext-content">
            {plaintextContent}
          </pre>
        </div>
      )}
    </div>
  );
}
