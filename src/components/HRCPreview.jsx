import { useEffect, useRef, useMemo } from 'react';
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
        // Disable tone mapping and use legacy color handling for faithful FF7 colors
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
        // Global ambient light - provides base illumination
        const ambientLight = new THREE.AmbientLight(0x888888, lightIntensity);
        scene.add(ambientLight);

        // Three directional lights mimicking FF7 field lighting
        // Light 1: Main light (brightest) - from front-above
        const light1 = new THREE.DirectionalLight(0x909090, lightIntensity);
        light1.position.set(-100, -2100, -3500).normalize();
        scene.add(light1);

        // Light 2: Secondary light (medium) - from right-above-back
        const light2 = new THREE.DirectionalLight(0x888888, lightIntensity);
        light2.position.set(1500, -1400, 2900).normalize();
        scene.add(light2);

        // Light 3: Fill light (dimmest) - from left-above-back
        const light3 = new THREE.DirectionalLight(0x4d4d4d, lightIntensity);
        light3.position.set(-3000, -1400, 2500).normalize();
        scene.add(light3);

        // Track all meshes for cleanup
        const allMeshes = [];
        let cancelled = false;

        // Try to find and load animation file using model-animations.json mapping
        const findAnimation = () => {
            console.log("Finding animation for", filename);
            if (!onLoadFile) return null;

            // Get the model code (e.g., "aaaa" from "aaaa.hrc")
            const modelCode = filename.toLowerCase().replace('.hrc', '');
            const animList = modelAnimations[modelCode];

            if (!animList || animList.length === 0) return null;

            // Try animations from the list in order
            for (const animCode of animList) {
                const animFilename = `${animCode}.a`;
                const animData = onLoadFile(animFilename);
                console.log("Trying animation", animFilename);
                if (animData) {
                    try {
                        const anim = new FieldAnimation(animData);
                        // Check if bone count matches (or special case for single bone)
                        if (anim.data.nBones === hrc.data.bones.length ||
                            (hrc.data.bones.length === 1 && anim.data.nBones === 0)) {
                            console.log("Found animation", animFilename);
                            return anim;
                        }
                    } catch {
                        // Not a valid animation file, continue searching
                        console.log("Not a valid animation file", animFilename);
                    }
                }
            }
            return null;
        };

        // Load and render actual models with animation transforms
        const loadModels = async () => {
            const bones = hrc.data.bones;

            // Try to load animation
            const animation = findAnimation();
            const frame = animation?.getFirstFrame();

            // Create skeleton group with root transform
            const skeletonGroup = new THREE.Group();

            if (frame) {
                // Apply root translation
                skeletonGroup.position.set(
                    frame.rootTranslation.x,
                    frame.rootTranslation.y,
                    frame.rootTranslation.z
                );

                // Apply root rotation
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

            // Build joint hierarchy using a stack (matching Kimera's approach)
            // Stack stores bone names (joint_i), we match parentName (joint_f) against stack top
            // Initialize with first bone's parentName so the first bone can match
            const jointStack = [bones[0]?.parentName || 'root'];
            const matrixStack = [new THREE.Matrix4()];

            for (let idx = 0; idx < bones.length; idx++) {
                if (cancelled) return;

                const bone = bones[idx];

                // Navigate hierarchy - pop until we find matching parent (joint_f matches stack top)
                // This handles branching: when we reach a bone whose parent isn't the previous bone,
                // we pop back up the hierarchy until we find the right parent
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
                                        cullingEnabled: false, // Disabled due to Y-flip on container
                                    });

                                    // Apply accumulated transform
                                    mesh.applyMatrix4(currentMatrix);

                                    skeletonGroup.add(mesh);
                                    allMeshes.push(mesh);
                                }
                            } catch {
                                console.warn(`Failed to load model for bone ${bone.name}`);
                            }
                        }
                    }
                }

                // Translate along -Z by bone length for next bone in chain (matches FF7/Kimera)
                const translateMatrix = new THREE.Matrix4().makeTranslation(0, 0, -bone.length);
                currentMatrix.multiply(translateMatrix);

                // Push current bone's name onto stack (this is joint_i - the end of this bone)
                // Child bones will match their parentName (joint_f) against this
                jointStack.push(bone.name);
                matrixStack.push(currentMatrix);
            }

            // If no models loaded, fall back to placeholder visualization
            if (allMeshes.length <= 1) {
                const placeholderGroup = createPlaceholderWithAnimation(hrc, frame);
                skeletonGroup.add(placeholderGroup);
                allMeshes.push(placeholderGroup);
            }

            // Compute world bounding box after all transforms (including container's scale flip)
            modelContainer.updateMatrixWorld(true);
            const worldBox = new THREE.Box3().setFromObject(modelContainer);

            // Position model so feet are at y=0 and fit camera
            if (!worldBox.isEmpty()) {
                // Shift model so bottom (min.y) is at y=0
                modelContainer.position.y = -worldBox.min.y;

                // Recompute final bounding box after positioning
                modelContainer.updateMatrixWorld(true);
                const finalBox = new THREE.Box3().setFromObject(modelContainer);

                fitCameraToObject(camera, controls, finalBox);
            }
        };

        loadModels();

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
    }, [hrc, onLoadFile, filename]);

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
// Angles are in degrees
function buildQuaternionYXZ(alpha, beta, gamma) {
    const DEG2RAD = Math.PI / 180;

    // Convert to radians and halve for quaternion calculation
    const ax = (alpha * DEG2RAD) / 2;
    const ay = (beta * DEG2RAD) / 2;
    const az = (gamma * DEG2RAD) / 2;

    // Build individual axis quaternions
    const qx = new THREE.Quaternion(Math.sin(ax), 0, 0, Math.cos(ax));
    const qy = new THREE.Quaternion(0, Math.sin(ay), 0, Math.cos(ay));
    const qz = new THREE.Quaternion(0, 0, Math.sin(az), Math.cos(az));

    // Multiply in YXZ order: Y * X * Z
    const result = new THREE.Quaternion();
    result.multiplyQuaternions(qy, qx);
    result.multiply(qz);

    return result;
}

// Fallback placeholder visualization with animation transforms
function createPlaceholderWithAnimation(hrc, frame) {
    const group = new THREE.Group();
    const bones = hrc.data.bones;

    // Build joint hierarchy using a stack
    const jointStack = [bones[0]?.parentName || 'root'];
    const matrixStack = [new THREE.Matrix4()];

    bones.forEach((bone, idx) => {
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

        // Create joint sphere at current position
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

        // Create bone cylinder extending along -Z
        if (bone.length > 0.01) {
            const boneRadius = Math.max(bone.length * 0.04, 0.05);
            const boneGeometry = new THREE.CylinderGeometry(boneRadius, boneRadius, bone.length, 6);
            const boneMaterial = new THREE.MeshLambertMaterial({ color: boneColor });
            const boneMesh = new THREE.Mesh(boneGeometry, boneMaterial);

            // Rotate cylinder to align with -Z axis and position at midpoint
            boneMesh.rotation.x = Math.PI / 2;
            boneMesh.position.z = -bone.length / 2;

            // Create a group to apply the bone transform
            const boneGroup = new THREE.Group();
            boneGroup.add(boneMesh);
            boneGroup.applyMatrix4(currentMatrix);
            group.add(boneGroup);
        }

        // Translate along -Z by bone length for next bone
        const translateMatrix = new THREE.Matrix4().makeTranslation(0, 0, -bone.length);
        currentMatrix.multiply(translateMatrix);

        // Push current bone onto stack
        jointStack.push(bone.name);
        matrixStack.push(currentMatrix);
    });

    return group;
}
