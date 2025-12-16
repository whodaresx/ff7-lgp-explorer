import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import JSZip from 'jszip';
import { TexFile } from '../texfile.ts';
import { usePersistedState } from '../utils/settings.ts';
import './TexPreview.css';

const ZOOM_LEVELS = [10, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];

export function TexPreview({ data, filename }) {
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [paletteDropdownOpen, setPaletteDropdownOpen] = useState(false);
  const [showAllPalettes, setShowAllPalettes] = usePersistedState('showAllPalettes');
  const canvasRef = useRef(null);
  const canvasRefsArray = useRef([]);
  const paletteDropdownRef = useRef(null);
  const gridContainerRef = useRef(null);
  const hasAutoZoomedRef = useRef(false);

  const { tex, error } = useMemo(() => {
    try {
      const texFile = new TexFile(data);
      return { tex: texFile, error: null };
    } catch (err) {
      return { tex: null, error: err.message };
    }
  }, [data]);

  // Reset zoom and auto-zoom flag when image changes
  useEffect(() => {
    setZoom(100);
    hasAutoZoomedRef.current = false;
  }, [data]);

  useEffect(() => {
    if (!tex || showAllPalettes) return;
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = tex.data;

    canvas.width = width;
    canvas.height = height;

    const pixels = tex.getPixels(paletteIndex);
    const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(imageData, 0, 0);
  }, [tex, paletteIndex, showAllPalettes]);

  useEffect(() => {
    if (!tex || !showAllPalettes) return;

    const { width, height, numPalettes } = tex.data;

    for (let i = 0; i < numPalettes; i++) {
      const canvas = canvasRefsArray.current[i];
      if (!canvas) continue;

      const ctx = canvas.getContext('2d');
      canvas.width = width;
      canvas.height = height;

      const pixels = tex.getPixels(i);
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      ctx.putImageData(imageData, 0, 0);
    }
  }, [tex, showAllPalettes]);

  const handleDownload = useCallback(async () => {
    if (showAllPalettes) {
      // Grid mode: create zip with all palettes
      const baseName = filename.replace(/\.[^.]+$/, '');
      const zip = new JSZip();

      // Collect all canvas blobs as promises
      const blobPromises = [];
      for (let i = 0; i < tex.data.numPalettes; i++) {
        const canvas = canvasRefsArray.current[i];
        if (!canvas) continue;

        const promise = new Promise((resolve) => {
          canvas.toBlob((blob) => {
            if (blob) {
              zip.file(`${baseName}_pal${i}.png`, blob);
            }
            resolve();
          }, 'image/png');
        });
        blobPromises.push(promise);
      }

      // Wait for all blobs to be added to zip
      await Promise.all(blobPromises);

      // Generate and download zip
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}_palettes.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Single mode: existing logic
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
    }
  }, [filename, paletteIndex, tex, showAllPalettes]);

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

  // Calculate grid dimensions for palette grid view
  const getGridDimensions = useCallback((paletteCount, width, height) => {
    const aspectRatio = width / height;
    const isWide = aspectRatio >= 1.5;

    // For wide images, prefer fewer columns to make better use of horizontal space
    if (isWide) {
      if (paletteCount >= 5 && paletteCount <= 6) {
        return { cols: 2, rows: 3 };
      }
      if (paletteCount >= 7 && paletteCount <= 8) {
        return { cols: 2, rows: 4 };
      }
    }

    // Default: use square-ish grid
    const cols = Math.ceil(Math.sqrt(paletteCount));
    const rows = Math.ceil(paletteCount / cols);
    return { cols, rows };
  }, []);

  const gridDimensions = useMemo(() => {
    if (!showAllPalettes || !tex) return null;
    const { width, height, numPalettes } = tex.data;
    return getGridDimensions(numPalettes, width, height);
  }, [showAllPalettes, tex, getGridDimensions]);

  // Reset auto-zoom flag when exiting grid mode
  useEffect(() => {
    if (!showAllPalettes) {
      hasAutoZoomedRef.current = false;
    }
  }, [showAllPalettes]);

  // Auto-adjust zoom to fit all palettes in grid view (only once per grid session)
  useEffect(() => {
    if (!showAllPalettes || !tex || !gridContainerRef.current || !gridDimensions) return;
    if (hasAutoZoomedRef.current) return; // Skip if already auto-zoomed

    const container = gridContainerRef.current;
    const { width, height } = tex.data;
    const { cols, rows } = gridDimensions;

    // Wait for next frame to get accurate container dimensions
    requestAnimationFrame(() => {
      if (!container) return;

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // Account for padding (16px) and gaps (16px between cells)
      const padding = 16;
      const gap = 16;
      const availableWidth = containerWidth - padding * 2 - gap * (cols - 1);
      const availableHeight = containerHeight - padding * 2 - gap * (rows - 1);

      // Account for cell padding (12px each side) and footer height (~28px)
      const cellPadding = 12 * 2;
      const footerHeight = 28;
      const maxCellWidth = availableWidth / cols;
      const maxCellHeight = availableHeight / rows;

      // Calculate max image dimensions per cell
      const maxImageWidth = maxCellWidth - cellPadding;
      const maxImageHeight = maxCellHeight - cellPadding - footerHeight;

      // Calculate zoom level needed to fit
      const zoomToFitWidth = (maxImageWidth / width) * 100;
      const zoomToFitHeight = (maxImageHeight / height) * 100;
      const optimalZoom = Math.min(zoomToFitWidth, zoomToFitHeight, 100);

      // Find closest zoom level that fits
      const fittingZoom = ZOOM_LEVELS.filter(z => z <= optimalZoom).pop() || ZOOM_LEVELS[0];

      // Only adjust zoom if current zoom would cause overflow and fittingZoom is lower
      if (zoom > fittingZoom) {
        setZoom(fittingZoom);
      } else if (zoom < 100 && optimalZoom >= 100) {
        // If everything fits at 100%, reset to 100%
        setZoom(100);
      }

      // Mark that we've performed auto-zoom for this grid session
      hasAutoZoomedRef.current = true;
    });
  }, [showAllPalettes, tex, gridDimensions, zoom]);

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
              disabled={paletteIndex === 0 || showAllPalettes}
              title="Previous palette"
            >
              ‹
            </button>
            <button
              className="tex-palette-btn tex-palette-current"
              onClick={() => setPaletteDropdownOpen(!paletteDropdownOpen)}
              disabled={showAllPalettes}
            >
              Palette {paletteIndex + 1}
              <span className="tex-palette-arrow">▾</span>
            </button>
            <button
              className="tex-palette-btn tex-palette-nav"
              onClick={handleNextPalette}
              disabled={paletteIndex === numPalettes - 1 || showAllPalettes}
              title="Next palette"
            >
              ›
            </button>
            <button
              className="tex-palette-btn tex-show-all-btn"
              onClick={() => setShowAllPalettes(!showAllPalettes)}
              title={showAllPalettes ? "Show single palette" : "Show all palettes"}
            >
              {showAllPalettes ? "Single" : "Show All"}
            </button>
            {!showAllPalettes && paletteDropdownOpen && (
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
          {showAllPalettes && numPalettes > 1 ? 'Download All as PNG' : 'Download as PNG'}
        </button>
      </div>
      
      {showAllPalettes ? (
        <div className="tex-grid-container" ref={gridContainerRef}>
          <div className="tex-grid">
            {Array.from({ length: numPalettes }, (_, i) => {
              const cellWidth = `calc((100% - ${(gridDimensions.cols - 1) * 16}px) / ${gridDimensions.cols})`;

              return (
                <div
                  key={i}
                  className="tex-grid-cell"
                  style={{ flexBasis: cellWidth, maxWidth: cellWidth }}
                >
                  <div className="tex-grid-canvas-wrapper">
                    <canvas
                      ref={(el) => canvasRefsArray.current[i] = el}
                      className="tex-canvas"
                      style={{
                        width: `${width * zoom / 100}px`,
                        height: `${height * zoom / 100}px`
                      }}
                    />
                  </div>
                  <div className="tex-grid-cell-footer">
                    Palette {i + 1}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
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
      )}
      
      <div className="tex-info">
        <span>{width} × {height}</span>
        {numPalettes > 1 && <span>{numPalettes} palettes</span>}
      </div>
    </div>
  );
}
