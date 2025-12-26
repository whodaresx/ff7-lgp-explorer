// FF7 PC Battle Animation file parser
// Based on Kimera's FF7BattleAnimation.cs

export interface BattleFrameBone {
    alpha: number;  // Rotation in degrees
    beta: number;
    gamma: number;
    accumAlphaS: number;  // Raw accumulated value (signed short)
    accumBetaS: number;
    accumGammaS: number;
}

export interface BattleFrame {
    startX: number;
    startY: number;
    startZ: number;
    bones: BattleFrameBone[];
}

export interface BattleAnimationData {
    nBones: number;
    numFrames: number;
    blockSize: number;
    numFramesShort: number;
    blockSizeShort: number;
    key: number;
    frames: BattleFrame[];
}

// Bit-level reading utilities
function getBitBlockVUnsigned(data: Uint8Array, nBits: number, offsetBit: { value: number }): number {
    if (nBits <= 0) return 0;
    
    const baseByte = Math.floor(offsetBit.value / 8);
    const unalignedByBits = offsetBit.value % 8;
    let res = 0;
    
    if (unalignedByBits + nBits > 8) {
        const isAligned = unalignedByBits === 0;
        const endBits = (offsetBit.value + nBits) % 8;
        const cleanEnd = endBits === 0;
        const nBytes = Math.floor((nBits - (isAligned ? 0 : 8 - unalignedByBits) - (cleanEnd ? 0 : endBits)) / 8) +
                       (isAligned ? 0 : 1) + (cleanEnd ? 0 : 1);
        const lastAlignedByte = nBytes - (cleanEnd ? 0 : 1) - 1;
        const firstAlignedByte = isAligned ? 0 : 1;
        
        // Prefix - stored at the beginning of the byte
        if (!isAligned && baseByte < data.length) {
            res = data[baseByte] & (Math.pow(2, 8 - unalignedByBits) - 1);
        }
        
        // Middle aligned bytes
        for (let bi = firstAlignedByte; bi <= lastAlignedByte; bi++) {
            res *= 256;
            if (baseByte + bi < data.length) {
                res |= data[baseByte + bi];
            }
        }
        
        // Suffix - stored at the end of the byte
        if (!cleanEnd && baseByte + lastAlignedByte + 1 < data.length) {
            res *= Math.pow(2, endBits);
            res |= (data[baseByte + lastAlignedByte + 1] >> (8 - endBits)) & (Math.pow(2, endBits) - 1);
        }
    } else {
        if (baseByte < data.length) {
            res = data[baseByte];
            res = Math.floor(res / Math.pow(2, 8 - (unalignedByBits + nBits)));
            res &= Math.pow(2, nBits) - 1;
        }
    }
    
    offsetBit.value += nBits;
    return res;
}

function extendSignInteger(val: number, len: number): number {
    if ((val & Math.pow(2, len - 1)) !== 0) {
        let auxRes = Math.pow(2, 16) - 1;
        auxRes ^= Math.pow(2, len) - 1;
        auxRes |= val;
        // Convert to signed 16-bit
        if (auxRes > 32767) auxRes -= 65536;
        return auxRes;
    }
    return val;
}

function getBitBlockV(data: Uint8Array, nBits: number, offsetBit: { value: number }): number {
    const tmpValue = getBitBlockVUnsigned(data, nBits, offsetBit);
    if (nBits > 0 && nBits <= 16) {
        return extendSignInteger(tmpValue, nBits);
    }
    return tmpValue;
}

// Convert raw 12-bit value to degrees
function getDegreesFromRaw(value: number, key: number): number {
    return (value / Math.pow(2, 12 - key)) * 360;
}

// Parse uncompressed bone rotation (first frame)
function processUncompressedFrameBoneRotation(data: Uint8Array, offsetBit: { value: number }, key: number): number {
    const val = getBitBlockV(data, 12 - key, offsetBit);
    return val * Math.pow(2, key);
}

// Parse uncompressed bone (first frame)
function processUncompressedFrameBone(data: Uint8Array, offsetBit: { value: number }, key: number): BattleFrameBone {
    const accumAlphaS = processUncompressedFrameBoneRotation(data, offsetBit, key);
    const accumBetaS = processUncompressedFrameBoneRotation(data, offsetBit, key);
    const accumGammaS = processUncompressedFrameBoneRotation(data, offsetBit, key);
    
    const accumAlpha = accumAlphaS < 0 ? accumAlphaS + 0x1000 : accumAlphaS;
    const accumBeta = accumBetaS < 0 ? accumBetaS + 0x1000 : accumBetaS;
    const accumGamma = accumGammaS < 0 ? accumGammaS + 0x1000 : accumGammaS;
    
    return {
        alpha: getDegreesFromRaw(accumAlpha, 0),
        beta: getDegreesFromRaw(accumBeta, 0),
        gamma: getDegreesFromRaw(accumGamma, 0),
        accumAlphaS,
        accumBetaS,
        accumGammaS,
    };
}

