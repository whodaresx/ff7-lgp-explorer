// FF7 PC Field file parser
// Field files are LZSS compressed and contain 9 sections
// The compressed data has a 4-byte header with the compressed size before the LZSS data

import { Lzss } from './lzss.ts';

// ============================================================================
// Section Pointer Types
// ============================================================================

export interface FieldSection {
    offset: number;      // Pointer from header
    length: number;      // Length stored at start of section
    dataOffset: number;  // Actual data start (offset + 4)
}

export interface FieldData {
    numSections: number;
    sections: {
        script: FieldSection;       // Section 1: Field Script & Dialog
        camera: FieldSection;       // Section 2: Camera Matrix
        modelLoader: FieldSection;  // Section 3: Model Loader
        palette: FieldSection;      // Section 4: Palette
        walkmesh: FieldSection;     // Section 5: Walkmesh
        tileMap: FieldSection;      // Section 6: TileMap (Unused)
        encounter: FieldSection;    // Section 7: Encounter
        triggers: FieldSection;     // Section 8: Triggers
        background: FieldSection;   // Section 9: Background
    };
    decompressedSize: number;
    compressedSize: number;
}

// ============================================================================
// Palette Section (Section 4) Types
// ============================================================================

export interface PaletteColor {
    r: number;  // 0-255
    g: number;  // 0-255
    b: number;  // 0-255
    a: number;  // 0-255 (255 = opaque, 0 = transparent)
}

export interface Palette {
    colors: PaletteColor[];  // 256 colors
}

export interface PaletteSection {
    totalSize: number;
    x: number;           // Always 0
    y: number;           // Always 480
    width: number;       // Always 256
    paletteCount: number;
    palettes: Palette[];
}

// ============================================================================
// Background Section (Section 9) Types
// ============================================================================

/** Transparency blend types for tiles */
export enum BlendType {
    Average = 0,      // 50% bg + 50% fg
    Additive = 1,     // 100% bg + 100% fg
    Subtractive = 2,  // 100% bg - 100% fg
    Additive25 = 3,   // 100% bg + 25% fg
}

/** 52-byte tile structure used in all layers */
export interface BackgroundTile {
    // Destination coordinates on screen
    dstX: number;           // int16 @ 0x00
    dstY: number;           // int16 @ 0x02

    // Source coordinates in texture
    srcX: number;           // uint8 @ 0x08
    srcY: number;           // uint8 @ 0x0A

    // Secondary source for blending (layers 1-3)
    srcX2: number;          // uint8 @ 0x0C
    srcY2: number;          // uint8 @ 0x0E

    // Tile dimensions
    width: number;          // uint16 @ 0x10
    height: number;         // uint16 @ 0x12

    // Rendering properties
    paletteID: number;      // uint8 @ 0x14
    zOrder: number;         // uint16 @ 0x16 (ID field, 0-4096)
    param: number;          // uint8 @ 0x18 (conditional visibility)
    state: number;          // uint8 @ 0x19 (state bitmask)
    blending: boolean;      // uint8 @ 0x1A (0 or 1)
    blendType: BlendType;   // uint8 @ 0x1C (typeTrans)
    textureID: number;      // uint8 @ 0x1E
    textureID2: number;     // uint8 @ 0x20 (for blending)
    depth: number;          // uint8 @ 0x22
    subID: number;          // uint32 @ 0x24 (extended z-order)

    // Extended precision source coords (fixed-point × 10,000,000)
    srcXBig: number;        // uint32 @ 0x28
    srcYBig: number;        // uint32 @ 0x2C
}

/** Layer metadata */
export interface BackgroundLayer {
    exists: boolean;
    width: number;
    height: number;
    tileCount: number;
    tiles: BackgroundTile[];
}

/** Texture depth values */
export enum TextureDepth {
    Indexed4bpp = 0,   // 16 colors, 32KB
    Indexed8bpp = 1,   // 256 colors, 64KB
    Direct16bpp = 2,   // Direct color, 128KB
}

