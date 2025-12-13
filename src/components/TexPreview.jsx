import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TexFile } from '../texfile.ts';
import './TexPreview.css';

const ZOOM_LEVELS = [10, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400];

export function TexPreview({ data, filename }) {
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [paletteDropdownOpen, setPaletteDropdownOpen] = useState(false);
  const canvasRef = useRef(null);
  const paletteDropdownRef = useRef(null);

  const { tex, error } = useMemo(() => {
    try {
      const texFile = new TexFile(data);
      return { tex: texFile, error: null };
    } catch (err) {
      return { tex: null, error: err.message };
    }
  }, [data]);

  useEffect(() => {
    if (!tex || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = tex.data;

    canvas.width = width;
    canvas.height = height;

    const pixels = tex.getPixels(paletteIndex);
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(imageData, 0, 0);
  }, [tex, paletteIndex]);

  const handleDownload = useCallback(() => {
    if (!canvasRef.current) return;

    canvasRef.current.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const baseName = filename.replace(/\.[^.]+$/, '');
      const paletteSuffix = tex?.data.numPalettes > 1 ? `_pal${paletteIndex}` : '';
      a.download = `${baseName}${paletteSuffix}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [filename, paletteIndex, tex]);

  const handleZoomIn = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoom);
    if (currentIndex < ZOOM_LEVELS.length - 1) {
      setZoom(ZOOM_LEVELS[currentIndex + 1]);
    }
  }, [zoom]);

  const handleZoomOut = useCallback(() => {
    const currentIndex = ZOOM_LEVELS.indexOf(zoom);
    if (currentIndex > 0) {
      setZoom(ZOOM_LEVELS[currentIndex - 1]);
    }
  }, [zoom]);

  const handlePrevPalette = useCallback(() => {
    if (paletteIndex > 0) {
      setPaletteIndex(paletteIndex - 1);
    }
  }, [paletteIndex]);

  const handleNextPalette = useCallback(() => {
    if (tex && paletteIndex < tex.data.numPalettes - 1) {
      setPaletteIndex(paletteIndex + 1);
    }
  }, [paletteIndex, tex]);

  const handleSelectPalette = useCallback((index) => {
    setPaletteIndex(index);
    setPaletteDropdownOpen(false);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!paletteDropdownOpen) return;
    
    const handleClickOutside = (e) => {
      if (paletteDropdownRef.current && !paletteDropdownRef.current.contains(e.target)) {
        setPaletteDropdownOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [paletteDropdownOpen]);

  if (error) {
    return (
      <div className="tex-preview tex-error">
        <p>Failed to parse TEX file:</p>
        <p>{error}</p>
      </div>
    );
  }

  if (!tex) {
    return (
      <div className="tex-preview tex-loading">
        Loading...
      </div>
    );
  }

  const { width, height, numPalettes } = tex.data;

  return (
    <div className="tex-preview">
      <div className="tex-toolbar">
        {numPalettes > 1 && (
          <div className="tex-palette-selector" ref={paletteDropdownRef}>
            <button
              className="tex-palette-btn tex-palette-nav"
              onClick={handlePrevPalette}
              disabled={paletteIndex === 0}
              title="Previous palette"
            >
              ‹
            </button>
            <button
              className="tex-palette-btn tex-palette-current"
              onClick={() => setPaletteDropdownOpen(!paletteDropdownOpen)}
            >
              Palette {paletteIndex + 1}
              <span className="tex-palette-arrow">▾</span>
            </button>
            <button
              className="tex-palette-btn tex-palette-nav"
              onClick={handleNextPalette}
              disabled={paletteIndex === numPalettes - 1}
              title="Next palette"
            >
              ›
            </button>
            {paletteDropdownOpen && (
              <div className="tex-palette-dropdown">
                {Array.from({ length: numPalettes }, (_, i) => (
                  <button
                    key={i}
                    className={`tex-palette-option ${i === paletteIndex ? 'active' : ''}`}
                    onClick={() => handleSelectPalette(i)}
                  >
                    Palette {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="tex-zoom-controls">
          <button 
            className="tex-zoom-btn" 
            onClick={handleZoomOut}
            disabled={zoom === ZOOM_LEVELS[0]}
            title="Zoom out"
          >
            −
          </button>
          <span className="tex-zoom-level">{zoom}%</span>
          <button 
            className="tex-zoom-btn" 
            onClick={handleZoomIn}
            disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            title="Zoom in"
          >
            +
          </button>
        </div>
        <button className="tex-download-btn" onClick={handleDownload}>
          Download PNG
        </button>
      </div>
      
      <div className="tex-canvas-container">
        <canvas 
          ref={canvasRef} 
          className="tex-canvas" 
          style={{ 
            width: `${width * zoom / 100}px`, 
            height: `${height * zoom / 100}px` 
          }}
        />
      </div>
      
      <div className="tex-info">
        <span>{width} × {height}</span>
        {numPalettes > 1 && <span>{numPalettes} palettes</span>}
      </div>
    </div>
  );
}
