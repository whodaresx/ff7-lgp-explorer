// FF7 PC P Model file parser
// Format reverse-engineered from Kimera's FF7PModel.cs via exporter.ts

export interface PVertex {
    x: number;
    y: number;
    z: number;
}

export interface PTexCoord {
    u: number;
    v: number;
}

export interface PColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface PEdge {
    v1: number;
    v2: number;
}

export interface PPolygon {
    tag1: number;
    vertices: [number, number, number];
    normals: [number, number, number];
    edges: [number, number, number];
    tag2: number;
}

export interface PHundret {
    field_0: number;
    field_4: number;
    field_8: number;
    field_C: number;
    texID: number;
    texture_set_ptr: number;
    field_18: number;
    field_1C: number;
    field_20: number;
    shademode: number;
    lightstate_ambient: number;
    field_2C: number;
    lightstate_material_ptr: number;
    srcblend: number;
    destblend: number;
    field_3C: number;
    alpharef: number;
    blend_mode: number;
    zSort: number;
    field_4C: number;
    field_50: number;
    field_54: number;
    field_58: number;
    vertex_alpha: number;
    field_60: number;
}

export interface PGroup {
    polyType: number;
    offsetPoly: number;
    numPoly: number;
    offsetVert: number;
    numVert: number;
    offsetEdge: number;
    numEdge: number;
    off1C: number;
    off20: number;
    off24: number;
    off28: number;
    offsetTex: number;
    texFlag: number;
    texID: number;
}

export interface PBoundingBox {
    unknown: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    minX: number;
    minY: number;
    minZ: number;
}

export interface PHeader {
    version: number;
    off04: number;
    vertexColor: number;
    numVerts: number;
    numNormals: number;
    numXYZ: number;
    numTexCs: number;
    numNormIdx: number;
    numEdges: number;
    numPolys: number;
    off28: number;
    off2C: number;
    numHundrets: number;
    numGroups: number;
    mirex_g: number;
    off3C: number;
}

export interface PModel {
    header: PHeader;
    vertices: PVertex[];
    normals: PVertex[];
    texCoords: PTexCoord[];
    vertexColors: PColor[];
    polygonColors: PColor[];
    edges: PEdge[];
    polygons: PPolygon[];
    hundrets: PHundret[];
    groups: PGroup[];
    boundingBox: PBoundingBox | null;
    normalIndices: number[];
}

export class PFile {
    model: PModel;

    constructor(data: Uint8Array) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        let offset = 0;

        // Read header (128 bytes)
        const header: PHeader = {
            version: view.getInt32(offset, true),
            off04: view.getInt32(offset + 4, true),
            vertexColor: view.getInt32(offset + 8, true),
            numVerts: view.getInt32(offset + 12, true),
            numNormals: view.getInt32(offset + 16, true),
            numXYZ: view.getInt32(offset + 20, true),
            numTexCs: view.getInt32(offset + 24, true),
            numNormIdx: view.getInt32(offset + 28, true),
            numEdges: view.getInt32(offset + 32, true),
            numPolys: view.getInt32(offset + 36, true),
            off28: view.getInt32(offset + 40, true),
            off2C: view.getInt32(offset + 44, true),
            numHundrets: view.getInt32(offset + 48, true),
            numGroups: view.getInt32(offset + 52, true),
            mirex_g: view.getInt32(offset + 56, true),
            off3C: view.getInt32(offset + 60, true),
        };
        offset = 128; // Skip header including unknown[16]

        // Validate header
        if (header.version !== 1) {
            throw new Error(`Invalid P file version: ${header.version}`);
        }

        // Read vertices
        const vertices: PVertex[] = [];
        for (let i = 0; i < header.numVerts; i++) {
            vertices.push({
                x: view.getFloat32(offset, true),
                y: view.getFloat32(offset + 4, true),
                z: view.getFloat32(offset + 8, true),
            });
            offset += 12;
        }

        // Read normals (if present)
        const normals: PVertex[] = [];
        for (let i = 0; i < header.numNormals; i++) {
            normals.push({
                x: view.getFloat32(offset, true),
                y: view.getFloat32(offset + 4, true),
                z: view.getFloat32(offset + 8, true),
            });
            offset += 12;
        }

        // Read texture coordinates
        const texCoords: PTexCoord[] = [];
        for (let i = 0; i < header.numTexCs; i++) {
            texCoords.push({
                u: view.getFloat32(offset, true),
                v: view.getFloat32(offset + 4, true),
            });
            offset += 8;
        }

        // Read vertex colors (BGRA)
        const vertexColors: PColor[] = [];
        for (let i = 0; i < header.numVerts; i++) {
            vertexColors.push({
                b: view.getUint8(offset),
                g: view.getUint8(offset + 1),
                r: view.getUint8(offset + 2),
                a: view.getUint8(offset + 3),
            });
            offset += 4;
        }