/** Texture entry */
export interface BackgroundTexture {
    exists: boolean;
    isBigTile: boolean;  // 0 = 16×16 tiles, 1 = 32×32 tiles
    depth: TextureDepth;
    data: Uint8Array;    // Raw pixel data
}

/** Background section header */
export interface BackgroundHeader {
    depth: number;           // 1 = paletted, 2 = direct color
    transparencyFlags: boolean[];  // 20 flags for palette transparency
}

/** Complete background section data */
export interface BackgroundSection {
    header: BackgroundHeader;
    layers: [BackgroundLayer, BackgroundLayer, BackgroundLayer, BackgroundLayer];
    textures: (BackgroundTexture | null)[];  // Up to 42 textures
}

// ============================================================================
// Walkmesh Section (Section 5) Types
// ============================================================================

export interface WalkmeshVertex {
    x: number;
    y: number;
    z: number;
}

export interface WalkmeshTriangle {
    vertices: [WalkmeshVertex, WalkmeshVertex, WalkmeshVertex];
    access: [number, number, number]; // Adjacent triangle IDs (0xFFFF = blocked)
}

export interface WalkmeshSection {
    triangleCount: number;
    triangles: WalkmeshTriangle[];
}

// ============================================================================
// Triggers Section (Section 8) Types - Gateways
// ============================================================================

export interface Gateway {
    vertex1: WalkmeshVertex;
    vertex2: WalkmeshVertex;
    fieldId: number;
}

export interface WalkmeshBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
}

// ============================================================================
// Color Conversion Utilities
// ============================================================================

/**
 * Convert PS1 BGR555 color to RGBA
 * Format: MBBB BBGG GGGR RRRR (bit 15 = mask/transparency)
 */
export function ps1ColorToRGBA(color16: number, transparentIndex0: boolean, isIndex0: boolean): PaletteColor {
    const r5 = color16 & 0x1F;
    const g5 = (color16 >> 5) & 0x1F;
    const b5 = (color16 >> 10) & 0x1F;
    // bit 15 is mask/transparency bit (unused in our conversion)

    // Convert 5-bit to 8-bit: R8 = (R5 << 3) | (R5 >> 2)
    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);

    // Index 0 transparency check
    let a = 255;
    if (isIndex0 && transparentIndex0 && color16 === 0) {
        a = 0;
    }

    return { r, g, b, a };
}

/**
 * Convert PC RGB16 color to RGBA
 * Format: RRRR RGGG GGXB BBBB (bit 5 = unused)
 * Special: 0x0000 = transparent, 0x0821 = opaque black
 */
export function pcColorToRGBA(color16: number): PaletteColor {
    // Special cases
    if (color16 === 0x0000) {
        return { r: 0, g: 0, b: 0, a: 0 };  // Fully transparent
    }
    if (color16 === 0x0821) {
        return { r: 0, g: 0, b: 0, a: 255 };  // Opaque black
    }

    const b5 = color16 & 0x1F;
    // bit 5 is unused
    const g5 = (color16 >> 6) & 0x1F;
    const r5 = (color16 >> 11) & 0x1F;

    const r = (r5 << 3) | (r5 >> 2);
    const g = (g5 << 3) | (g5 >> 2);
    const b = (b5 << 3) | (b5 >> 2);

    return { r, g, b, a: 255 };
}

// ============================================================================
// Palette Section Parser
// ============================================================================

