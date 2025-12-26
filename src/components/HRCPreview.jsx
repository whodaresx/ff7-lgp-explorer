import { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { HRCFile } from '../hrcfile.ts';
import { RSDFile } from '../rsdfile.ts';
import { PFile } from '../pfile.ts';
import { FieldAnimation } from '../animfile.ts';
import { TexFile } from '../texfile.ts';
import { createMeshFromPFile, fitCameraToObject } from '../utils/pfileRenderer.js';
import modelAnimations from '../assets/model-animations.json';
import './SkeletonPreview.css';

export function HRCPreview({ data, filename, onLoadFile }) {
    const containerRef = useRef(null);

    // Animation playback state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentFrame, setCurrentFrame] = useState(0);
    const [selectedAnimIndex, setSelectedAnimIndex] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
    const [loadedAnimations, setLoadedAnimations] = useState([]);

    // Animation refs (avoid stale closures in animation loop)
    const isPlayingRef = useRef(false);
    const currentFrameRef = useRef(0);
    const selectedAnimIndexRef = useRef(0);
    const playbackSpeedRef = useRef(1.0);
    const animationTimeRef = useRef(0);
    const lastTimeRef = useRef(0);

    // Scene refs for animation updates
    const boneMeshesRef = useRef([]);
    const skeletonGroupRef = useRef(null);
    const bonesRef = useRef([]);
    const loadedAnimationsRef = useRef([]);

    // Sync state to refs for animation loop
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);
    useEffect(() => { selectedAnimIndexRef.current = selectedAnimIndex; }, [selectedAnimIndex]);
    useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);
    useEffect(() => { loadedAnimationsRef.current = loadedAnimations; }, [loadedAnimations]);

    const { hrc, stats, relatedFiles, error } = useMemo(() => {
        try {
            const parsed = new HRCFile(data);
            return {
                hrc: parsed,
                stats: parsed.getStats(),
                relatedFiles: parsed.getRelatedFiles(),
                error: null,
            };
        } catch (err) {
            return { hrc: null, stats: null, relatedFiles: [], error: err.message };
        }
    }, [data]);

    // Load all available animations for this model
    useEffect(() => {
        if (!hrc || !onLoadFile) {
            setLoadedAnimations([]);
            return;
        }

        const modelCode = filename.toLowerCase().replace('.hrc', '');
        const animList = modelAnimations[modelCode];

        if (!animList || animList.length === 0) {
            setLoadedAnimations([]);
            return;
        }

        const animations = [];
        for (const animCode of animList) {
            const animFilename = `${animCode}.a`;
            const animData = onLoadFile(animFilename);
            if (animData) {
                try {
                    const anim = new FieldAnimation(animData);
                    // Check if bone count matches
                    if (anim.data.nBones === hrc.data.bones.length ||
                        (hrc.data.bones.length === 1 && anim.data.nBones === 0)) {
                        animations.push({
                            name: animCode,
                            animation: anim,
                            frameCount: anim.data.nFrames,
                        });
                    }
                } catch {
                    // Not a valid animation file
                }
            }
        }

        setLoadedAnimations(animations);

        // Find first animation with frames
        let initialAnimIndex = 0;
        for (let i = 0; i < animations.length; i++) {
            if (animations[i].frameCount > 0) {
                initialAnimIndex = i;
                break;
            }
        }

        // Reset animation state
        setCurrentFrame(0);
        setIsPlaying(false);
        setSelectedAnimIndex(initialAnimIndex);
        animationTimeRef.current = 0;
        currentFrameRef.current = 0;
        selectedAnimIndexRef.current = initialAnimIndex;
    }, [hrc, filename, onLoadFile]);

    // Initialize Three.js scene and load models
    useEffect(() => {
        if (!containerRef.current || !hrc || hrc.data.bones.length === 0) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        // Camera
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
        camera.up.set(0, 1, 0);

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        container.appendChild(renderer.domElement);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true;

        const lightIntensity = 5;

        // FF7-style lighting setup
        const ambientLight = new THREE.AmbientLight(0x888888, lightIntensity);
        scene.add(ambientLight);

        const light1 = new THREE.DirectionalLight(0x909090, lightIntensity);
        light1.position.set(-100, -2100, -3500).normalize();
        scene.add(light1);

        const light2 = new THREE.DirectionalLight(0x888888, lightIntensity);
        light2.position.set(1500, -1400, 2900).normalize();
        scene.add(light2);

        const light3 = new THREE.DirectionalLight(0x4d4d4d, lightIntensity);
        light3.position.set(-3000, -1400, 2500).normalize();
        scene.add(light3);

        // Track all meshes for cleanup
        const allMeshes = [];
        let cancelled = false;

        // Get current animation frame
        const getCurrentFrame = () => {
            if (loadedAnimations.length === 0) return null;
            const animData = loadedAnimations[selectedAnimIndex];
            if (!animData) return null;
            return animData.animation.getFrame(currentFrame);
        };

        // Load and render actual models with animation transforms
        const loadModels = async () => {
            const bones = hrc.data.bones;
            bonesRef.current = bones;

            // Get initial frame
            const frame = getCurrentFrame();

            // Create skeleton group with root transform
            const skeletonGroup = new THREE.Group();
            skeletonGroupRef.current = skeletonGroup;

            if (frame) {
                // The modelContainer's scale flip (scale.y = -1, scale.z = -1) handles coordinate conversion
                skeletonGroup.position.set(
                    frame.rootTranslation.x,
                    frame.rootTranslation.y,
                    frame.rootTranslation.z
                );
                const rootQuat = buildQuaternionYXZ(
                    frame.rootRotation.alpha,
                    frame.rootRotation.beta,
                    frame.rootRotation.gamma
                );
                skeletonGroup.quaternion.copy(rootQuat);
            }

            // Container for the skeleton - flip Y to match HRC coordinate system
            const modelContainer = new THREE.Group();
            modelContainer.scale.y = -1;
            modelContainer.scale.z = -1;
            modelContainer.add(skeletonGroup);

            scene.add(modelContainer);
            allMeshes.push(modelContainer);

            // Store bone meshes for animation
            const boneMeshes = [];

            // Build joint hierarchy using a stack
            const jointStack = [bones[0]?.parentName || 'root'];
            const matrixStack = [new THREE.Matrix4()];

            for (let idx = 0; idx < bones.length; idx++) {
                if (cancelled) return;

                const bone = bones[idx];

                // Navigate hierarchy - pop until we find matching parent
                while (jointStack.length > 1 && bone.parentName !== jointStack[jointStack.length - 1]) {
                    jointStack.pop();
                    matrixStack.pop();
                }

                // Get current transform from parent
                const currentMatrix = matrixStack[matrixStack.length - 1].clone();

                // Apply bone rotation from animation
                if (frame && frame.boneRotations[idx]) {
                    const rot = frame.boneRotations[idx];
                    const boneQuat = buildQuaternionYXZ(rot.alpha, rot.beta, rot.gamma);
                    const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(boneQuat);
                    currentMatrix.multiply(rotMatrix);
                }

                // Load and position mesh at current transform
                if (bone.resourceCount > 0 && bone.resources.length > 0 && onLoadFile) {
                    for (const rsdName of bone.resources) {
                        if (cancelled) return;

                        const rsdFilename = `${rsdName.toLowerCase()}.rsd`;
                        const rsdData = onLoadFile(rsdFilename);

                        if (rsdData) {
                            try {
                                const rsd = new RSDFile(rsdData);
                                const pFilename = rsd.getPModelFilename().toLowerCase();
                                const pData = onLoadFile(pFilename);

                                if (pData) {
                                    // Load textures referenced by RSD
                                    const textures = [];
                                    const texFilenames = rsd.getTextureFilenames();
                                    for (const texFilename of texFilenames) {
                                        const texData = onLoadFile(texFilename.toLowerCase());
                                        if (texData) {
                                            try {
                                                const texFile = new TexFile(texData);
                                                const pixels = texFile.getPixels();
                                                const texture = new THREE.DataTexture(
                                                    pixels,
                                                    texFile.data.width,
                                                    texFile.data.height,
                                                    THREE.RGBAFormat
                                                );
                                                texture.flipY = false;
                                                texture.wrapS = THREE.RepeatWrapping;
                                                texture.wrapT = THREE.RepeatWrapping;
                                                texture.magFilter = THREE.NearestFilter;
                                                texture.minFilter = THREE.NearestFilter;
                                                texture.needsUpdate = true;
                                                textures.push(texture);
                                            } catch {
                                                textures.push(null);
                                            }
                                        } else {
                                            textures.push(null);
                                        }
                                    }

                                    const pfile = new PFile(pData);
                                    const mesh = createMeshFromPFile(pfile, {
                                        textures,
                                        cullingEnabled: false,
                                    });

                                    // Apply accumulated transform
                                    mesh.applyMatrix4(currentMatrix);
                                    mesh.matrixAutoUpdate = false;  // For animation updates

                                    skeletonGroup.add(mesh);
                                    allMeshes.push(mesh);
                                    boneMeshes.push({ boneIndex: idx, mesh });
                                }
                            } catch {
                                console.warn(`Failed to load model for bone ${bone.name}`);
                            }
                        }
                    }
                }

                // Translate along -Z by bone length for next bone
                const translateMatrix = new THREE.Matrix4().makeTranslation(0, 0, -bone.length);
                currentMatrix.multiply(translateMatrix);

                // Push current bone's name onto stack
                jointStack.push(bone.name);
                matrixStack.push(currentMatrix);
            }

            boneMeshesRef.current = boneMeshes;

            // If no models loaded, fall back to placeholder visualization
            if (boneMeshes.length === 0) {
                const placeholderGroup = createPlaceholderWithAnimation(hrc, frame);
                skeletonGroup.add(placeholderGroup);
                allMeshes.push(placeholderGroup);
            }

            // Compute world bounding box after all transforms
            modelContainer.updateMatrixWorld(true);
            const worldBox = new THREE.Box3().setFromObject(modelContainer);

            // Position model so feet are at y=0 and fit camera
            if (!worldBox.isEmpty()) {
                modelContainer.position.y = -worldBox.min.y;
                modelContainer.updateMatrixWorld(true);
                const finalBox = new THREE.Box3().setFromObject(modelContainer);
                fitCameraToObject(camera, controls, finalBox);
            }
        };

        loadModels();

        // Animation loop with frame advancement
        let animationId;
        lastTimeRef.current = performance.now();

        const animate = (currentTime) => {
            animationId = requestAnimationFrame(animate);

            // Animation playback logic
            if (isPlayingRef.current && loadedAnimationsRef.current.length > 0) {
                const deltaTime = currentTime - lastTimeRef.current;
                lastTimeRef.current = currentTime;

                // Field animations run at 30 FPS
                const FRAME_DURATION = 1000 / 30;
                animationTimeRef.current += deltaTime * playbackSpeedRef.current;

                const animData = loadedAnimationsRef.current[selectedAnimIndexRef.current];
                if (animData && animData.frameCount > 0) {
                    const frameFloat = animationTimeRef.current / FRAME_DURATION;
                    const frameIndex = Math.floor(frameFloat) % animData.frameCount;

                    if (frameIndex !== currentFrameRef.current) {
                        currentFrameRef.current = frameIndex;
                        setCurrentFrame(frameIndex);

                        const frame = animData.animation.getFrame(frameIndex);
                        applyFrameToMeshes(
                            frame,
                            boneMeshesRef.current,
                            skeletonGroupRef.current,
                            bonesRef.current,
                            hrc
                        );
                    }
                }
            } else {
                lastTimeRef.current = currentTime;
            }

            controls.update();
            renderer.render(scene, camera);
        };
        animate(performance.now());

        // Handle resize
        const handleResize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            cancelled = true;
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationId);
            controls.dispose();
            renderer.dispose();
            allMeshes.forEach(mesh => {
                if (mesh.traverse) {
                    mesh.traverse(child => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) child.material.dispose();
                    });
                } else {
                    mesh.geometry?.dispose();
                    mesh.material?.dispose();
                }
            });
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hrc, onLoadFile, filename, loadedAnimations]);

    if (error) {
        return (
            <div className="skeleton-error">
                <div className="skeleton-error-icon">&#9888;</div>
                <div className="skeleton-error-text">Failed to parse HRC file</div>
                <div className="skeleton-error-detail">{error}</div>
            </div>
        );
    }

    const hasBones = hrc && hrc.data.bones.length > 0;

    // Helper function to apply a specific frame (for manual scrubbing)
    const applyFrame = (frameIndex) => {
        if (loadedAnimations.length === 0 || !boneMeshesRef.current.length) return;

        const animData = loadedAnimations[selectedAnimIndex];
        if (!animData) return;

        const frame = animData.animation.getFrame(frameIndex);
        applyFrameToMeshes(
            frame,
            boneMeshesRef.current,
            skeletonGroupRef.current,
            bonesRef.current,
            hrc
        );
    };

    // Get frame count for current animation
    const frameCount = loadedAnimations[selectedAnimIndex]?.frameCount || 0;
    const animationCount = loadedAnimations.length;

    return (
        <div className="skeleton-preview">
            {hasBones ? (
                <div className="skeleton-3d-view" ref={containerRef} />
            ) : (
                <div className="skeleton-no-hierarchy">
                    <div className="no-hierarchy-icon">&#128506;</div>
                    <div className="no-hierarchy-text">No bones in skeleton</div>
                </div>
            )}
            <div className="skeleton-info-panel">
                <div className="skeleton-header">
                    <div className="skeleton-type">{stats?.type || 'Field Skeleton'}</div>
                    <div className="skeleton-filename">{filename}</div>
                </div>

                <div className="skeleton-stats">
                    <div className="skeleton-stat-group">
                        <h3>Structure</h3>
                        <div className="skeleton-stat">
                            <span className="stat-label">Name</span>
                            <span className="stat-value">{stats?.name || '-'}</span>
                        </div>
                        <div className="skeleton-stat">
                            <span className="stat-label">Bones</span>
                            <span className="stat-value">{stats?.bones || 0}</span>
                        </div>
                        <div className="skeleton-stat">
                            <span className="stat-label">With Models</span>
                            <span className="stat-value">{stats?.bonesWithModels || 0}</span>
                        </div>
                    </div>

                    <div className="skeleton-stat-group">
                        <h3>Animations</h3>
                        <div className="skeleton-stat">
                            <span className="stat-label">Available</span>
                            <span className="stat-value">{animationCount}</span>
                        </div>

                        {/* Animation Playback Controls */}
                        {loadedAnimations.length > 0 && frameCount > 0 && (
                            <div className="animation-controls">
                                {/* Animation selector (if multiple animations) */}
                                {animationCount > 1 && (
                                    <div className="skeleton-stat animation-selector">
                                        <span className="stat-label">Animation</span>
                                        <div className="animation-nav">
                                            <button
                                                className="playback-btn"
                                                onClick={() => {
                                                    // Find previous animation with frames
                                                    let newIndex = selectedAnimIndex - 1;
                                                    while (newIndex >= 0 && loadedAnimations[newIndex].frameCount === 0) {
                                                        newIndex--;
                                                    }
                                                    if (newIndex < 0) {
                                                        newIndex = animationCount - 1;
                                                        while (newIndex > selectedAnimIndex && loadedAnimations[newIndex].frameCount === 0) {
                                                            newIndex--;
                                                        }
                                                    }
                                                    if (newIndex !== selectedAnimIndex && loadedAnimations[newIndex].frameCount > 0) {
                                                        setSelectedAnimIndex(newIndex);
                                                        setCurrentFrame(0);
                                                        animationTimeRef.current = 0;
                                                        const frame = loadedAnimations[newIndex].animation.getFrame(0);
                                                        applyFrameToMeshes(frame, boneMeshesRef.current, skeletonGroupRef.current, bonesRef.current, hrc);
                                                    }
                                                }}
                                                title="Previous animation"
                                            >
                                                «
                                            </button>
                                            <select
                                                value={selectedAnimIndex}
                                                onChange={(e) => {
                                                    const newIndex = Number(e.target.value);
                                                    setSelectedAnimIndex(newIndex);
                                                    setCurrentFrame(0);
                                                    animationTimeRef.current = 0;
                                                    if (loadedAnimations[newIndex]) {
                                                        const frame = loadedAnimations[newIndex].animation.getFrame(0);
                                                        applyFrameToMeshes(frame, boneMeshesRef.current, skeletonGroupRef.current, bonesRef.current, hrc);
                                                    }
                                                }}
                                                className="weapon-select"
                                            >
                                                {loadedAnimations.map((anim, i) => (
                                                    <option key={i} value={i} disabled={anim.frameCount === 0}>
                                                        {anim.name} ({anim.frameCount} frames)
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                className="playback-btn"
                                                onClick={() => {
                                                    // Find next animation with frames
                                                    let newIndex = selectedAnimIndex + 1;
                                                    while (newIndex < animationCount && loadedAnimations[newIndex].frameCount === 0) {
                                                        newIndex++;
                                                    }
                                                    if (newIndex >= animationCount) {
                                                        newIndex = 0;
                                                        while (newIndex < selectedAnimIndex && loadedAnimations[newIndex].frameCount === 0) {
                                                            newIndex++;
                                                        }
                                                    }
                                                    if (newIndex !== selectedAnimIndex && loadedAnimations[newIndex].frameCount > 0) {
                                                        setSelectedAnimIndex(newIndex);
                                                        setCurrentFrame(0);
                                                        animationTimeRef.current = 0;
                                                        const frame = loadedAnimations[newIndex].animation.getFrame(0);
                                                        applyFrameToMeshes(frame, boneMeshesRef.current, skeletonGroupRef.current, bonesRef.current, hrc);
                                                    }
                                                }}
                                                title="Next animation"
                                            >
                                                »
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Playback controls */}
                                <div className="skeleton-stat playback-controls">
                                    <button
                                        className="playback-btn"
                                        onClick={() => setIsPlaying(!isPlaying)}
                                        title={isPlaying ? 'Pause' : 'Play'}
                                    >
                                        {isPlaying ? '⏸' : '▶'}
                                    </button>
                                    <button
                                        className="playback-btn"
                                        onClick={() => {
                                            setCurrentFrame(0);
                                            animationTimeRef.current = 0;
                                            applyFrame(0);
                                        }}
                                        title="Reset"
                                    >
                                        ⏮
                                    </button>
                                    <span className="frame-counter">
                                        {currentFrame + 1}/{frameCount}
                                    </span>
                                </div>

                                {/* Frame slider */}
                                <div className="skeleton-stat frame-slider">
                                    <input
                                        type="range"
                                        min={0}
                                        max={frameCount - 1}
                                        value={currentFrame}
                                        onChange={(e) => {
                                            const frame = Number(e.target.value);
                                            setCurrentFrame(frame);
                                            animationTimeRef.current = frame * (1000 / 30);
                                            applyFrame(frame);
                                        }}
                                        className="frame-range"
                                    />
                                </div>

                                {/* Speed control */}
                                <div className="skeleton-stat speed-control">
                                    <span className="stat-label">Speed</span>
                                    <select
                                        value={playbackSpeed}
                                        onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                                        className="speed-select"
                                    >
                                        <option value={0.25}>0.25x</option>
                                        <option value={0.5}>0.5x</option>
                                        <option value={1}>1x</option>
                                        <option value={2}>2x</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {hrc && hrc.data.bones.length > 0 && (
                    <div className="skeleton-bones">
                        <h3>Bone Hierarchy</h3>
                        <div className="bone-list">
                            {hrc.data.bones.map((bone, index) => (
                                <div key={index} className="bone-item">
                                    <span className="bone-index">{index}</span>
                                    <span className="bone-parent" title={bone.name}>
                                        {bone.name}
                                    </span>
                                    <span className="bone-length">len: {bone.length.toFixed(1)}</span>
                                    {bone.resourceCount > 0 && (
                                        <span className="bone-has-model">P</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {relatedFiles.length > 0 && (
                    <div className="skeleton-files">
                        <h3>Related Files</h3>
                        <div className="file-list">
                            {relatedFiles.map((file, index) => (
                                <div key={index} className="file-item">
                                    <span className="file-name">{file.name}</span>
                                    <span className="file-type">{file.type}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Build quaternion from Euler angles in YXZ order (matching Kimera's BuildRotationMatrixWithQuaternions)
function buildQuaternionYXZ(alpha, beta, gamma) {
    const DEG2RAD = Math.PI / 180;

    const ax = (alpha * DEG2RAD) / 2;
    const ay = (beta * DEG2RAD) / 2;
    const az = (gamma * DEG2RAD) / 2;

    const qx = new THREE.Quaternion(Math.sin(ax), 0, 0, Math.cos(ax));
    const qy = new THREE.Quaternion(0, Math.sin(ay), 0, Math.cos(ay));
    const qz = new THREE.Quaternion(0, 0, Math.sin(az), Math.cos(az));

    const result = new THREE.Quaternion();
    result.multiplyQuaternions(qy, qx);
    result.multiply(qz);

    return result;
}

// Apply animation frame to meshes using matrix stack algorithm
function applyFrameToMeshes(frame, boneMeshes, skeletonGroup, bones, hrc) {
    if (!frame || !skeletonGroup || !boneMeshes.length) return;

    // Apply root position and rotation to skeleton group
    // The modelContainer's scale flip (scale.y = -1, scale.z = -1) handles coordinate conversion
    skeletonGroup.position.set(
        frame.rootTranslation.x,
        frame.rootTranslation.y,
        frame.rootTranslation.z
    );
    const rootQuat = buildQuaternionYXZ(
        frame.rootRotation.alpha,
        frame.rootRotation.beta,
        frame.rootRotation.gamma
    );
    skeletonGroup.quaternion.copy(rootQuat);

    // Rebuild bone matrices using stack algorithm
    const jointStack = [bones[0]?.parentName || 'root'];
    const matrixStack = [new THREE.Matrix4()];
    const boneMatrices = new Map();

    for (let idx = 0; idx < bones.length; idx++) {
        const bone = bones[idx];

        // Navigate hierarchy - pop until we find matching parent
        while (jointStack.length > 1 && bone.parentName !== jointStack[jointStack.length - 1]) {
            jointStack.pop();
            matrixStack.pop();
        }

        // Get current transform from parent
        const currentMatrix = matrixStack[matrixStack.length - 1].clone();

        // Apply bone rotation from animation
        if (frame.boneRotations[idx]) {
            const rot = frame.boneRotations[idx];
            const boneQuat = buildQuaternionYXZ(rot.alpha, rot.beta, rot.gamma);
            const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(boneQuat);
            currentMatrix.multiply(rotMatrix);
        }

        // Store matrix for this bone
        boneMatrices.set(idx, currentMatrix.clone());

        // Translate along -Z by bone length for children
        const translateMatrix = new THREE.Matrix4().makeTranslation(0, 0, -bone.length);
        currentMatrix.multiply(translateMatrix);

        // Push for children
        jointStack.push(bone.name);
        matrixStack.push(currentMatrix);
    }

    // Apply computed matrices to meshes
    for (const { boneIndex, mesh } of boneMeshes) {
        const matrix = boneMatrices.get(boneIndex);
        if (matrix) {
            mesh.matrix.identity();
            mesh.applyMatrix4(matrix);
        }
    }
}

// Fallback placeholder visualization with animation transforms
function createPlaceholderWithAnimation(hrc, frame) {
    const group = new THREE.Group();
    const bones = hrc.data.bones;

    const jointStack = [bones[0]?.parentName || 'root'];
    const matrixStack = [new THREE.Matrix4()];

    bones.forEach((bone, idx) => {
        while (jointStack.length > 1 && bone.parentName !== jointStack[jointStack.length - 1]) {
            jointStack.pop();
            matrixStack.pop();
        }

        const currentMatrix = matrixStack[matrixStack.length - 1].clone();

        if (frame && frame.boneRotations[idx]) {
            const rot = frame.boneRotations[idx];
            const boneQuat = buildQuaternionYXZ(rot.alpha, rot.beta, rot.gamma);
            const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(boneQuat);
            currentMatrix.multiply(rotMatrix);
        }

        // Color by depth
        let depth = 0;
        let current = idx;
        while (current >= 0) {
            const pIdx = hrc.getBoneParentIndex(current);
            if (pIdx < 0) break;
            depth++;
            current = pIdx;
        }
        const r = Math.max(0, 1 - depth * 0.08);
        const g = 0.4;
        const b = Math.min(1, 0.2 + depth * 0.08);
        const boneColor = new THREE.Color(r, g, b);

        // Create joint sphere
        const jointRadius = Math.max(bone.length * 0.08, 0.1);
        const jointGeometry = new THREE.SphereGeometry(jointRadius, 8, 8);
        const jointMaterial = new THREE.MeshLambertMaterial({
            color: boneColor,
            emissive: boneColor,
            emissiveIntensity: 0.3,
        });
        const jointMesh = new THREE.Mesh(jointGeometry, jointMaterial);
        jointMesh.applyMatrix4(currentMatrix);
        group.add(jointMesh);

        // Create bone cylinder
        if (bone.length > 0.01) {
            const boneRadius = Math.max(bone.length * 0.04, 0.05);
            const boneGeometry = new THREE.CylinderGeometry(boneRadius, boneRadius, bone.length, 6);
            const boneMaterial = new THREE.MeshLambertMaterial({ color: boneColor });
            const boneMesh = new THREE.Mesh(boneGeometry, boneMaterial);

            boneMesh.rotation.x = Math.PI / 2;
            boneMesh.position.z = -bone.length / 2;

            const boneGroup = new THREE.Group();
            boneGroup.add(boneMesh);
            boneGroup.applyMatrix4(currentMatrix);
            group.add(boneGroup);
        }

        const translateMatrix = new THREE.Matrix4().makeTranslation(0, 0, -bone.length);
        currentMatrix.multiply(translateMatrix);

        jointStack.push(bone.name);
        matrixStack.push(currentMatrix);
    });

    return group;
}