        // Read polygon colors (BGRA)
        const polygonColors: PColor[] = [];
        for (let i = 0; i < header.numPolys; i++) {
            polygonColors.push({
                b: view.getUint8(offset),
                g: view.getUint8(offset + 1),
                r: view.getUint8(offset + 2),
                a: view.getUint8(offset + 3),
            });
            offset += 4;
        }

        // Read edges
        const edges: PEdge[] = [];
        for (let i = 0; i < header.numEdges; i++) {
            edges.push({
                v1: view.getUint16(offset, true),
                v2: view.getUint16(offset + 2, true),
            });
            offset += 4;
        }

        // Read polygons (24 bytes each)
        const polygons: PPolygon[] = [];
        for (let i = 0; i < header.numPolys; i++) {
            polygons.push({
                tag1: view.getInt16(offset, true),
                vertices: [
                    view.getUint16(offset + 2, true),
                    view.getUint16(offset + 4, true),
                    view.getUint16(offset + 6, true),
                ],
                normals: [
                    view.getUint16(offset + 8, true),
                    view.getUint16(offset + 10, true),
                    view.getUint16(offset + 12, true),
                ],
                edges: [
                    view.getUint16(offset + 14, true),
                    view.getUint16(offset + 16, true),
                    view.getUint16(offset + 18, true),
                ],
                tag2: view.getInt32(offset + 20, true),
            });
            offset += 24;
        }

        // Read hundrets (100 bytes each)
        const hundrets: PHundret[] = [];
        for (let i = 0; i < header.numHundrets; i++) {
            hundrets.push({
                field_0: view.getInt32(offset, true),
                field_4: view.getInt32(offset + 4, true),
                field_8: view.getInt32(offset + 8, true),
                field_C: view.getInt32(offset + 12, true),
                texID: view.getInt32(offset + 16, true),
                texture_set_ptr: view.getInt32(offset + 20, true),
                field_18: view.getInt32(offset + 24, true),
                field_1C: view.getInt32(offset + 28, true),
                field_20: view.getInt32(offset + 32, true),
                shademode: view.getInt32(offset + 36, true),
                lightstate_ambient: view.getInt32(offset + 40, true),
                field_2C: view.getInt32(offset + 44, true),
                lightstate_material_ptr: view.getInt32(offset + 48, true),
                srcblend: view.getInt32(offset + 52, true),
                destblend: view.getInt32(offset + 56, true),
                field_3C: view.getInt32(offset + 60, true),
                alpharef: view.getInt32(offset + 64, true),
                blend_mode: view.getInt32(offset + 68, true),
                zSort: view.getInt32(offset + 72, true),
                field_4C: view.getInt32(offset + 76, true),
                field_50: view.getInt32(offset + 80, true),
                field_54: view.getInt32(offset + 84, true),
                field_58: view.getInt32(offset + 88, true),
                vertex_alpha: view.getInt32(offset + 92, true),
                field_60: view.getInt32(offset + 96, true),
            });
            offset += 100;
        }

        // Read groups (56 bytes each)
        const groups: PGroup[] = [];
        for (let i = 0; i < header.numGroups; i++) {
            groups.push({
                polyType: view.getInt32(offset, true),
                offsetPoly: view.getInt32(offset + 4, true),
                numPoly: view.getInt32(offset + 8, true),
                offsetVert: view.getInt32(offset + 12, true),
                numVert: view.getInt32(offset + 16, true),
                offsetEdge: view.getInt32(offset + 20, true),
                numEdge: view.getInt32(offset + 24, true),
                off1C: view.getInt32(offset + 28, true),
                off20: view.getInt32(offset + 32, true),
                off24: view.getInt32(offset + 36, true),
                off28: view.getInt32(offset + 40, true),
                offsetTex: view.getInt32(offset + 44, true),
                texFlag: view.getInt32(offset + 48, true),
                texID: view.getInt32(offset + 52, true),
            });
            offset += 56;
        }

        // Read bounding box (28 bytes) - only present when mirex_g != 0
        let boundingBox: PBoundingBox | null = null;
        if (header.mirex_g !== 0) {
            boundingBox = {
                unknown: view.getInt32(offset, true),
                maxX: view.getFloat32(offset + 4, true),
                maxY: view.getFloat32(offset + 8, true),
                maxZ: view.getFloat32(offset + 12, true),
                minX: view.getFloat32(offset + 16, true),
                minY: view.getFloat32(offset + 20, true),
                minZ: view.getFloat32(offset + 24, true),
            };
            offset += 28;
        }

        // Read normal indices
        const normalIndices: number[] = [];
        for (let i = 0; i < header.numNormIdx; i++) {
            normalIndices.push(view.getInt32(offset, true));
            offset += 4;
        }

        this.model = {
            header,
            vertices,
            normals,
            texCoords,
            vertexColors,
            polygonColors,
            edges,
            polygons,
            hundrets,
            groups,
            boundingBox,
            normalIndices,
        };
    }

    getStats() {
        return {
            vertices: this.model.header.numVerts,
            polygons: this.model.header.numPolys,
            groups: this.model.header.numGroups,
            textures: this.model.hundrets.length,
        };
    }
}
