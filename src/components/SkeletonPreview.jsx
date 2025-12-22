import { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { SkeletonFile } from '../skeleton.ts';
import { PFile } from '../pfile.ts';
import { TexFile } from '../texfile.ts';
import { BattleAnimationPack } from '../battleAnimFile.ts';
import { createMeshFromPFile } from '../utils/pfileRenderer.js';
import './SkeletonPreview.css';

export function SkeletonPreview({ data, filename, onLoadFile }) {
    const containerRef = useRef(null);
    const [loadedParts, setLoadedParts] = useState(null);
    const [loadedTextures, setLoadedTextures] = useState(null);
    const [loadedBoneModels, setLoadedBoneModels] = useState(null);
    const [loadedWeaponModels, setLoadedWeaponModels] = useState(null);
    const [loadedAnimationPack, setLoadedAnimationPack] = useState(null);
    const [_loadingStatus, setLoadingStatus] = useState('');
    // Track which filename the loaded data corresponds to (null = loading, string = ready)
    const [loadedDataKey, setLoadedDataKey] = useState(null);
    const [selectedWeaponIndex, setSelectedWeaponIndex] = useState(0);
    const [cullingEnabled, setCullingEnabled] = useState(true);
    const cameraStateRef = useRef(null);

    const { skeleton, stats, relatedFiles, isMagicFormat, magicBaseName, error } = useMemo(() => {
        try {
            const parsed = new SkeletonFile(data);
            // Detect magic format (*.d files) vs battle format (4-letter names ending in 'aa')
            const isMagicFmt = filename.toLowerCase().endsWith('.d');
            let relFiles;
            let magicBase = null;
            if (isMagicFmt) {
                // Magic format: remove ".d" extension to get base name
                magicBase = filename.slice(0, -2);
                relFiles = parsed.getRelatedFilesMagic(magicBase);
            } else {
                // Battle format: use first 2 characters
                const baseName = filename.slice(0, 2);
                relFiles = parsed.getRelatedFiles(baseName);
            }
            return {
                skeleton: parsed,
                stats: parsed.getStats(),
                relatedFiles: relFiles,
                isMagicFormat: isMagicFmt,
                magicBaseName: magicBase,
                error: null,
            };
        } catch (err) {
            return { skeleton: null, stats: null, relatedFiles: [], isMagicFormat: false, magicBaseName: null, error: err.message };
        }
    }, [data, filename]);

    // Load P model parts and textures for battle locations
    useEffect(() => {
        if (!skeleton || !skeleton.model.isBattleLocation || !onLoadFile) return;

        const loadPartsAndTextures = async () => {
            const base = filename.slice(0, 2).toUpperCase();

            setLoadingStatus('Loading textures...');

            // Load textures (XXAC to XXAL)
            const textures = [];
            for (let i = 0; i < skeleton.model.header.nTextures && i < 10; i++) {
                const suffix = String.fromCharCode('C'.charCodeAt(0) + i);
                const texName = `${base}A${suffix}`;
                const texData = onLoadFile(texName);

                if (texData) {
                    try {
                        const texFile = new TexFile(texData);
                        textures[i] = createThreeTexture(texFile);
                    } catch (e) {
                        console.warn(`Failed to parse texture ${texName}:`, e.message);
                        textures[i] = null;
                    }
                } else {
                    textures[i] = null;
                }
            }

            setLoadedTextures(textures);
            setLoadingStatus('Loading parts...');

            // Load P model parts (XXAM onwards)
            const parts = [];
            let suffix1 = 'A';
            let suffix2 = 'M';

            for (let i = 0; i < skeleton.model.header.nJoints; i++) {
                const partName = `${base}${suffix1}${suffix2}`;
                const partData = onLoadFile(partName);

                if (partData) {
                    try {
                        const pfile = new PFile(partData);
                        parts.push({ name: partName, pfile, index: i });
                    } catch (e) {
                        console.warn(`Failed to parse ${partName}:`, e.message);
                    }
                }

                suffix2 = String.fromCharCode(suffix2.charCodeAt(0) + 1);
                if (suffix2 > 'Z') {
                    suffix1 = String.fromCharCode(suffix1.charCodeAt(0) + 1);
                    suffix2 = 'A';
                }
            }

            setLoadedParts(parts);
            setLoadingStatus(`Loaded ${parts.length} parts, ${textures.filter(t => t).length} textures`);

            // Mark data as ready for this filename
            setLoadedDataKey(currentFilename);
        };

        const currentFilename = filename;
        loadPartsAndTextures();

        // Cleanup: reset loadedDataKey when dependencies change
        return () => {
            setLoadedDataKey(null);
        };
    }, [skeleton, filename, onLoadFile]);

    // Load bone models, textures, and animation for character/enemy models
    useEffect(() => {
        if (!skeleton || skeleton.model.isBattleLocation || !onLoadFile) return;
        if (skeleton.model.bones.length === 0) return;

        const loadBoneData = async () => {
            const bones = skeleton.model.bones;

            setLoadingStatus('Loading textures...');

            // Load textures
            const textures = [];
            for (let i = 0; i < skeleton.model.header.nTextures && i < 10; i++) {
                let texName;
                if (isMagicFormat && magicBaseName) {
                    // Magic format: base.t00, base.t01, etc.
                    texName = `${magicBaseName}.t${i.toString().padStart(2, '0')}`;
                } else {
                    // Battle format: XXAC, XXAD, etc.
                    const base = filename.slice(0, 2).toUpperCase();
                    const suffix = String.fromCharCode('C'.charCodeAt(0) + i);
                    texName = `${base}A${suffix}`;
                }
                const texData = onLoadFile(texName);

                if (texData) {
                    try {
                        const texFile = new TexFile(texData);
                        textures[i] = createThreeTexture(texFile);
                    } catch {
                        textures[i] = null;
                    }
                } else {
                    textures[i] = null;
                }
            }

            setLoadedTextures(textures);
            setLoadingStatus('Loading bone models...');

            // Load P model for each bone
            const boneModels = [];
            let suffix1 = 'A';
            let suffix2 = 'M';

            for (let i = 0; i < bones.length; i++) {
                const bone = bones[i];
                let partName;
                if (isMagicFormat && magicBaseName) {
                    // Magic format: base.p00, base.p01, etc.
                    partName = `${magicBaseName}.p${i.toString().padStart(2, '0')}`;
                } else {
                    // Battle format: XXAM, XXAN, etc.
                    const base = filename.slice(0, 2).toUpperCase();
                    partName = `${base}${suffix1}${suffix2}`;
                    suffix2 = String.fromCharCode(suffix2.charCodeAt(0) + 1);
                    if (suffix2 > 'Z') {
                        suffix1 = String.fromCharCode(suffix1.charCodeAt(0) + 1);
                        suffix2 = 'A';
                    }
                }

                if (bone.hasModel) {
                    const partData = onLoadFile(partName);
                    if (partData) {
                        try {
                            const pfile = new PFile(partData);
                            boneModels.push({ boneIndex: i, name: partName, pfile });
                        } catch {
                            boneModels.push({ boneIndex: i, name: partName, pfile: null });
                        }
                    } else {
                        boneModels.push({ boneIndex: i, name: partName, pfile: null });
                    }
                } else {
                    boneModels.push({ boneIndex: i, name: partName, pfile: null });
                }
            }

            setLoadedBoneModels(boneModels);

            // Load weapon models if this skeleton has weapons (battle format only: ??CK, ??CL, etc.)
            const weaponModels = [];
            const nWeapons = skeleton.model.header.nWeapons;
            if (nWeapons > 0 && !isMagicFormat) {
                const base = filename.slice(0, 2).toUpperCase();
                setLoadingStatus('Loading weapons...');
                for (let i = 0; i < nWeapons; i++) {
                    const weaponSuffix = String.fromCharCode('K'.charCodeAt(0) + i);
                    const weaponName = `${base}C${weaponSuffix}`;
                    const weaponData = onLoadFile(weaponName);
                    if (weaponData) {
                        try {
                            const pfile = new PFile(weaponData);
                            weaponModels.push({ name: weaponName, pfile, index: i });
                        } catch {
                            weaponModels.push({ name: weaponName, pfile: null, index: i });
                        }
                    } else {
                        weaponModels.push({ name: weaponName, pfile: null, index: i });
                    }
                }
            }
            setLoadedWeaponModels(weaponModels);

            setLoadingStatus('Loading animation...');

            // Try to load animation pack
            let animName;
            if (isMagicFormat && magicBaseName) {
                // Magic format: base.a00
                animName = `${magicBaseName}.a00`;
            } else {
                // Battle format: XXDA
                const base = filename.slice(0, 2).toUpperCase();
                animName = `${base}DA`;
            }
            const animData = onLoadFile(animName);
            if (animData) {
                try {
                    const animPack = new BattleAnimationPack(
                        animData,
                        bones.length,
                        skeleton.model.header.nsSkeletonAnims,
                        skeleton.model.header.nsWeaponsAnims
                    );
                    setLoadedAnimationPack(animPack);
                } catch {
                    setLoadedAnimationPack(null);
                }
            }

            const loadedCount = boneModels.filter(b => b.pfile).length;
            const weaponCount = weaponModels.filter(w => w.pfile).length;
            setLoadingStatus(`Loaded ${loadedCount} bone models, ${weaponCount} weapons, ${textures.filter(t => t).length} textures`);

            // Mark data as ready for this filename
            setLoadedDataKey(currentFilename);
        };

        const currentFilename = filename;
        loadBoneData();

        // Cleanup: reset loadedDataKey when dependencies change (before next effect runs)
        return () => {
            setLoadedDataKey(null);
        };
    }, [skeleton, filename, onLoadFile, isMagicFormat, magicBaseName]);

    // Initialize Three.js scene
    useEffect(() => {
        if (!containerRef.current || !skeleton) return;

        const hasBones = skeleton.model.bones.length > 0;
        const isBattleLocation = skeleton.model.isBattleLocation;

        // Wait for data to be loaded AND match the current filename to avoid glitches
        if (loadedDataKey !== filename) return;
        // For battle locations, wait for parts to load
        if (isBattleLocation && !loadedParts) return;
        // For bone skeletons with no bones, nothing to show
        if (!isBattleLocation && !hasBones) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x000000);

        // Camera
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        camera.up.set(0, 1, 0);

        // Renderer with legacy color handling for faithful FF7 colors
        // Use logarithmic depth buffer for better depth precision at all distances
        const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: !isBattleLocation });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        container.appendChild(renderer.domElement);

        // Controls - orbit style (no roll)
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true; // Shift+drag to pan

        // Lighting (increased for linear color space)
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 2.0);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);
        const backLight = new THREE.DirectionalLight(0xffffff, 0.9);
        backLight.position.set(-1, 0.5, -1);
        scene.add(backLight);

        const meshesToDispose = [];
        let boundingBox = new THREE.Box3();

        let groundPlaneBox = null;

        if (isBattleLocation && loadedParts) {
            // Container for battle location - flip Y and Z to match coordinate system
            const locationContainer = new THREE.Group();
            locationContainer.scale.y = -1;
            locationContainer.scale.z = -1;
            scene.add(locationContainer);
            meshesToDispose.push(locationContainer);

            // Render battle location parts with textures
            loadedParts.forEach((part, partIndex) => {
                const meshGroup = createMeshFromPFile(part.pfile, {
                    textures: loadedTextures || [],
                    cullingEnabled,
                    invertCulling: true,
                    meshIndex: partIndex,
                });
                meshGroup.name = part.name;
                locationContainer.add(meshGroup);

                // First part is the ground plane - capture its bounding box for camera fitting
                if (partIndex === 0 && !groundPlaneBox) {
                    locationContainer.updateMatrixWorld(true);
                    groundPlaneBox = new THREE.Box3().setFromObject(meshGroup);
                }
            });

            locationContainer.updateMatrixWorld(true);
            boundingBox.setFromObject(locationContainer);
        } else if (hasBones && loadedBoneModels) {
            // Render character/enemy skeleton with actual 3D meshes
            const result = renderBattleSkeleton(
                skeleton.model.bones,
                loadedBoneModels,
                loadedTextures || [],
                loadedAnimationPack,
                loadedWeaponModels || [],
                selectedWeaponIndex,
                cullingEnabled
            );

            result.meshes.forEach(mesh => {
                scene.add(mesh);
                meshesToDispose.push(mesh);
            });
            boundingBox = result.boundingBox;
        }

        // Position model so feet are at y=0 and fit camera
        if (!boundingBox.isEmpty()) {
            // Restore camera state only if it's for the same model (e.g., when switching weapons)
            if (cameraStateRef.current && cameraStateRef.current.filename === filename) {
                camera.position.copy(cameraStateRef.current.position);
                controls.target.copy(cameraStateRef.current.target);
                camera.near = cameraStateRef.current.near;
                camera.far = cameraStateRef.current.far;
                camera.updateProjectionMatrix();
                controls.update();
            } else {
                fitCameraToScene(camera, controls, boundingBox, isBattleLocation, groundPlaneBox);
            }
        }

        // Animation loop
        let animationId;
        const animate = () => {
            animationId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

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
            // Save camera state before cleanup for restoration on re-render of same model
            cameraStateRef.current = {
                filename,
                position: camera.position.clone(),
                target: controls.target.clone(),
                near: camera.near,
                far: camera.far,
            };
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationId);
            controls.dispose();
            renderer.dispose();
            meshesToDispose.forEach(mesh => {
                if (mesh.traverse) {
                    mesh.traverse(child => {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            if (Array.isArray(child.material)) {
                                child.material.forEach(m => m.dispose());
                            } else {
                                child.material.dispose();
                            }
                        }
                    });
                } else {
                    mesh.geometry?.dispose();
                    if (mesh.material) {
                        if (Array.isArray(mesh.material)) {
                            mesh.material.forEach(m => m.dispose());
                        } else {
                            mesh.material.dispose();
                        }
                    }
                }
            });
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [skeleton, filename, loadedParts, loadedTextures, loadedBoneModels, loadedWeaponModels, loadedAnimationPack, selectedWeaponIndex, cullingEnabled, loadedDataKey]);

    if (error) {
        return (
            <div className="skeleton-error">
                <div className="skeleton-error-icon">&#9888;</div>
                <div className="skeleton-error-text">Failed to parse skeleton file</div>
                <div className="skeleton-error-detail">{error}</div>
            </div>
        );
    }

    const hasBones = skeleton && skeleton.model.bones.length > 0;
    const isBattleLocation = skeleton && skeleton.model.isBattleLocation;
    // Only show canvas when loaded data matches current filename (applies to both battle locations and characters)
    const dataReadyForCurrentFile = loadedDataKey === filename;
    const showCanvas = dataReadyForCurrentFile && (
        (isBattleLocation && loadedParts && loadedParts.length > 0) ||
        (!isBattleLocation && hasBones)
    );
    const isLoading = !dataReadyForCurrentFile && (
        isBattleLocation ||
        (!isBattleLocation && hasBones)
    );

    return (
        <div className="skeleton-preview">
            {showCanvas ? (
                <div className="skeleton-3d-view" ref={containerRef} />
            ) : isLoading ? (
                <div className="skeleton-loading">
                    {/* <div className="loading-text">Loading...</div>
                    <div className="loading-detail">{_loadingStatus}</div> */}
                </div>
            ) : isBattleLocation && (!onLoadFile || (loadedParts && loadedParts.length === 0)) ? (
                <div className="skeleton-no-hierarchy">
                    <div className="no-hierarchy-icon">&#128506;</div>
                    <div className="no-hierarchy-text">Battle Location</div>
                    <div className="no-hierarchy-detail">
                        {!onLoadFile ? 'Cannot load parts (no LGP context)' : 'No parts found'}
                    </div>
                </div>
            ) : !hasBones ? (
                <div className="skeleton-no-hierarchy">
                    <div className="no-hierarchy-icon">&#128506;</div>
                    <div className="no-hierarchy-text">No bone data</div>
                </div>
            ) : null}
            <div className="skeleton-info-panel">
                <div className="skeleton-header">
                    <div className="skeleton-type">{stats?.type || 'Unknown'}</div>
                    <div className="skeleton-filename">{filename}</div>
                </div>

                {stats && (
                    <div className="skeleton-stats">
                        <div className="skeleton-stat-group">
                            <h3>Structure</h3>
                            <div className="skeleton-stat">
                                <span className="stat-label">Bones</span>
                                <span className="stat-value">{stats.bones}</span>
                            </div>
                            <div className="skeleton-stat">
                                <span className="stat-label">Joints/Parts</span>
                                <span className="stat-value">{stats.joints}</span>
                            </div>
                            <div className="skeleton-stat">
                                <span className="stat-label">Textures</span>
                                <span className="stat-value">{stats.textures}</span>
                            </div>
                            {loadedParts && (
                                <div className="skeleton-stat">
                                    <span className="stat-label">Loaded</span>
                                    <span className="stat-value">{loadedParts.length} parts</span>
                                </div>
                            )}
                            {loadedBoneModels && (
                                <div className="skeleton-stat">
                                    <span className="stat-label">Loaded</span>
                                    <span className="stat-value">{loadedBoneModels.filter(b => b.pfile).length} models</span>
                                </div>
                            )}
                            <div className="skeleton-stat">
                                <label className="stat-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={cullingEnabled}
                                        onChange={(e) => setCullingEnabled(e.target.checked)}
                                    />
                                    <span>Face culling</span>
                                </label>
                            </div>
                        </div>

                        <div className="skeleton-stat-group">
                            <h3>Animations</h3>
                            <div className="skeleton-stat">
                                <span className="stat-label">Skeleton Anims</span>
                                <span className="stat-value">{stats.skeletonAnims}</span>
                            </div>
                            {stats.weapons > 0 && (
                                <>
                                    <div className="skeleton-stat">
                                        <span className="stat-label">Weapons</span>
                                        <span className="stat-value">{stats.weapons}</span>
                                    </div>
                                    <div className="skeleton-stat">
                                        <span className="stat-label">Weapon Anims</span>
                                        <span className="stat-value">{stats.weaponAnims}</span>
                                    </div>
                                    {loadedWeaponModels && loadedWeaponModels.length > 1 && (
                                        <div className="skeleton-stat weapon-selector">
                                            <span className="stat-label">Show Weapon</span>
                                            <select
                                                value={selectedWeaponIndex}
                                                onChange={(e) => setSelectedWeaponIndex(Number(e.target.value))}
                                                className="weapon-select"
                                            >
                                                {loadedWeaponModels.map((weapon, index) => (
                                                    <option key={index} value={index} disabled={!weapon.pfile}>
                                                        {index + 1}. {weapon.name}{!weapon.pfile ? ' (not found)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {skeleton && skeleton.model.bones.length > 0 && (
                    <div className="skeleton-bones">
                        <h3>Bone Hierarchy</h3>
                        <div className="bone-list">
                            {skeleton.model.bones.map((bone, index) => (
                                <div key={index} className="bone-item">
                                    <span className="bone-index">{index}</span>
                                    <span className="bone-parent">
                                        parent: {bone.parentBone <= 0 ? 'root' : bone.parentBone - 1}
                                    </span>
                                    <span className="bone-length">len: {Math.abs(bone.length).toFixed(1)}</span>
                                    {bone.hasModel && <span className="bone-has-model">P</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {relatedFiles && relatedFiles.length > 0 && (
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

// Convert TexFile to Three.js texture
function createThreeTexture(texFile) {
    const pixels = texFile.getPixels(0);
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
    return texture;
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

    // Multiply in YXZ order: Y * X * Z
    const result = new THREE.Quaternion();
    result.copy(qy);
    result.multiply(qx);
    result.multiply(qz);

    return result;
}

// Render battle skeleton with bone hierarchy and animation transforms
function renderBattleSkeleton(bones, boneModels, textures, animationPack, weaponModels = [], selectedWeaponIndex = 0, cullingEnabled = true) {
    const meshes = [];
    const boundingBox = new THREE.Box3();

    // Get first animation frame if available
    const frame = animationPack?.getFirstFrame();
    // Get first weapon animation frame if available
    const weaponFrame = animationPack?.getFirstWeaponFrame();

    // Create skeleton group with root transform
    const skeletonGroup = new THREE.Group();

    if (frame) {
        // Apply root translation
        skeletonGroup.position.set(frame.startX, frame.startY, frame.startZ);

        // Apply root rotation (first bone rotation is root rotation)
        if (frame.bones.length > 0) {
            const rootQuat = buildQuaternionYXZ(
                frame.bones[0].alpha,
                frame.bones[0].beta,
                frame.bones[0].gamma
            );
            skeletonGroup.quaternion.copy(rootQuat);
        }
    }

    // For bone index offset in animation
    // If nBones > 1, bone rotations start at frame.bones[1] for bone 0
    const itmpbones = bones.length > 1 ? 1 : 0;

    // Build bone hierarchy using stack (matching Kimera's DrawBattleSkeleton)
    const jointStack = [-1];  // Sentinel for root
    const matrixStack = [new THREE.Matrix4()];

    for (let boneIdx = 0; boneIdx < bones.length; boneIdx++) {
        const bone = bones[boneIdx];

        // Navigate hierarchy - pop until we find matching parent
        while (jointStack.length > 1 && bone.parentBone !== jointStack[jointStack.length - 1]) {
            jointStack.pop();
            matrixStack.pop();
        }

        // Get current transform from parent
        const currentMatrix = matrixStack[matrixStack.length - 1].clone();

        // Apply bone rotation from animation
        if (frame && frame.bones[boneIdx + itmpbones]) {
            const rot = frame.bones[boneIdx + itmpbones];
            const boneQuat = buildQuaternionYXZ(rot.alpha, rot.beta, rot.gamma);
            const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(boneQuat);
            currentMatrix.multiply(rotMatrix);
        }

        // Render P model at current transform if this bone has one
        const boneModel = boneModels[boneIdx];
        if (boneModel && boneModel.pfile) {
            const meshGroup = createMeshFromPFile(boneModel.pfile, {
                textures,
                cullingEnabled,
                invertCulling: true,
                meshIndex: boneIdx,
            });
            meshGroup.applyMatrix4(currentMatrix);
            skeletonGroup.add(meshGroup);

            // Expand bounding box
            const meshBox = new THREE.Box3().setFromObject(meshGroup);
            boundingBox.union(meshBox);
        }

        // Translate along +Z by bone length for next bone (battle skeleton uses +Z)
        const translateMatrix = new THREE.Matrix4().makeTranslation(0, 0, bone.length);
        currentMatrix.multiply(translateMatrix);

        // Push current bone onto stack
        jointStack.push(boneIdx);
        matrixStack.push(currentMatrix);

        // Expand bounding box with bone endpoint
        const boneEnd = new THREE.Vector3(0, 0, 0).applyMatrix4(currentMatrix);
        boundingBox.expandByPoint(boneEnd);
    }

    // Container for the skeleton - flip Y to match coordinate system
    const modelContainer = new THREE.Group();
    modelContainer.scale.y = -1;
    modelContainer.scale.z = -1;
    modelContainer.add(skeletonGroup);

    // Render weapon if available (PC battle models like Cloud have weapons)
    // Weapon is rendered INDEPENDENTLY from skeleton - it has its own world-space transforms
    // (not as a child of skeletonGroup, but as a sibling inside modelContainer)
    if (weaponModels.length > 0 && weaponFrame && weaponFrame.bones.length > 0) {
        // Use selected weapon model
        const weaponModel = weaponModels[selectedWeaponIndex];
        if (weaponModel && weaponModel.pfile) {
            const weaponGroup = new THREE.Group();

            // Apply weapon frame position (world-space, like skeleton's root position)
            weaponGroup.position.set(weaponFrame.startX, weaponFrame.startY, weaponFrame.startZ);

            // Apply weapon frame rotation using quaternion (matching Kimera's approach)
            const weaponQuat = buildQuaternionYXZ(
                weaponFrame.bones[0].alpha,
                weaponFrame.bones[0].beta,
                weaponFrame.bones[0].gamma
            );
            weaponGroup.quaternion.copy(weaponQuat);

            // Create weapon mesh and add to weapon group
            // Use high meshIndex (bones.length + 10) so weapon renders on top of body parts
            const weaponMesh = createMeshFromPFile(weaponModel.pfile, {
                textures,
                cullingEnabled,
                invertCulling: true,
                meshIndex: bones.length + 10,
            });
            weaponGroup.add(weaponMesh);

            // Add weapon as sibling to skeletonGroup (both are children of modelContainer)
            modelContainer.add(weaponGroup);
        }
    }

    // Compute actual world bounding box after all transforms (including skeletonGroup's position/rotation)
    modelContainer.updateMatrixWorld(true);
    const worldBox = new THREE.Box3().setFromObject(modelContainer);

    // Position model so feet (bottom after flip) are at y=0
    if (!worldBox.isEmpty()) {
        modelContainer.position.y = -worldBox.min.y;

        // Recompute final bounding box for camera fitting
        modelContainer.updateMatrixWorld(true);
        const finalBox = new THREE.Box3().setFromObject(modelContainer);
        meshes.push(modelContainer);
        return { meshes, boundingBox: finalBox };
    }

    meshes.push(modelContainer);
    return { meshes, boundingBox: new THREE.Box3() };
}

function fitCameraToScene(camera, controls, boundingBox, isBattleLocation = false, groundPlaneBox = null) {
    const fullSize = boundingBox.getSize(new THREE.Vector3());
    const fullMaxDim = Math.max(fullSize.x, fullSize.y, fullSize.z);

    // For battle locations, use ground plane box for camera distance; otherwise use full bounding box
    let fitBox = boundingBox;
    if (isBattleLocation && groundPlaneBox && !groundPlaneBox.isEmpty()) {
        fitBox = groundPlaneBox;
    }

    const size = fitBox.getSize(new THREE.Vector3());
    const center = fitBox.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const fov = camera.fov * (Math.PI / 180);
    let cameraDist = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraDist *= 1.5;

    // Orbit around the fit box center
    const orbitTarget = center;

    camera.position.set(
        orbitTarget.x + cameraDist * 0.3,
        orbitTarget.y + cameraDist * 0.3,
        orbitTarget.z + cameraDist
    );
    camera.lookAt(orbitTarget);

    controls.target.copy(orbitTarget);
    if (controls.minDistance !== undefined) {
        controls.minDistance = maxDim * 0.1;
        controls.maxDistance = fullMaxDim * 10;
    }
    controls.update();

    // Use full scene bounds for near/far to avoid clipping distant objects
    camera.near = Math.max(0.01, fullMaxDim / 100);
    camera.far = Math.max(1000, fullMaxDim * 100);
    camera.updateProjectionMatrix();
}
