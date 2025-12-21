import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { FieldFile } from '../fieldfile.ts';
import './FieldPreview.css';

// Simple cache for parsed FieldFile objects to avoid re-parsing
const fieldFileCache = new Map();
const MAX_CACHE_SIZE = 10;

function getFieldFileCached(data) {
    const key = `${data.length}-${data[0]}-${data[data.length - 1]}`;

    if (fieldFileCache.has(key)) {
        const cached = fieldFileCache.get(key);
        fieldFileCache.delete(key);
        fieldFileCache.set(key, cached);
        return cached;
    }

    const fieldFile = new FieldFile(data);

    if (fieldFileCache.size >= MAX_CACHE_SIZE) {
        const firstKey = fieldFileCache.keys().next().value;
        fieldFileCache.delete(firstKey);
    }

    fieldFileCache.set(key, fieldFile);
    return fieldFile;
}

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const LAYER_NAMES = ['Layer 0 (Base)', 'Layer 1 (Animated)', 'Layer 2 (Back)', 'Layer 3 (Front)'];

export function FieldPreview({ data }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [zoom, setZoom] = useState(1);
    const [layerVisibility, setLayerVisibility] = useState([true, true, true, true]);
    const [showGrid, setShowGrid] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });

    const { field, background, dimensions, error } = useMemo(() => {
        try {
            const parsedField = getFieldFileCached(data);
            const bg = parsedField.getBackgroundSection();
            const dims = parsedField.getBackgroundDimensions();
            return {
                field: parsedField,
                background: bg,
                dimensions: dims,
                error: null,
            };
        } catch (err) {
            return { field: null, background: null, dimensions: null, error: err.message };
        }
    }, [data]);

    // Cache for decoded textures (textureID-paletteID -> ImageData)
    const textureCache = useRef(new Map());

    // Get or create texture ImageData
    const getTextureImageData = useCallback((textureID, paletteID) => {
        if (!field) {
            console.warn('getTextureImageData called with no field');
            return null;
        }

        const cacheKey = `${textureID}-${paletteID}`;
        if (textureCache.current.has(cacheKey)) {
            return textureCache.current.get(cacheKey);
        }

        const rgba = field.getTextureRGBA(textureID, paletteID);
        if (!rgba) {
            console.warn(`field.getTextureRGBA(${textureID}, ${paletteID}) returned null`);
            return null;
        }

        const imageData = new ImageData(rgba, 256, 256);
        textureCache.current.set(cacheKey, imageData);
        return imageData;
    }, [field]);

    // Render the background to canvas
    useEffect(() => {
        if (!field || !background || !dimensions || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        // Set canvas size to actual background dimensions
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Create offscreen canvas for texture operations
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = 256;
        textureCanvas.height = 256;
        const textureCtx = textureCanvas.getContext('2d');


        // Get tiles sorted by render order
        const sortedTiles = field.getTilesByRenderOrder();

        // Render each tile
        for (const { tile, layerIndex } of sortedTiles) {
            // Skip if layer is hidden
            if (!layerVisibility[layerIndex]) continue;

            // For tiles with conditional visibility (param != 0) on layers 1-3,
            // only render the first state variant at each location
            // Layer 0 ignores param/state fields according to the format spec
            if (layerIndex !== 0 && tile.param !== 0 && tile.state !== 1) continue;

            // When blending is enabled on layers 1-3, use secondary texture/coords
            // Layer 0 ignores blending flag
            const useBlending = tile.blending && layerIndex !== 0;
            const textureID = useBlending ? tile.textureID2 : tile.textureID;
            const imageData = getTextureImageData(textureID, tile.paletteID);
            if (!imageData) continue;

            // Draw texture to offscreen canvas
            textureCtx.putImageData(imageData, 0, 0);

            // Get source coordinates - use secondary coords when blending
            const srcX = useBlending ? tile.srcX2 : tile.srcX;
            const srcY = useBlending ? tile.srcY2 : tile.srcY;

            // Calculate destination position (offset by minX/minY to normalize to 0,0)
            const dstX = tile.dstX - dimensions.minX;
            const dstY = tile.dstY - dimensions.minY;

            // Determine tile size - Layer 0/1 are always 16x16, Layer 2/3 are always 32x32
            const tileSize = (layerIndex <= 1) ? 16 : 32;

            if (useBlending) {
                // Apply blend mode based on blendType (typeTrans)
                // 0: 50% bg + 50% fg (average)
                // 1: 100% bg + 100% fg (additive)
                // 2: 100% bg - 100% fg (subtractive)
                // 3: 100% bg + 25% fg

                // Get the background pixels at this location
                const bgData = ctx.getImageData(dstX, dstY, tileSize, tileSize);

                // Get the foreground tile pixels
                const fgData = textureCtx.getImageData(srcX, srcY, tileSize, tileSize);

                // Blend pixels
                const blendType = tile.blendType;
                for (let i = 0; i < bgData.data.length; i += 4) {
                    const bgR = bgData.data[i];
                    const bgG = bgData.data[i + 1];
                    const bgB = bgData.data[i + 2];

                    const fgR = fgData.data[i];
                    const fgG = fgData.data[i + 1];
                    const fgB = fgData.data[i + 2];
                    const fgA = fgData.data[i + 3];

                    // Skip transparent foreground pixels
                    if (fgA === 0) continue;

                    let r, g, b;
                    switch (blendType) {
                        case 0: // Average: 50% bg + 50% fg
                            r = (bgR + fgR) >> 1;
                            g = (bgG + fgG) >> 1;
                            b = (bgB + fgB) >> 1;
                            break;
                        case 1: // Additive: 100% bg + 100% fg
                            r = Math.min(255, bgR + fgR);
                            g = Math.min(255, bgG + fgG);
                            b = Math.min(255, bgB + fgB);
                            break;
                        case 2: // Subtractive: 100% bg - 100% fg
                            r = Math.max(0, bgR - fgR);
                            g = Math.max(0, bgG - fgG);
                            b = Math.max(0, bgB - fgB);
                            break;
                        case 3: // 100% bg + 25% fg
                            r = Math.min(255, bgR + (fgR >> 2));
                            g = Math.min(255, bgG + (fgG >> 2));
                            b = Math.min(255, bgB + (fgB >> 2));
                            break;
                        default:
                            r = fgR;
                            g = fgG;
                            b = fgB;
                    }

                    bgData.data[i] = r;
                    bgData.data[i + 1] = g;
                    bgData.data[i + 2] = b;
                    bgData.data[i + 3] = 255;
                }

                // Put the blended result back
                ctx.putImageData(bgData, dstX, dstY);
            } else {
                // Non-blending tile - just draw normally
                ctx.drawImage(
                    textureCanvas,
                    srcX, srcY, tileSize, tileSize,
                    dstX, dstY, tileSize, tileSize
                );
            }
        }

        // Draw grid overlay if enabled
        if (showGrid) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;

            // Draw 16x16 grid
            for (let x = 0; x <= canvas.width; x += 16) {
                ctx.beginPath();
                ctx.moveTo(x + 0.5, 0);
                ctx.lineTo(x + 0.5, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y <= canvas.height; y += 16) {
                ctx.beginPath();
                ctx.moveTo(0, y + 0.5);
                ctx.lineTo(canvas.width, y + 0.5);
                ctx.stroke();
            }
        }
    }, [field, background, dimensions, layerVisibility, showGrid, getTextureImageData]);

    // Clear texture cache when field changes
    useEffect(() => {
        textureCache.current.clear();
    }, [field]);

    // Pan handlers
    const handleMouseDown = (e) => {
        if (e.button === 0) {
            setIsPanning(true);
            setLastPanPos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseMove = (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPanPos.x;
            const dy = e.clientY - lastPanPos.y;
            setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
            setLastPanPos({ x: e.clientX, y: e.clientY });
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
    };

    // Wheel zoom
    const handleWheel = (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;
            const currentIndex = ZOOM_LEVELS.findIndex(z => z >= zoom);
            const newIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, currentIndex + delta));
            setZoom(ZOOM_LEVELS[newIndex]);
        }
    };

    const toggleLayer = (index) => {
        setLayerVisibility(prev => {
            const next = [...prev];
            next[index] = !next[index];
            return next;
        });
    };

    const resetView = () => {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
    };

    if (error) {
        return (
            <div className="field-error">
                <div className="field-error-icon">!</div>
                <div className="field-error-text">Failed to parse Field file</div>
                <div className="field-error-detail">{error}</div>
            </div>
        );
    }

    const layerStats = background?.layers.map((layer, i) => ({
        exists: layer.exists,
        tileCount: layer.tileCount,
        name: LAYER_NAMES[i],
    })) || [];

    const textureCount = background?.textures.filter(t => t !== null).length || 0;

    return (
        <div className="field-preview">
            <div className="field-toolbar">
                <div className="field-toolbar-group">
                    <span className="field-toolbar-label">Zoom:</span>
                    <div className="field-segmented">
                        {ZOOM_LEVELS.map(z => (
                            <button
                                key={z}
                                className={`field-segment ${zoom === z ? 'active' : ''}`}
                                onClick={() => setZoom(z)}
                            >
                                {z * 100}%
                            </button>
                        ))}
                    </div>
                </div>

                <div className="field-toolbar-group">
                    <span className="field-toolbar-label">Layers:</span>
                    <div className="field-segmented">
                        {layerStats.map((layer, i) => (
                            <button
                                key={i}
                                className={`field-segment ${layerVisibility[i] ? 'active' : ''} ${!layer.exists ? 'disabled' : ''}`}
                                onClick={() => layer.exists && toggleLayer(i)}
                                disabled={!layer.exists}
                                title={`${layer.name}: ${layer.tileCount} tiles`}
                            >
                                {i}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="field-toolbar-group">
                    <button
                        className={`field-toggle ${showGrid ? 'active' : ''}`}
                        onClick={() => setShowGrid(!showGrid)}
                        title="Show tile grid"
                    >
                        Grid
                    </button>
                    <button
                        className="field-toggle"
                        onClick={resetView}
                        title="Reset zoom and pan"
                    >
                        Reset
                    </button>
                </div>

                <div className="field-toolbar-info">
                    <span>{dimensions?.width}×{dimensions?.height}</span>
                    <span>{textureCount} textures</span>
                </div>
            </div>

            <div
                ref={containerRef}
                className="field-canvas-container"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
            >
                <div
                    className="field-canvas-wrapper"
                    style={{
                        transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
                    }}
                >
                    <canvas
                        ref={canvasRef}
                        className="field-canvas"
                    />
                </div>
            </div>
        </div>
    );
}