export function parsePaletteSection(data: Uint8Array): PaletteSection {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const totalSize = view.getUint32(0x00, true);
    const x = view.getUint16(0x04, true);
    const y = view.getUint16(0x06, true);
    const width = view.getUint16(0x08, true);
    const paletteCount = view.getUint16(0x0A, true);

    const palettes: Palette[] = [];
    let offset = 0x0C;

    for (let p = 0; p < paletteCount; p++) {
        const colors: PaletteColor[] = [];
        // First: read index 0 color
        const color0_16 = view.getUint16(offset, true);
        const color0 = ps1ColorToRGBA(color0_16, false, true);
        colors.push(color0);

        // Read remaining colors, substituting (0,0,0) with index 0's color
        // PC FF7 quirk: any palette entry with raw value 0x0000 uses index 0's color instead
        for (let c = 1; c < 256; c++) {
            const color16 = view.getUint16(offset + c * 2, true);
            if (color16 === 0) {
                // Substitute with index 0's color (preserving that this was a zero entry for transparency)
                colors.push({ ...color0 });
            } else {
                colors.push(ps1ColorToRGBA(color16, false, false));
            }
        }
        offset += 256 * 2;
        palettes.push({ colors });
    }

    return {
        totalSize,
        x,
        y,
        width,
        paletteCount,
        palettes,
    };
}

// ============================================================================
// Background Section Parser
// ============================================================================

const TILE_SIZE = 52;
const TEXTURE_COUNT = 42;

function parseTile(view: DataView, offset: number): BackgroundTile {
    return {
        dstX: view.getInt16(offset + 0x00, true),
        dstY: view.getInt16(offset + 0x02, true),
        srcX: view.getUint8(offset + 0x08),
        srcY: view.getUint8(offset + 0x0A),
        srcX2: view.getUint8(offset + 0x0C),
        srcY2: view.getUint8(offset + 0x0E),
        width: view.getUint16(offset + 0x10, true),
        height: view.getUint16(offset + 0x12, true),
        paletteID: view.getUint8(offset + 0x14),
        zOrder: view.getUint16(offset + 0x16, true),
        param: view.getUint8(offset + 0x18),
        state: view.getUint8(offset + 0x19),
        blending: view.getUint8(offset + 0x1A) !== 0,
        blendType: view.getUint8(offset + 0x1C) as BlendType,
        textureID: view.getUint8(offset + 0x1E),
        textureID2: view.getUint8(offset + 0x20),
        depth: view.getUint8(offset + 0x22),
        subID: view.getUint32(offset + 0x24, true),
        srcXBig: view.getUint32(offset + 0x28, true),
        srcYBig: view.getUint32(offset + 0x2C, true),
    };
}

function parseLayer0(view: DataView, offset: number): { layer: BackgroundLayer; nextOffset: number } {
    const width = view.getInt16(offset + 0x00, true);
    const height = view.getInt16(offset + 0x02, true);
    const tileCount = view.getUint16(offset + 0x04, true);
    // depth at 0x06, padding at 0x08

    const tiles: BackgroundTile[] = [];
    let tileOffset = offset + 0x0C;  // Skip 12-byte header

    for (let i = 0; i < tileCount; i++) {
        tiles.push(parseTile(view, tileOffset));
        tileOffset += TILE_SIZE;
    }

    return {
        layer: { exists: true, width, height, tileCount, tiles },
        nextOffset: tileOffset,
    };
}

function parseLayer1(view: DataView, offset: number): { layer: BackgroundLayer; nextOffset: number } {
    const exists = view.getUint8(offset) !== 0;
    if (!exists) {
        return {
            layer: { exists: false, width: 0, height: 0, tileCount: 0, tiles: [] },
            nextOffset: offset + 1,
        };
    }

    const width = view.getInt16(offset + 0x01, true);
    const height = view.getInt16(offset + 0x03, true);
    const tileCount = view.getUint16(offset + 0x05, true);
    // HeaderLayer2TilePC (16 bytes) at 0x07, padding at 0x17 and 0x19

    const tiles: BackgroundTile[] = [];
    let tileOffset = offset + 0x1B;  // Skip header (1 + 2 + 2 + 2 + 16 + 2 + 2 = 27 bytes)

    for (let i = 0; i < tileCount; i++) {
        tiles.push(parseTile(view, tileOffset));
        tileOffset += TILE_SIZE;
    }

    return {
        layer: { exists: true, width, height, tileCount, tiles },
        nextOffset: tileOffset,
    };
}

