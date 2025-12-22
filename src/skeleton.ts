// FF7 PC Battle Skeleton file parser
// Format based on Kimera's FF7BattleSkeleton.cs

export interface SkeletonBone {
    parentBone: number;
    length: number;
    hasModel: boolean;
}

export interface SkeletonHeader {
    skeletonType: number;      // 0=Enemy, 1=Battle Location, 2=PC Battle Model
    unk1: number;
    unk2: number;
    nBones: number;
    unk3: number;
    nJoints: number;
    nTextures: number;
    nsSkeletonAnims: number;
    unk4: number;
    nWeapons: number;
    nsWeaponsAnims: number;
    unk5: number;
    unk6: number;
}

export interface SkeletonModel {
    header: SkeletonHeader;
    bones: SkeletonBone[];
    isBattleLocation: boolean;
}

export class SkeletonFile {
    model: SkeletonModel;

    constructor(data: Uint8Array) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        // Validate minimum size (52 bytes header)
        if (data.length < 52) {
            throw new Error(`File too small for skeleton header: ${data.length} bytes`);
        }

        // Read header (52 bytes = 13 x int32)
        const header: SkeletonHeader = {
            skeletonType: view.getInt32(0, true),
            unk1: view.getInt32(4, true),
            unk2: view.getInt32(8, true),
            nBones: view.getInt32(12, true),
            unk3: view.getInt32(16, true),
            nJoints: view.getInt32(20, true),
            nTextures: view.getInt32(24, true),
            nsSkeletonAnims: view.getInt32(28, true),
            unk4: view.getInt32(32, true),
            nWeapons: view.getInt32(36, true),
            nsWeaponsAnims: view.getInt32(40, true),
            unk5: view.getInt32(44, true),
            unk6: view.getInt32(48, true),
        };

        // Validate header values
        if (header.skeletonType < 0 || header.skeletonType > 2) {
            throw new Error(`Invalid skeleton type: ${header.skeletonType}`);
        }

        const isBattleLocation = header.nBones === 0;
        const bones: SkeletonBone[] = [];

        // Read bone data (12 bytes each) if nBones > 0
        if (header.nBones > 0) {
            const expectedSize = 52 + (header.nBones * 12);
            if (data.length < expectedSize) {
                throw new Error(`File too small for ${header.nBones} bones: ${data.length} < ${expectedSize}`);
            }

            let offset = 52;
            for (let i = 0; i < header.nBones; i++) {
                bones.push({
                    parentBone: view.getInt32(offset, true),
                    length: view.getFloat32(offset + 4, true),
                    hasModel: view.getInt32(offset + 8, true) !== 0,
                });
                offset += 12;
            }
        }

        this.model = {
            header,
            bones,
            isBattleLocation,
        };
    }

    getSkeletonTypeName(): string {
        switch (this.model.header.skeletonType) {
            case 0: return 'Enemy Model';
            case 1: return 'Battle Location';
            case 2: return 'PC Battle Model';
            default: return `Unknown (${this.model.header.skeletonType})`;
        }
    }

    getStats() {
        const { header, isBattleLocation } = this.model;
        return {
            type: this.getSkeletonTypeName(),
            isBattleLocation,
            bones: header.nBones,
            joints: header.nJoints,
            textures: header.nTextures,
            skeletonAnims: header.nsSkeletonAnims,
            weapons: header.nWeapons,
            weaponAnims: header.nsWeaponsAnims,
        };
    }

    // Generate list of related files based on the skeleton metadata
    getRelatedFiles(baseName: string): { name: string; type: string }[] {
        const { header, isBattleLocation } = this.model;
        const files: { name: string; type: string }[] = [];
        const base = baseName.toUpperCase().slice(0, 2);

        // Textures: XXAC to XXAL (up to 10)
        for (let i = 0; i < header.nTextures && i < 10; i++) {
            const suffix = String.fromCharCode('C'.charCodeAt(0) + i);
            files.push({ name: `${base}A${suffix}`, type: 'Texture' });
        }

        if (isBattleLocation) {
            // Battle location: P models are XXAM onwards
            let suffix1 = 'A';
            let suffix2 = 'M';
            for (let i = 0; i < header.nJoints; i++) {
                files.push({ name: `${base}${suffix1}${suffix2}`, type: 'Location Part' });
                suffix2 = String.fromCharCode(suffix2.charCodeAt(0) + 1);
                if (suffix2 > 'Z') {
                    suffix1 = String.fromCharCode(suffix1.charCodeAt(0) + 1);
                    suffix2 = 'A';
                }
            }
        } else {
            // Character model: bone P models are XXAM onwards
            let suffix1 = 'A';
            let suffix2 = 'M';
            for (let i = 0; i < header.nBones; i++) {
                const bone = this.model.bones[i];
                files.push({
                    name: `${base}${suffix1}${suffix2}`,
                    type: bone.hasModel ? 'Bone Model' : 'Bone (no model)',
                });
                suffix2 = String.fromCharCode(suffix2.charCodeAt(0) + 1);
                if (suffix2 > 'Z') {
                    suffix1 = String.fromCharCode(suffix1.charCodeAt(0) + 1);
                    suffix2 = 'A';
                }
            }

            // Weapons: XXCK onwards
            for (let i = 0; i < header.nWeapons; i++) {
                const suffix = String.fromCharCode('K'.charCodeAt(0) + i);
                files.push({ name: `${base}C${suffix}`, type: 'Weapon' });
            }
        }

        // Animation files: XXDA onwards
        for (let i = 0; i < header.nsSkeletonAnims; i++) {
            // Animation naming varies, but typically XXDA, XXDB, etc.
            const suffix = String.fromCharCode('A'.charCodeAt(0) + (i % 26));
            const prefix = i < 26 ? 'D' : String.fromCharCode('D'.charCodeAt(0) + Math.floor(i / 26));
            files.push({ name: `${base}${prefix}${suffix}`, type: 'Animation' });
        }

        return files;
    }

    // Generate list of related files for magic.lgp model format (*.d skeleton files)
    getRelatedFilesMagic(baseName: string): { name: string; type: string }[] {
        const { header } = this.model;
        const files: { name: string; type: string }[] = [];

        // Textures: base.t00, base.t01, etc.
        for (let i = 0; i < header.nTextures; i++) {
            const idx = i.toString().padStart(2, '0');
            files.push({ name: `${baseName}.t${idx}`, type: 'Texture' });
        }

        // P models by bone index: base.p00, base.p01, etc.
        for (let i = 0; i < this.model.bones.length; i++) {
            const bone = this.model.bones[i];
            const idx = i.toString().padStart(2, '0');
            files.push({
                name: `${baseName}.p${idx}`,
                type: bone.hasModel ? 'Bone Model' : 'Bone (no model)',
            });
        }

        // Animation files: base.a00, base.a01, etc.
        for (let i = 0; i < header.nsSkeletonAnims; i++) {
            const idx = i.toString().padStart(2, '0');
            files.push({ name: `${baseName}.a${idx}`, type: 'Animation' });
        }

        return files;
    }
}
