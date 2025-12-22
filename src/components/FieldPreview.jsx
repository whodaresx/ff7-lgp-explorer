import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { FieldFile } from '../fieldfile.ts';
import { WalkmeshPreview } from './WalkmeshPreview.jsx';
import './FieldPreview.css';

// Simple cache for parsed FieldFile objects to avoid re-parsing
const fieldFileCache = new Map();
const MAX_CACHE_SIZE = 10;

function getFieldFileCached(data) {
    // Create a stronger cache key by sampling multiple bytes throughout the data
    // This prevents collisions between different files with same length/boundaries
    const len = data.length;
    const samples = [
        data[0],
        data[Math.floor(len * 0.25)],
        data[Math.floor(len * 0.5)],
        data[Math.floor(len * 0.75)],
        data[len - 1]
    ];
    const key = `${len}-${samples.join('-')}`;

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

const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200, 300, 400];
const LAYER_NAMES = ['Layer 0 (Base)', 'Layer 1 (Animated)', 'Layer 2 (Back)', 'Layer 3 (Front)'];

export function FieldPreview({ data }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [viewMode, setViewMode] = useState('background'); // 'background' | 'walkmesh'
    const [zoom, setZoom] = useState(100);
    const [layerVisibility, setLayerVisibility] = useState([true, true, true, true]);
    const [showGrid, setShowGrid] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [lastPanPos, setLastPanPos] = useState({ x: 0, y: 0 });
    const [paramsDropdownOpen, setParamsDropdownOpen] = useState(false);
    const paramsDropdownRef = useRef(null);

    // Walkmesh-specific state
    const [walkmeshWireframe, setWalkmeshWireframe] = useState(true);
    const [walkmeshShowGateways, setWalkmeshShowGateways] = useState(true);
    const [walkmeshRotation, setWalkmeshRotation] = useState(0);
    const walkmeshResetRef = useRef(null);

    const { field, background, dimensions, walkmesh, gateways, error } = useMemo(() => {
        try {
            const parsedField = getFieldFileCached(data);
            const bg = parsedField.getBackgroundSection();
            const dims = parsedField.getBackgroundDimensions();
            const wm = parsedField.getWalkmeshSection();
            const gw = parsedField.getGateways();
            return {
                field: parsedField,
                background: bg,
                dimensions: dims,
                walkmesh: wm,
                gateways: gw,
                error: null,
            };
        } catch (err) {
            return { field: null, background: null, dimensions: null, walkmesh: null, gateways: [], error: err.message };
        }
    }, [data]);

    // Collect unique params and which state bits are used for each
    const { conditionalParams, paramUsedBits } = useMemo(() => {
        if (!field || !background) return { conditionalParams: [], paramUsedBits: {} };
        const params = new Set();
        const usedBits = {}; // { [param]: bitmask of all state bits used by tiles }
        for (const layer of background.layers) {
            if (!layer.exists) continue;
            for (const tile of layer.tiles) {
                if (tile.param !== 0) {
                    params.add(tile.param);
                    usedBits[tile.param] = (usedBits[tile.param] || 0) | tile.state;
                }
            }
        }
        return {
            conditionalParams: Array.from(params).sort((a, b) => a - b),
            paramUsedBits: usedBits
        };
    }, [field, background]);

    // State for param bitmasks - stores which state bits are active for each param
    // Default is 0x00 (all bits off) so conditional tiles are hidden by default
    const [paramBitmasks, setParamBitmasks] = useState({});

    // Compute effective param bitmasks: default is 0x00, user can override
    const paramStates = useMemo(() => {
        const states = {};
        for (const param of conditionalParams) {
            // Default to 0x00 (all off), unless user has customized it
            states[param] = paramBitmasks[param] !== undefined ? paramBitmasks[param] : 0x00;
        }
        return states;
    }, [conditionalParams, paramBitmasks]);

    // Reset state when data changes (new field loaded)
    const prevDataRef = useRef(data);
    /* eslint-disable react-hooks/set-state-in-effect */
    useEffect(() => {
        if (data !== prevDataRef.current) {
            prevDataRef.current = data;
            setParamBitmasks({});
            setLayerVisibility([true, true, true, true]);
            setWalkmeshRotation(0);
        }
    }, [data]);
    /* eslint-enable react-hooks/set-state-in-effect */

    // Close params dropdown on outside click
    useEffect(() => {
        if (!paramsDropdownOpen) return;

        const handleClickOutside = (e) => {
            if (paramsDropdownRef.current && !paramsDropdownRef.current.contains(e.target)) {
                setParamsDropdownOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [paramsDropdownOpen]);

    // Cache for decoded textures (textureID-paletteID -> Canvas with pre-rendered texture)
    // Using Canvas instead of ImageData to avoid Safari/WebKit race conditions
    // with putImageData/drawImage on offscreen canvases
    const textureCache = useRef(new Map());
    // Track which field the cache belongs to (for synchronous invalidation)
    const textureCacheFieldRef = useRef(null);

    // Get or create texture canvas (pre-rendered for better Safari compatibility)
    const getTextureCanvas = useCallback((textureID, paletteID) => {
        if (!field) return null;

        // Clear cache synchronously if field changed (prevents stale texture flash)
        if (textureCacheFieldRef.current !== field) {
            textureCache.current.clear();
            textureCacheFieldRef.current = field;
        }

        const cacheKey = `${textureID}-${paletteID}`;
        if (textureCache.current.has(cacheKey)) {
            return textureCache.current.get(cacheKey);
        }

        const rgba = field.getTextureRGBA(textureID, paletteID);
        if (!rgba) return null;

        // Create a canvas and pre-render the texture to it
        // This avoids repeated putImageData calls during tile rendering,
        // which can cause race conditions in Safari/WebKit
        const textureCanvas = document.createElement('canvas');
        textureCanvas.width = 256;
        textureCanvas.height = 256;
        const textureCtx = textureCanvas.getContext('2d');
        const imageData = new ImageData(rgba, 256, 256);
        textureCtx.putImageData(imageData, 0, 0);

        textureCache.current.set(cacheKey, textureCanvas);
        return textureCanvas;
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

        // Get tiles sorted by render order
        const sortedTiles = field.getTilesByRenderOrder();

        // Render each tile
        for (const { tile, layerIndex } of sortedTiles) {
            // Skip if layer is hidden
            if (!layerVisibility[layerIndex]) continue;

            // For tiles with conditional visibility (param != 0) on layers 1-3,
            // check if the tile's state matches the user's selected bitmask for this param
            // Layer 0 ignores param/state fields according to the format spec
            if (layerIndex !== 0 && tile.param !== 0) {
                const activeBitmask = paramStates[tile.param] ?? 0xFF;
                // Tile is visible if any of its state bits overlap with the active bitmask
                if ((tile.state & activeBitmask) === 0) {
                    continue;
                }
            }

            // When blending is enabled on layers 1-3, use secondary texture/coords
            // Layer 0 ignores blending flag
            const useBlending = tile.blending && layerIndex !== 0;
            const textureID = useBlending ? tile.textureID2 : tile.textureID;

            // Get pre-rendered texture canvas (avoids putImageData in render loop)
            const textureCanvas = getTextureCanvas(textureID, tile.paletteID);
            if (!textureCanvas) continue;

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

                // Get the foreground tile pixels from the cached texture canvas
                const textureCtx = textureCanvas.getContext('2d');
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
    }, [field, background, dimensions, layerVisibility, showGrid, getTextureCanvas, paramStates, viewMode]);

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
            const currentIndex = ZOOM_LEVELS.indexOf(zoom);
            const effectiveIndex = currentIndex === -1 ? ZOOM_LEVELS.findIndex(z => z >= zoom) : currentIndex;
            const newIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, effectiveIndex + delta));
            setZoom(ZOOM_LEVELS[newIndex]);
        }
    };

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

    const toggleLayer = (index) => {
        setLayerVisibility(prev => {
            const next = [...prev];
            next[index] = !next[index];
            return next;
        });
    };

    const toggleParamBit = (param, bit) => {
        const currentMask = paramStates[param] ?? 0x00;
        const newMask = currentMask ^ (1 << bit); // XOR to toggle the bit
        setParamBitmasks(prev => ({
            ...prev,
            [param]: newMask
        }));
    };

    const cycleParamBit = (param) => {
        const currentMask = paramStates[param] ?? 0x00;
        const usedBits = paramUsedBits[param] || 0;

        // Find enabled bits (bits that have tiles)
        const enabledBits = [];
        for (let bit = 0; bit < 8; bit++) {
            if (usedBits & (1 << bit)) {
                enabledBits.push(bit);
            }
        }

        if (enabledBits.length === 0) return;

        // Find current active bit (the single bit that's on, if any)
        let currentBitIndex = -1;
        for (let i = 0; i < enabledBits.length; i++) {
            const bit = enabledBits[i];
            if (currentMask === (1 << bit)) {
                currentBitIndex = i;
                break;
            }
        }

        // Cycle to next enabled bit
        const nextBitIndex = (currentBitIndex + 1) % enabledBits.length;
        const nextBit = enabledBits[nextBitIndex];

        setParamBitmasks(prev => ({
            ...prev,
            [param]: 1 << nextBit
        }));
    };

    const resetView = () => {
        setZoom(100);
        setPanOffset({ x: 0, y: 0 });
    };

    // Walkmesh controls
    const handleWalkmeshRotateLeft = useCallback(() => {
        setWalkmeshRotation(prev => prev + Math.PI / 4);
    }, []);

    const handleWalkmeshRotateRight = useCallback(() => {
        setWalkmeshRotation(prev => prev - Math.PI / 4);
    }, []);

    const handleWalkmeshReset = useCallback(() => {
        setWalkmeshRotation(0);
        if (walkmeshResetRef.current) {
            walkmeshResetRef.current();
        }
    }, []);

    const handleWalkmeshResetCallback = useCallback((resetFn) => {
        walkmeshResetRef.current = resetFn;
    }, []);

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
                {/* View mode selector */}
                <div className="field-view-selector">
                    <button
                        className={viewMode === 'background' ? 'active' : ''}
                        onClick={() => setViewMode('background')}
                        title="Background preview"
                    >
                        Background
                    </button>
                    <button
                        className={viewMode === 'walkmesh' ? 'active' : ''}
                        onClick={() => setViewMode('walkmesh')}
                        title="Walkmesh preview"
                    >
                        Walkmesh
                    </button>
                </div>

                {/* Background mode controls */}
                {viewMode === 'background' && (
                    <>
                        <div className="field-layer-selector">
                            {layerStats.map((layer, i) => (
                                <button
                                    key={i}
                                    className={`field-layer-btn ${layerVisibility[i] ? 'active' : ''} ${!layer.exists ? 'disabled' : ''}`}
                                    onClick={() => layer.exists && toggleLayer(i)}
                                    disabled={!layer.exists}
                                    title={`${layer.name}: ${layer.tileCount} tiles`}
                                >
                                    L{i}
                                </button>
                            ))}
                        </div>

                        {conditionalParams.length > 0 && (
                            <div className="field-params-selector" ref={paramsDropdownRef}>
                                <button
                                    className={`field-params-btn ${paramsDropdownOpen ? 'active' : ''}`}
                                    onClick={() => setParamsDropdownOpen(!paramsDropdownOpen)}
                                    title="Toggle conditional tile states"
                                >
                                    Params
                                    <span className="field-params-arrow">▾</span>
                                </button>
                                {paramsDropdownOpen && (
                                    <div className="field-params-dropdown">
                                        {conditionalParams.map(param => {
                                            const mask = paramStates[param] ?? 0x00;
                                            const usedBits = paramUsedBits[param] || 0;
                                            return (
                                                <div key={param} className="field-param-row">
                                                    <span className="field-param-label">#{param}</span>
                                                    <div className="field-param-bits">
                                                        {[0, 1, 2, 3, 4, 5, 6, 7].map(bit => {
                                                            const bitMask = 1 << bit;
                                                            const isUsed = (usedBits & bitMask) !== 0;
                                                            const isActive = (mask & bitMask) !== 0;
                                                            return (
                                                                <button
                                                                    key={bit}
                                                                    className={`field-param-bit ${isActive ? 'active' : ''} ${!isUsed ? 'disabled' : ''}`}
                                                                    onClick={() => isUsed && toggleParamBit(param, bit)}
                                                                    disabled={!isUsed}
                                                                    title={isUsed ? `Bit ${bit}: ${isActive ? 'On' : 'Off'}` : `Bit ${bit}: No tiles`}
                                                                >
                                                                    {bit}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* Only show cycle button if there are 2+ enabled states */}
                                                    {(usedBits & (usedBits - 1)) !== 0 && (
                                                        <button
                                                            className="field-param-cycle"
                                                            onClick={() => cycleParamBit(param)}
                                                            title="Cycle through states"
                                                        >
                                                            ⟳
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="field-zoom-controls">
                            <button
                                className="field-zoom-btn"
                                onClick={handleZoomOut}
                                disabled={zoom === ZOOM_LEVELS[0]}
                                title="Zoom out"
                            >
                                −
                            </button>
                            <span className="field-zoom-level">{zoom}%</span>
                            <button
                                className="field-zoom-btn"
                                onClick={handleZoomIn}
                                disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                                title="Zoom in"
                            >
                                +
                            </button>
                        </div>

                        <button
                            className={`field-toggle-btn ${showGrid ? 'active' : ''}`}
                            onClick={() => setShowGrid(!showGrid)}
                            title="Show tile grid"
                        >
                            Grid
                        </button>

                        <button
                            className="field-toggle-btn"
                            onClick={resetView}
                            title="Reset zoom and pan"
                        >
                            Reset
                        </button>

                    </>
                )}

                {/* Walkmesh mode controls */}
                {viewMode === 'walkmesh' && (
                    <>
                        <button
                            className={`field-toggle-btn ${walkmeshWireframe ? 'active' : ''}`}
                            onClick={() => setWalkmeshWireframe(!walkmeshWireframe)}
                            title="Toggle wireframe"
                        >
                            Wire
                        </button>

                        <button
                            className={`field-toggle-btn ${walkmeshShowGateways ? 'active' : ''}`}
                            onClick={() => setWalkmeshShowGateways(!walkmeshShowGateways)}
                            title="Toggle gateways"
                        >
                            Gates
                        </button>

                        <button
                            className="field-rotate-btn"
                            onClick={handleWalkmeshRotateLeft}
                            title="Rotate left 45°"
                        >
                            ↺
                        </button>

                        <button
                            className="field-rotate-btn"
                            onClick={handleWalkmeshRotateRight}
                            title="Rotate right 45°"
                        >
                            ↻
                        </button>

                        <button
                            className="field-toggle-btn"
                            onClick={handleWalkmeshReset}
                            title="Reset view"
                        >
                            Reset
                        </button>
                    </>
                )}
            </div>

            {/* Background mode content */}
            {viewMode === 'background' && (
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
                            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom / 100})`,
                        }}
                    >
                        <canvas
                            ref={canvasRef}
                            className="field-canvas"
                        />
                    </div>
                </div>
            )}

            {/* Walkmesh mode content */}
            {viewMode === 'walkmesh' && (
                <WalkmeshPreview
                    walkmesh={walkmesh}
                    gateways={gateways}
                    wireframe={walkmeshWireframe}
                    showGateways={walkmeshShowGateways}
                    rotation={walkmeshRotation}
                    onResetRequest={handleWalkmeshResetCallback}
                />
            )}

            {/* Footer info bar */}
            <div className="field-info">
                {viewMode === 'background' ? (
                    <>
                        <span>{dimensions?.width}×{dimensions?.height}</span>
                        <span>{textureCount} textures</span>
                    </>
                ) : (
                    <>
                        <span>{walkmesh?.triangleCount || 0} triangles</span>
                        {gateways?.length > 0 && <span>{gateways.length} gateways</span>}
                    </>
                )}
            </div>
        </div>
    );
}