function parseLayer2(view: DataView, offset: number): { layer: BackgroundLayer; nextOffset: number } {
    const exists = view.getUint8(offset) !== 0;
    if (!exists) {
        return {
            layer: { exists: false, width: 0, height: 0, tileCount: 0, tiles: [] },
            nextOffset: offset + 1,
        };
    }

    const width = view.getInt16(offset + 0x01, true);
    const height = view.getInt16(offset + 0x03, true);
    const tileCount = view.getUint16(offset + 0x05, true);
    // 10 bytes reserved at 0x07, padding at 0x11 and 0x13

    const tiles: BackgroundTile[] = [];
    let tileOffset = offset + 0x15;  // Skip header (1 + 2 + 2 + 2 + 10 + 2 + 2 = 21 bytes)

    for (let i = 0; i < tileCount; i++) {
        tiles.push(parseTile(view, tileOffset));
        tileOffset += TILE_SIZE;
    }

    return {
        layer: { exists: true, width, height, tileCount, tiles },
        nextOffset: tileOffset,
    };
}

function parseLayer3(view: DataView, offset: number): { layer: BackgroundLayer; nextOffset: number } {
    const exists = view.getUint8(offset) !== 0;
    if (!exists) {
        return {
            layer: { exists: false, width: 0, height: 0, tileCount: 0, tiles: [] },
            nextOffset: offset + 1,
        };
    }

    const width = view.getInt16(offset + 0x01, true);
    const height = view.getInt16(offset + 0x03, true);
    const tileCount = view.getUint16(offset + 0x05, true);
    // 2 bytes padding at 0x07, HeaderLayer4TilePC (8 bytes) at 0x09, padding at 0x11 and 0x13

    const tiles: BackgroundTile[] = [];
    let tileOffset = offset + 0x15;  // Skip header (1 + 2 + 2 + 2 + 2 + 8 + 2 + 2 = 21 bytes)

    for (let i = 0; i < tileCount; i++) {
        tiles.push(parseTile(view, tileOffset));
        tileOffset += TILE_SIZE;
    }

    return {
        layer: { exists: true, width, height, tileCount, tiles },
        nextOffset: tileOffset,
    };
}

function parseTextures(view: DataView, data: Uint8Array, offset: number): (BackgroundTexture | null)[] {
    // Check for "TEXTURE" magic
    const magic = String.fromCharCode(
        data[offset], data[offset + 1], data[offset + 2], data[offset + 3],
        data[offset + 4], data[offset + 5], data[offset + 6]
    );
    if (magic !== 'TEXTURE') {
        console.warn(`Expected TEXTURE magic at offset ${offset}, got "${magic}"`);
    }

    let currentOffset = offset + 7;
    const textures: (BackgroundTexture | null)[] = [];

    for (let i = 0; i < TEXTURE_COUNT; i++) {
        const exists = view.getUint16(currentOffset, true);
        if (exists === 0) {
            textures.push(null);
            currentOffset += 2;
            continue;
        }

        const isBigTile = view.getUint16(currentOffset + 0x02, true) !== 0;
        const depth = view.getUint16(currentOffset + 0x04, true) as TextureDepth;

        // Calculate data size based on depth
        let dataSize: number;
        switch (depth) {
            case TextureDepth.Indexed4bpp:
                dataSize = 32768;  // 256×256×4/8
                break;
            case TextureDepth.Indexed8bpp:
                dataSize = 65536;  // 256×256
                break;
            case TextureDepth.Direct16bpp:
                dataSize = 131072; // 256×256×2
                break;
            default:
                console.warn(`Unknown texture depth ${depth} for texture ${i}`);
                dataSize = 65536;  // Assume 8bpp
        }

        const textureData = data.slice(currentOffset + 0x06, currentOffset + 0x06 + dataSize);

        textures.push({
            exists: true,
            isBigTile,
            depth,
            data: textureData,
        });

        currentOffset += 0x06 + dataSize;
    }

    return textures;
}