// Parse first frame (uncompressed)
function processUncompressedFrame(data: Uint8Array, offsetBit: { value: number }, key: number, nBones: number): BattleFrame {
    const startX = getBitBlockV(data, 16, offsetBit);
    const startY = getBitBlockV(data, 16, offsetBit);
    const startZ = getBitBlockV(data, 16, offsetBit);
    
    const bones: BattleFrameBone[] = [];
    for (let i = 0; i < nBones; i++) {
        bones.push(processUncompressedFrameBone(data, offsetBit, key));
    }
    
    return { startX, startY, startZ, bones };
}

// Parse bone rotation delta (subsequent frames)
function processFrameBoneRotationDelta(data: Uint8Array, offsetBit: { value: number }, key: number): number {
    if (getBitBlockVUnsigned(data, 1, offsetBit) === 1) {
        const dLen = getBitBlockVUnsigned(data, 3, offsetBit);
        
        let val: number;
        if (dLen === 0) {
            // Minimum bone rotation decrement
            val = -1;
        } else if (dLen === 7) {
            // Just like the first frame
            val = getBitBlockV(data, 12 - key, offsetBit);
        } else {
            val = getBitBlockV(data, dLen, offsetBit);
            // Invert the value of the last bit
            const signVal = Math.pow(2, dLen - 1);
            if (val < 0) val -= signVal;
            else val += signVal;
        }
        
        // Convert to 12-bits value
        return val * Math.pow(2, key);
    }
    return 0;
}

// Parse compressed bone (subsequent frames)
function processFrameBone(data: Uint8Array, offsetBit: { value: number }, key: number, lastBone: BattleFrameBone): BattleFrameBone {
    const accumAlphaS = lastBone.accumAlphaS + processFrameBoneRotationDelta(data, offsetBit, key);
    const accumBetaS = lastBone.accumBetaS + processFrameBoneRotationDelta(data, offsetBit, key);
    const accumGammaS = lastBone.accumGammaS + processFrameBoneRotationDelta(data, offsetBit, key);
    
    // Handle sign wrapping for 12-bit values
    const accumAlpha = accumAlphaS < 0 ? accumAlphaS + 0x1000 : (accumAlphaS & 0xFFF);
    const accumBeta = accumBetaS < 0 ? accumBetaS + 0x1000 : (accumBetaS & 0xFFF);
    const accumGamma = accumGammaS < 0 ? accumGammaS + 0x1000 : (accumGammaS & 0xFFF);
    
    return {
        alpha: getDegreesFromRaw(accumAlpha, 0),
        beta: getDegreesFromRaw(accumBeta, 0),
        gamma: getDegreesFromRaw(accumGamma, 0),
        accumAlphaS: accumAlphaS & 0xFFFF,  // Keep as signed short
        accumBetaS: accumBetaS & 0xFFFF,
        accumGammaS: accumGammaS & 0xFFFF,
    };
}

// Parse compressed frame (subsequent frames)
function processFrame(data: Uint8Array, offsetBit: { value: number }, key: number, nBones: number, lastFrame: BattleFrame): BattleFrame | null {
    try {
        let startX = lastFrame.startX;
        let startY = lastFrame.startY;
        let startZ = lastFrame.startZ;
        
        // Read position deltas
        for (let oi = 0; oi < 3; oi++) {
            const offsetLen = (getBitBlockV(data, 1, offsetBit) & 1) === 0 ? 7 : 16;
            const delta = getBitBlockV(data, offsetLen, offsetBit);
            
            if (oi === 0) startX += delta;
            else if (oi === 1) startY += delta;
            else startZ += delta;
        }
        
        const bones: BattleFrameBone[] = [];
        for (let i = 0; i < nBones; i++) {
            bones.push(processFrameBone(data, offsetBit, key, lastFrame.bones[i]));
        }
        
        return { startX, startY, startZ, bones };
    } catch {
        return null;
    }
}

export class BattleAnimationPack {
    nAnimations: number;
    skeletonAnimations: BattleAnimationData[];
    weaponAnimations: BattleAnimationData[];

    constructor(buffer: Uint8Array, skeletonBones: number = 0, nsSkeletonAnims: number = 1, nsWeaponAnims: number = 0) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let offset = 0;

        // Read pack header - number of animations
        this.nAnimations = view.getInt32(offset, true); offset += 4;
        this.skeletonAnimations = [];
        this.weaponAnimations = [];

        // Cap to actual count in file
        const actualSkeletonAnims = Math.min(nsSkeletonAnims, this.nAnimations);
        const actualWeaponAnims = Math.min(nsWeaponAnims, this.nAnimations - actualSkeletonAnims);

        // Parse skeleton animations
        for (let i = 0; i < actualSkeletonAnims && offset < buffer.length; i++) {
            try {
                const anim = parseAnimation(view, offset, skeletonBones);
                this.skeletonAnimations.push(anim.data);
                offset = anim.nextOffset;
            } catch {
                break;
            }
        }

