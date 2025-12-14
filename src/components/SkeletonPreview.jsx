import { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { SkeletonFile } from '../skeleton.ts';
import { PFile } from '../pfile.ts';
import { TexFile } from '../texfile.ts';
import { BattleAnimation } from '../battleAnimFile.ts';
import './SkeletonPreview.css';

export function SkeletonPreview({ data, filename, onLoadFile }) {
    const containerRef = useRef(null);
    const [loadedParts, setLoadedParts] = useState(null);
    const [loadedTextures, setLoadedTextures] = useState(null);
    const [loadedBoneModels, setLoadedBoneModels] = useState(null);
    const [loadedAnimation, setLoadedAnimation] = useState(null);
    const [loadingStatus, setLoadingStatus] = useState('');

    const { skeleton, stats, relatedFiles, error } = useMemo(() => {
        try {
            const parsed = new SkeletonFile(data);
            const baseName = filename.slice(0, 2);
            return {
                skeleton: parsed,
                stats: parsed.getStats(),
                relatedFiles: parsed.getRelatedFiles(baseName),
                error: null,
            };
        } catch (err) {
            return { skeleton: null, stats: null, relatedFiles: [], error: err.message };
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
        };

        loadPartsAndTextures();
    }, [skeleton, filename, onLoadFile]);

    // Load bone models, textures, and animation for character/enemy models
    useEffect(() => {
        if (!skeleton || skeleton.model.isBattleLocation || !onLoadFile) return;
        if (skeleton.model.bones.length === 0) return;

        const loadBoneData = async () => {
            const base = filename.slice(0, 2).toUpperCase();
            const bones = skeleton.model.bones;

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
                    } catch {
                        textures[i] = null;
                    }
                } else {
                    textures[i] = null;
                }
            }

            setLoadedTextures(textures);
            setLoadingStatus('Loading bone models...');

            // Load P model for each bone (XXAM, XXAN, etc.)
            const boneModels = [];
            let suffix1 = 'A';
            let suffix2 = 'M';

            for (let i = 0; i < bones.length; i++) {
                const bone = bones[i];
                const partName = `${base}${suffix1}${suffix2}`;

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

                suffix2 = String.fromCharCode(suffix2.charCodeAt(0) + 1);
                if (suffix2 > 'Z') {
                    suffix1 = String.fromCharCode(suffix1.charCodeAt(0) + 1);
                    suffix2 = 'A';
                }
            }

            setLoadedBoneModels(boneModels);
            setLoadingStatus('Loading animation...');

            // Try to load first animation (XXDA)
            const animName = `${base}DA`;
            const animData = onLoadFile(animName);
            if (animData) {
                try {
                    const anim = new BattleAnimation(animData, bones.length);
                    setLoadedAnimation(anim);
                } catch {
                    setLoadedAnimation(null);
                }
            }

            const loadedCount = boneModels.filter(b => b.pfile).length;
            setLoadingStatus(`Loaded ${loadedCount} bone models, ${textures.filter(t => t).length} textures`);
        };

        loadBoneData();
    }, [skeleton, filename, onLoadFile]);

    // Initialize Three.js scene
    useEffect(() => {
        if (!containerRef.current || !skeleton) return;

        const hasBones = skeleton.model.bones.length > 0;
        const isBattleLocation = skeleton.model.isBattleLocation;

        // For battle locations, wait for parts to load
        if (isBattleLocation && !loadedParts) return;
        // For bone skeletons, wait for bone models to load
        if (!isBattleLocation && hasBones && !loadedBoneModels) return;
        // For bone skeletons with no bones, nothing to show
        if (!isBattleLocation && !hasBones) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);

        // Camera
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100000);
        camera.up.set(0, 1, 0);

        // Renderer with legacy color handling for faithful FF7 colors
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
        container.appendChild(renderer.domElement);

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = true;
        controls.minPolarAngle = 0.1;
        controls.maxPolarAngle = Math.PI - 0.1;

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

        let groundPlaneCenter = null;

        if (isBattleLocation && loadedParts) {
            // Render battle location parts with textures
            loadedParts.forEach((part, partIndex) => {
                const meshes = createTexturedMeshes(part.pfile, loadedTextures || []);
                meshes.forEach(mesh => {
                    mesh.name = part.name;
                    scene.add(mesh);
                    meshesToDispose.push(mesh);
                    boundingBox.expandByObject(mesh);

                    // First part is the ground plane - capture its center for orbit target
                    if (partIndex === 0 && !groundPlaneCenter) {
                        const groundBox = new THREE.Box3().setFromObject(mesh);
                        groundPlaneCenter = groundBox.getCenter(new THREE.Vector3());
                    }
                });
            });
        } else if (hasBones && loadedBoneModels) {
            // Render character/enemy skeleton with actual 3D meshes
            const result = renderBattleSkeleton(
                skeleton.model.bones,
                loadedBoneModels,
                loadedTextures || [],
                loadedAnimation
            );
            
            result.meshes.forEach(mesh => {
                scene.add(mesh);
                meshesToDispose.push(mesh);
            });
            boundingBox = result.boundingBox;
        }

        // Position model so feet are at y=0 and fit camera
        if (!boundingBox.isEmpty()) {
            fitCameraToScene(camera, controls, boundingBox, isBattleLocation, groundPlaneCenter);
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
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationId);
            controls.dispose();
            renderer.dispose();
            meshesToDispose.forEach(mesh => {
                mesh.geometry?.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(m => m.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            });
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [skeleton, loadedParts, loadedTextures, loadedBoneModels, loadedAnimation]);

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
    const showCanvas = (isBattleLocation && loadedParts && loadedParts.length > 0) ||
                       (!isBattleLocation && hasBones && loadedBoneModels);
    const isLoading = (isBattleLocation && !loadedParts) || 
                      (!isBattleLocation && hasBones && !loadedBoneModels);

    return (
        <div className="skeleton-preview">
            {showCanvas ? (
                <div className="skeleton-3d-view" ref={containerRef} />
            ) : isLoading ? (
                <div className="skeleton-no-hierarchy">
                    <div className="no-hierarchy-text">Loading...</div>
                    <div className="no-hierarchy-detail">{loadingStatus}</div>
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
function renderBattleSkeleton(bones, boneModels, textures, animation) {
    const meshes = [];
    const boundingBox = new THREE.Box3();
    
    // Get first animation frame if available
    const frame = animation?.getFirstFrame();
    
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
            const meshGroup = createMeshFromPFile(boneModel.pfile, textures);
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
    
    // Wrap in a container to flip the model right-side up (like HRCPreview)
    const modelContainer = new THREE.Group();
    modelContainer.rotation.x = Math.PI;
    modelContainer.add(skeletonGroup);
    
    // Position model so feet are at y=0
    if (!boundingBox.isEmpty()) {
        modelContainer.position.y = boundingBox.max.y;
    }
    
    meshes.push(modelContainer);
    
    // Return flipped bounding box for camera fitting
    const flippedBox = new THREE.Box3();
    if (!boundingBox.isEmpty()) {
        const modelHeight = boundingBox.max.y - boundingBox.min.y;
        flippedBox.min.set(boundingBox.min.x, 0, boundingBox.min.z);
        flippedBox.max.set(boundingBox.max.x, modelHeight, boundingBox.max.z);
    }
    
    return { meshes, boundingBox: flippedBox };
}

// Create mesh from P file data with textures (matching HRCPreview approach)
function createMeshFromPFile(pfile, textures) {
    const { vertices, polygons, vertexColors, texCoords, groups } = pfile.model;
    const meshGroup = new THREE.Group();
    
    // Build polygon to group mapping
    const polyToGroup = new Map();
    for (const group of groups) {
        for (let i = 0; i < group.numPoly; i++) {
            polyToGroup.set(group.offsetPoly + i, group);
        }
    }
    
    // Separate polygons by texture
    const untexturedPolys = [];
    const texturedPolysByTexId = new Map();
    
    for (let polyIdx = 0; polyIdx < polygons.length; polyIdx++) {
        const group = polyToGroup.get(polyIdx);
        if (group && group.texFlag === 1 && textures.length > 0 && group.texID < textures.length && textures[group.texID]) {
            if (!texturedPolysByTexId.has(group.texID)) {
                texturedPolysByTexId.set(group.texID, { polys: [], group });
            }
            texturedPolysByTexId.get(group.texID).polys.push({ polyIdx, poly: polygons[polyIdx], group });
        } else {
            untexturedPolys.push({ polyIdx, poly: polygons[polyIdx], group });
        }
    }
    
    // Create untextured mesh with vertex colors
    if (untexturedPolys.length > 0) {
        const positions = [];
        const colors = [];
        
        for (const { poly, group } of untexturedPolys) {
            const [i0, i1, i2] = poly.vertices;
            const offsetVert = group ? group.offsetVert : 0;
            const vi0 = i0 + offsetVert, vi1 = i1 + offsetVert, vi2 = i2 + offsetVert;
            
            if (vi0 >= vertices.length || vi1 >= vertices.length || vi2 >= vertices.length) continue;
            
            const v0 = vertices[vi0], v1 = vertices[vi1], v2 = vertices[vi2];
            positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
            
            if (vertexColors.length > 0) {
                const c0 = vertexColors[vi0] || { r: 128, g: 128, b: 128 };
                const c1 = vertexColors[vi1] || { r: 128, g: 128, b: 128 };
                const c2 = vertexColors[vi2] || { r: 128, g: 128, b: 128 };
                colors.push(c0.r / 255, c0.g / 255, c0.b / 255);
                colors.push(c1.r / 255, c1.g / 255, c1.b / 255);
                colors.push(c2.r / 255, c2.g / 255, c2.b / 255);
            } else {
                colors.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6);
            }
        }
        
        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry = BufferGeometryUtils.mergeVertices(geometry);
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
        });
        
        meshGroup.add(new THREE.Mesh(geometry, material));
    }
    
    // Create textured meshes
    for (const [texID, { polys }] of texturedPolysByTexId) {
        const positions = [];
        const uvs = [];
        const colors = [];
        
        for (const { poly, group } of polys) {
            const [i0, i1, i2] = poly.vertices;
            const offsetVert = group.offsetVert;
            const vi0 = i0 + offsetVert, vi1 = i1 + offsetVert, vi2 = i2 + offsetVert;
            
            if (vi0 >= vertices.length || vi1 >= vertices.length || vi2 >= vertices.length) continue;
            
            const v0 = vertices[vi0], v1 = vertices[vi1], v2 = vertices[vi2];
            positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
            
            // Get texture coordinates
            const offsetTex = group.offsetTex;
            if (texCoords.length > 0) {
                const uv0 = texCoords[offsetTex + i0] || { u: 0, v: 0 };
                const uv1 = texCoords[offsetTex + i1] || { u: 0, v: 0 };
                const uv2 = texCoords[offsetTex + i2] || { u: 0, v: 0 };
                uvs.push(uv0.u, uv0.v, uv1.u, uv1.v, uv2.u, uv2.v);
            } else {
                uvs.push(0, 0, 0, 0, 0, 0);
            }
            
            // Vertex colors
            if (vertexColors.length > 0) {
                const c0 = vertexColors[vi0] || { r: 128, g: 128, b: 128 };
                const c1 = vertexColors[vi1] || { r: 128, g: 128, b: 128 };
                const c2 = vertexColors[vi2] || { r: 128, g: 128, b: 128 };
                colors.push(c0.r / 255, c0.g / 255, c0.b / 255);
                colors.push(c1.r / 255, c1.g / 255, c1.b / 255);
                colors.push(c2.r / 255, c2.g / 255, c2.b / 255);
            } else {
                colors.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
            }
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshLambertMaterial({
            map: textures[texID],
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.1,
        });
        
        meshGroup.add(new THREE.Mesh(geometry, material));
    }
    
    return meshGroup;
}

// Create textured meshes from P file (for battle locations)
function createTexturedMeshes(pfile, textures) {
    const { vertices, polygons, texCoords, vertexColors, groups } = pfile.model;

    // Build polygon to group mapping
    const polyToGroup = new Map();
    for (const group of groups) {
        for (let i = 0; i < group.numPoly; i++) {
            polyToGroup.set(group.offsetPoly + i, group);
        }
    }

    // Group polygons by texture ID
    const polysByTex = new Map();
    polygons.forEach((poly, idx) => {
        const group = polyToGroup.get(idx);
        const texID = group?.texID ?? 0;
        if (!polysByTex.has(texID)) polysByTex.set(texID, { polys: [], groups: new Set() });
        polysByTex.get(texID).polys.push({ poly, group });
        if (group) polysByTex.get(texID).groups.add(group);
    });

    const meshes = [];

    for (const [texID, { polys }] of polysByTex) {
        const positions = [];
        const colors = [];
        const uvs = [];

        for (const { poly, group } of polys) {
            const [i0, i1, i2] = poly.vertices;
            const offsetVert = group ? group.offsetVert : 0;
            const vi0 = i0 + offsetVert, vi1 = i1 + offsetVert, vi2 = i2 + offsetVert;

            if (vi0 >= vertices.length || vi1 >= vertices.length || vi2 >= vertices.length) continue;

            const v0 = vertices[vi0];
            const v1 = vertices[vi1];
            const v2 = vertices[vi2];

            // Negate Y for battle locations
            positions.push(v0.x, -v0.y, v0.z);
            positions.push(v1.x, -v1.y, v1.z);
            positions.push(v2.x, -v2.y, v2.z);

            // Vertex colors
            if (vertexColors.length > 0) {
                const c0 = vertexColors[vi0] || { r: 128, g: 128, b: 128 };
                const c1 = vertexColors[vi1] || { r: 128, g: 128, b: 128 };
                const c2 = vertexColors[vi2] || { r: 128, g: 128, b: 128 };
                colors.push(c0.r / 255, c0.g / 255, c0.b / 255);
                colors.push(c1.r / 255, c1.g / 255, c1.b / 255);
                colors.push(c2.r / 255, c2.g / 255, c2.b / 255);
            } else {
                colors.push(0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6);
            }

            // Texture coordinates
            if (texCoords.length > 0 && group) {
                const offsetTex = group.offsetTex;
                const uv0 = texCoords[offsetTex + i0] || { u: 0, v: 0 };
                const uv1 = texCoords[offsetTex + i1] || { u: 0, v: 0 };
                const uv2 = texCoords[offsetTex + i2] || { u: 0, v: 0 };
                uvs.push(uv0.u, uv0.v, uv1.u, uv1.v, uv2.u, uv2.v);
            } else {
                uvs.push(0, 0, 0, 0, 0, 0);
            }
        }

        if (positions.length === 0) continue;

        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        if (uvs.length > 0) {
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }

        geometry = BufferGeometryUtils.mergeVertices(geometry);
        geometry.computeVertexNormals();

        const texture = textures[texID] || null;
        const material = new THREE.MeshLambertMaterial({
            map: texture,
            vertexColors: true,
            side: THREE.DoubleSide,
            transparent: texture !== null,
            alphaTest: texture ? 0.1 : 0,
        });

        meshes.push(new THREE.Mesh(geometry, material));
    }

    return meshes;
}

function fitCameraToScene(camera, controls, boundingBox, isBattleLocation = false, groundPlaneCenter = null) {
    const size = boundingBox.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDist = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraDist *= 1.5;

    // Orbit around model center
    let orbitTarget;
    if (isBattleLocation && groundPlaneCenter) {
        orbitTarget = groundPlaneCenter.clone();
    } else {
        // Target center of bounding box (works for both battle locations and character models)
        const center = boundingBox.getCenter(new THREE.Vector3());
        orbitTarget = center;
    }

    camera.position.set(
        orbitTarget.x + cameraDist * 0.3,
        orbitTarget.y + cameraDist * 0.3,
        orbitTarget.z + cameraDist
    );
    camera.lookAt(orbitTarget);

    controls.target.copy(orbitTarget);
    controls.minDistance = maxDim * 0.1;
    controls.maxDistance = maxDim * 10;
    controls.update();

    camera.near = Math.max(0.01, maxDim / 100);
    camera.far = Math.max(1000, maxDim * 100);
    camera.updateProjectionMatrix();
}