export function parseBackgroundSection(data: Uint8Array): BackgroundSection {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Parse header (40 bytes)
    // 0x00: 2 bytes reserved (always 0)
    // 0x02: 2 bytes depth indicator
    const depth = view.getUint16(0x02, true);
    // 0x04: 1 byte isEnabled (always 1)
    // 0x05: 7 bytes "PALETTE" magic
    // 0x0C: 20 bytes transparency flags
    const transparencyFlags: boolean[] = [];
    for (let i = 0; i < 20; i++) {
        transparencyFlags.push(data[0x0C + i] !== 0);
    }
    // 0x20: 4 bytes reserved
    // 0x24: 4 bytes "BACK" magic

    const header: BackgroundHeader = { depth, transparencyFlags };

    // Parse Layer 0 (starts at 0x28)
    const { layer: layer0, nextOffset: afterLayer0 } = parseLayer0(view, 0x28);

    // Parse Layer 1
    const { layer: layer1, nextOffset: afterLayer1 } = parseLayer1(view, afterLayer0);

    // Parse Layer 2
    const { layer: layer2, nextOffset: afterLayer2 } = parseLayer2(view, afterLayer1);

    // Parse Layer 3
    const { layer: layer3, nextOffset: afterLayer3 } = parseLayer3(view, afterLayer2);

    // Parse Textures
    const textures = parseTextures(view, data, afterLayer3);

    return {
        header,
        layers: [layer0, layer1, layer2, layer3],
        textures,
    };
}

// ============================================================================
// Walkmesh Section Parser
// ============================================================================