        // Parse weapon animations (1 bone each)
        for (let i = 0; i < actualWeaponAnims && offset < buffer.length; i++) {
            try {
                const anim = parseAnimation(view, offset, 1);
                this.weaponAnimations.push(anim.data);
                offset = anim.nextOffset;
            } catch {
                break;
            }
        }
    }

    getFirstFrame(): BattleFrame | null {
        if (this.skeletonAnimations.length > 0 && this.skeletonAnimations[0].frames.length > 0) {
            return this.skeletonAnimations[0].frames[0];
        }
        return null;
    }

    getFirstWeaponFrame(): BattleFrame | null {
        if (this.weaponAnimations.length > 0 && this.weaponAnimations[0].frames.length > 0) {
            return this.weaponAnimations[0].frames[0];
        }
        return null;
    }

    getFrame(animIndex: number, frameIndex: number): BattleFrame | null {
        if (animIndex < this.skeletonAnimations.length && frameIndex < this.skeletonAnimations[animIndex].frames.length) {
            return this.skeletonAnimations[animIndex].frames[frameIndex];
        }
        return null;
    }

    getWeaponFrame(animIndex: number, frameIndex: number): BattleFrame | null {
        if (animIndex < this.weaponAnimations.length) {
            const anim = this.weaponAnimations[animIndex];
            if (anim.frames.length > 0) {
                // Loop weapon frame if it has fewer frames than skeleton animation
                const clampedFrame = frameIndex % anim.frames.length;
                return anim.frames[clampedFrame];
            }
        }
        return null;
    }

    // Get number of animations in the pack
    getAnimationCount(): number {
        return this.skeletonAnimations.length;
    }

    // Get frame count for a skeleton animation
    getFrameCount(animIndex: number = 0): number {
        if (animIndex < this.skeletonAnimations.length) {
            return this.skeletonAnimations[animIndex].frames.length;
        }
        return 0;
    }

    // Get frame count for a weapon animation
    getWeaponFrameCount(animIndex: number = 0): number {
        if (animIndex < this.weaponAnimations.length) {
            return this.weaponAnimations[animIndex].frames.length;
        }
        return 0;
    }
}

function parseAnimation(view: DataView, startOffset: number, skeletonBones: number): { data: BattleAnimationData, nextOffset: number } {
    let offset = startOffset;
    
    // Read animation header
    let nBones = view.getInt32(offset, true); offset += 4;
    const numFrames = view.getInt32(offset, true); offset += 4;
    let blockSize = view.getInt32(offset, true); offset += 4;
    
    // Check if skeleton bones should override
    if (skeletonBones === 1) nBones = 1;
    
    const frames: BattleFrame[] = [];
    let numFramesShort = 0;
    let blockSizeShort = 0;
    let key = 0;
        
    if (blockSize > 11) {
        // Read short header
        numFramesShort = view.getUint16(offset, true); offset += 2;
        
        // Handle missing numFramesShort case (RSAA/Frog enemy quirk)
        if (blockSize - 5 === numFramesShort) {
            blockSizeShort = numFramesShort;
            blockSize += 2;
            numFramesShort = numFrames;
        } else {
            blockSizeShort = view.getUint16(offset, true); offset += 2;
        }
        
        key = view.getUint8(offset); offset += 1;
        
        // Read raw frame data
        const framesRawData = new Uint8Array(view.buffer, view.byteOffset + offset, blockSizeShort);
        offset += blockSizeShort;
        
        // Skip padding bytes (alignment to 4 bytes)
        const paddingBytes = (blockSize - blockSizeShort) - 5;
        offset += paddingBytes;
        
        // Parse frames
        const offsetBit = { value: 0 };
        
        // First frame (uncompressed)
        const firstFrame = processUncompressedFrame(framesRawData, offsetBit, key, nBones);
        frames.push(firstFrame);
        
        // Subsequent frames (compressed) - parse all frames for animation playback
        for (let fi = 1; fi < numFramesShort; fi++) {
            const frame = processFrame(framesRawData, offsetBit, key, nBones, frames[fi - 1]);
            if (!frame) break;
            frames.push(frame);
        }
    } else {
        // Small animation - skip the raw data
        offset += blockSize;
    }
    
    return {
        data: {
            nBones,
            numFrames,
            blockSize,
            numFramesShort: frames.length,
            blockSizeShort,
            key,
            frames,
        },
        nextOffset: offset,
    };
}

// Keep old class for backward compatibility (deprecated)
export class BattleAnimation {
    data: BattleAnimationData;

    constructor(buffer: Uint8Array, skeletonBones: number = 0) {
        const pack = new BattleAnimationPack(buffer, skeletonBones);
        this.data = pack.skeletonAnimations[0] || {
            nBones: 0,
            numFrames: 0,
            blockSize: 0,
            numFramesShort: 0,
            blockSizeShort: 0,
            key: 0,
            frames: [],
        };
    }

    getFirstFrame(): BattleFrame | null {
        return this.data.frames[0] || null;
    }

    getFrame(index: number): BattleFrame | null {
        return this.data.frames[index] || null;
    }
}