export function parseWalkmeshSection(data: Uint8Array): WalkmeshSection {
    if (data.length < 4) {
        return { triangleCount: 0, triangles: [] };
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const triangleCount = view.getUint32(0, true);

    if (triangleCount === 0 || triangleCount > 10000) {
        return { triangleCount: 0, triangles: [] };
    }

    const sectorPoolOffset = 4;
    const accessPoolOffset = sectorPoolOffset + triangleCount * 24;

    const triangles: WalkmeshTriangle[] = [];

    for (let i = 0; i < triangleCount; i++) {
        const sectorOffset = sectorPoolOffset + i * 24;
        const accessOffset = accessPoolOffset + i * 6;

        const vertices: [WalkmeshVertex, WalkmeshVertex, WalkmeshVertex] = [
            {
                x: view.getInt16(sectorOffset, true),
                y: view.getInt16(sectorOffset + 2, true),
                z: view.getInt16(sectorOffset + 4, true),
            },
            {
                x: view.getInt16(sectorOffset + 8, true),
                y: view.getInt16(sectorOffset + 10, true),
                z: view.getInt16(sectorOffset + 12, true),
            },
            {
                x: view.getInt16(sectorOffset + 16, true),
                y: view.getInt16(sectorOffset + 18, true),
                z: view.getInt16(sectorOffset + 20, true),
            },
        ];

        const access: [number, number, number] = [
            view.getUint16(accessOffset, true),
            view.getUint16(accessOffset + 2, true),
            view.getUint16(accessOffset + 4, true),
        ];

        triangles.push({ vertices, access });
    }

    return { triangleCount, triangles };
}

// ============================================================================
// Triggers Section Parser (Gateways)
// ============================================================================

export function parseGateways(data: Uint8Array): Gateway[] {
    if (data.length < 344) {
        return [];
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const gateways: Gateway[] = [];
    const gatewayOffset = 56;

    for (let i = 0; i < 12; i++) {
        const offset = gatewayOffset + i * 24;

        const fieldId = view.getUint16(offset + 18, true);
        if (fieldId === 0) continue;

        const vertex1: WalkmeshVertex = {
            x: view.getInt16(offset, true),
            y: view.getInt16(offset + 2, true),
            z: view.getInt16(offset + 4, true),
        };

        const vertex2: WalkmeshVertex = {
            x: view.getInt16(offset + 6, true),
            y: view.getInt16(offset + 8, true),
            z: view.getInt16(offset + 10, true),
        };

        if (vertex1.x === 0 && vertex1.y === 0 && vertex2.x === 0 && vertex2.y === 0) continue;

        gateways.push({ vertex1, vertex2, fieldId });
    }

    return gateways;
}

// ============================================================================
// Walkmesh Bounds Calculator
// ============================================================================

export function calculateWalkmeshBounds(walkmesh: WalkmeshSection): WalkmeshBounds {
    if (walkmesh.triangles.length === 0) {
        return {
            minX: 0, maxX: 0,
            minY: 0, maxY: 0,
            minZ: 0, maxZ: 0,
            centerX: 0, centerY: 0, centerZ: 0,
        };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const tri of walkmesh.triangles) {
        for (const v of tri.vertices) {
            minX = Math.min(minX, v.x);
            maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y);
            maxY = Math.max(maxY, v.y);
            minZ = Math.min(minZ, v.z);
            maxZ = Math.max(maxZ, v.z);
        }
    }

    return {
        minX, maxX,
        minY, maxY,
        minZ, maxZ,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        centerZ: (minZ + maxZ) / 2,
    };
}

// ============================================================================
// FieldFile Class
// ============================================================================

export class FieldFile {
    data: FieldData;
    rawData: Uint8Array;  // Decompressed data for section access

    // Cached parsed sections (lazy loading)
    private _paletteSection: PaletteSection | null = null;
    private _backgroundSection: BackgroundSection | null = null;
    private _walkmeshSection: WalkmeshSection | null = null;
    private _gateways: Gateway[] | null = null;

    constructor(buffer: Uint8Array) {
        // Field files have a 4-byte header with the compressed size, then LZSS data
        // Use slice() to create an independent copy - required for Tauri where
        // the original buffer may be shared across multiple file reads
        const compressedData = buffer.slice(4);

        // Decompress LZSS data
        const lzss = new Lzss();
        this.rawData = lzss.decompress(compressedData);

        this.data = this.parse(this.rawData, buffer.length);
    }

    private parse(data: Uint8Array, compressedSize: number): FieldData {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        // Read header
        // 0x00: 2 bytes - Blank (always 0x00)
        const blank = view.getUint16(0x00, true);
        if (blank !== 0) {
            console.warn(`Field file: Expected blank bytes at 0x00, got ${blank}`);
        }

        // 0x02: 4 bytes - Number of sections (always 9)
        const numSections = view.getUint32(0x02, true);
        if (numSections !== 9) {
            throw new Error(`Invalid field file: expected 9 sections, got ${numSections}`);
        }

        // Read section pointers (0x06 to 0x26, 4 bytes each)
        const sectionPointers: number[] = [];
        for (let i = 0; i < 9; i++) {
            sectionPointers.push(view.getUint32(0x06 + i * 4, true));
        }

        // Helper to read section info
        const readSection = (index: number): FieldSection => {
            const offset = sectionPointers[index];
            const length = view.getUint32(offset, true);
            return {
                offset,
                length,
                dataOffset: offset + 4,
            };
        };

        return {
            numSections,
            sections: {
                script: readSection(0),
                camera: readSection(1),
                modelLoader: readSection(2),
                palette: readSection(3),
                walkmesh: readSection(4),
                tileMap: readSection(5),
                encounter: readSection(6),
                triggers: readSection(7),
                background: readSection(8),
            },
            decompressedSize: data.length,
            compressedSize,
        };
    }

    // Get raw section data (without the 4-byte length prefix)
    // Uses slice() to create an independent copy with its own ArrayBuffer.
    // This simplifies downstream parsing by ensuring byteOffset is always 0.
    getSectionData(sectionName: keyof FieldData['sections']): Uint8Array {
        const section = this.data.sections[sectionName];
        return this.rawData.slice(section.dataOffset, section.dataOffset + section.length);
    }

    /** Get parsed palette section (lazy loaded) */
    getPaletteSection(): PaletteSection {
        if (!this._paletteSection) {
            this._paletteSection = parsePaletteSection(this.getSectionData('palette'));
        }
        return this._paletteSection;
    }

    /** Get parsed background section (lazy loaded) */
    getBackgroundSection(): BackgroundSection {
        if (!this._backgroundSection) {
            this._backgroundSection = parseBackgroundSection(this.getSectionData('background'));
        }
        return this._backgroundSection;
    }

    /** Get parsed walkmesh section (lazy loaded) */
    getWalkmeshSection(): WalkmeshSection {
        if (!this._walkmeshSection) {
            this._walkmeshSection = parseWalkmeshSection(this.getSectionData('walkmesh'));
        }
        return this._walkmeshSection;
    }

    /** Get gateways from triggers section (lazy loaded) */
    getGateways(): Gateway[] {
        if (!this._gateways) {
            this._gateways = parseGateways(this.getSectionData('triggers'));
        }
        return this._gateways;
    }

    /** Get walkmesh bounds (convenience method) */
    getWalkmeshBounds(): WalkmeshBounds {
        return calculateWalkmeshBounds(this.getWalkmeshSection());
    }

    /**
     * Get a texture as RGBA pixel data ready for canvas rendering
     * @param textureID The texture ID (0-41)
     * @param paletteID The palette ID for indexed textures
     * @returns Uint8ClampedArray of RGBA data (256×256×4 bytes) or null if texture doesn't exist
     */
    getTextureRGBA(textureID: number, paletteID: number = 0): Uint8ClampedArray | null {
        const background = this.getBackgroundSection();
        const texture = background.textures[textureID];
        if (!texture) return null;

        const palette = this.getPaletteSection();
        const transparencyFlags = background.header.transparencyFlags;
        const rgba = new Uint8ClampedArray(256 * 256 * 4);

        switch (texture.depth) {
            case TextureDepth.Indexed4bpp: {
                // 4bpp: each byte has 2 pixels (low nibble = left, high nibble = right)
                const colors = palette.palettes[paletteID]?.colors;
                if (!colors) return null;
                const transparent = paletteID < 20 && transparencyFlags[paletteID];

                for (let i = 0; i < texture.data.length; i++) {
                    const byte = texture.data[i];
                    const leftIdx = byte & 0x0F;
                    const rightIdx = (byte >> 4) & 0x0F;

                    const pixelOffset1 = (i * 2) * 4;
                    const pixelOffset2 = (i * 2 + 1) * 4;

                    const c1 = colors[leftIdx];
                    rgba[pixelOffset1] = c1.r;
                    rgba[pixelOffset1 + 1] = c1.g;
                    rgba[pixelOffset1 + 2] = c1.b;
                    rgba[pixelOffset1 + 3] = (transparent && leftIdx === 0) ? 0 : 255;

                    const c2 = colors[rightIdx];
                    rgba[pixelOffset2] = c2.r;
                    rgba[pixelOffset2 + 1] = c2.g;
                    rgba[pixelOffset2 + 2] = c2.b;
                    rgba[pixelOffset2 + 3] = (transparent && rightIdx === 0) ? 0 : 255;
                }
                break;
            }

            case TextureDepth.Indexed8bpp: {
                // 8bpp: each byte is a palette index
                const colors = palette.palettes[paletteID]?.colors;
                if (!colors) return null;
                const transparent = paletteID < 20 && transparencyFlags[paletteID];

                for (let i = 0; i < texture.data.length; i++) {
                    const idx = texture.data[i];
                    const c = colors[idx];
                    const pixelOffset = i * 4;
                    rgba[pixelOffset] = c.r;
                    rgba[pixelOffset + 1] = c.g;
                    rgba[pixelOffset + 2] = c.b;
                    rgba[pixelOffset + 3] = (transparent && idx === 0) ? 0 : 255;
                }
                break;
            }

            case TextureDepth.Direct16bpp: {
                // 16bpp: each pixel is 2 bytes in PC RGB16 format
                const view = new DataView(texture.data.buffer, texture.data.byteOffset, texture.data.byteLength);
                for (let i = 0; i < 256 * 256; i++) {
                    const color16 = view.getUint16(i * 2, true);
                    const c = pcColorToRGBA(color16);
                    const pixelOffset = i * 4;
                    rgba[pixelOffset] = c.r;
                    rgba[pixelOffset + 1] = c.g;
                    rgba[pixelOffset + 2] = c.b;
                    rgba[pixelOffset + 3] = c.a;
                }
                break;
            }
        }

        return rgba;
    }

    /**
     * Get all tiles sorted by render order (back to front)
     * This is useful for implementing a background renderer
     */
    getTilesByRenderOrder(): { tile: BackgroundTile; layerIndex: number }[] {
        const background = this.getBackgroundSection();
        const result: { tile: BackgroundTile; layerIndex: number; sortKey: number }[] = [];

        // Collect all tiles with their layer info
        background.layers.forEach((layer, layerIndex) => {
            if (!layer.exists) return;

            layer.tiles.forEach(tile => {
                // Skip tiles with off-screen coordinates
                if (Math.abs(tile.dstX) >= 1024 || Math.abs(tile.dstY) >= 1024) {
                    return;
                }

                // Calculate sort key: layer 2 at back (4096), layer 0 (4095),
                // layer 1 (variable), layer 3 at front (0)
                let sortKey: number;
                switch (layerIndex) {
                    case 0: sortKey = 4095; break;  // Layer 0: fixed at 4095
                    case 1: sortKey = tile.zOrder; break;  // Layer 1: variable
                    case 2: sortKey = 4096; break;  // Layer 2: always at back
                    case 3: sortKey = 0; break;     // Layer 3: always at front
                    default: sortKey = tile.zOrder;
                }
                result.push({ tile, layerIndex, sortKey });
            });
        });

        // Sort by zOrder descending (higher = further back, render first)
        // Use subID for sub-sorting when zOrder matches
        result.sort((a, b) => {
            if (a.sortKey !== b.sortKey) {
                return b.sortKey - a.sortKey;  // Higher zOrder rendered first (behind)
            }
            return b.tile.subID - a.tile.subID;
        });

        return result.map(({ tile, layerIndex }) => ({ tile, layerIndex }));
    }

    /**
     * Get background dimensions based on all layer tiles
     */
    getBackgroundDimensions(): { width: number; height: number; minX: number; minY: number } {
        const background = this.getBackgroundSection();

        // Calculate actual bounds from tile positions
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        background.layers.forEach((layer, layerIndex) => {
            if (!layer.exists) return;
            // Layer 0/1 use 16x16 tiles, Layer 2/3 use 32x32 tiles
            const tileSize = (layerIndex <= 1) ? 16 : 32;

            for (const tile of layer.tiles) {
                // Skip tiles with sentinel/off-screen coordinates (dstX >= 9999 or dstY >= 9999)
                // These are used in FF7 to mark tiles as "disabled" or "don't render"
                if (tile.dstX >= 9999 || tile.dstY >= 9999) {
                    continue;
                }

                minX = Math.min(minX, tile.dstX);
                minY = Math.min(minY, tile.dstY);
                maxX = Math.max(maxX, tile.dstX + tileSize);
                maxY = Math.max(maxY, tile.dstY + tileSize);
            }
        });

        return {
            width: maxX - minX,
            height: maxY - minY,
            minX,
            minY,
        };
    }

    getStats() {
        const sections = this.data.sections;
        return {
            numSections: this.data.numSections,
            compressedSize: this.data.compressedSize,
            decompressedSize: this.data.decompressedSize,
            compressionRatio: ((1 - this.data.compressedSize / this.data.decompressedSize) * 100).toFixed(1) + '%',
            sectionSizes: {
                script: sections.script.length,
                camera: sections.camera.length,
                modelLoader: sections.modelLoader.length,
                palette: sections.palette.length,
                walkmesh: sections.walkmesh.length,
                tileMap: sections.tileMap.length,
                encounter: sections.encounter.length,
                triggers: sections.triggers.length,
                background: sections.background.length,
            },
        };
    }
}
