import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { HRCFile } from '../hrcfile.ts';
import { RSDFile } from '../rsdfile.ts';
import { PFile } from '../pfile.ts';
import { FieldAnimation } from '../animfile.ts';
import { TexFile } from '../texfile.ts';
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
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = true;
        controls.minPolarAngle = 0.1;
        controls.maxPolarAngle = Math.PI - 0.1;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);
        const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
        backLight.position.set(-1, 0.5, -1);
        scene.add(backLight);

        // Track all meshes for cleanup
        const allMeshes = [];
        let cancelled = false;

        // Try to find and load animation file
        const findAnimation = () => {
            if (!onLoadFile) return null;
            
            // Get the skeleton name prefix (e.g., "aaaa" from "aaaa.hrc")
            const prefix = filename.toLowerCase().replace('.hrc', '').slice(0, 2);
            
            // FF7 field animations use 4-letter names like aafe.a, aaff.a, etc.
            // They're in the same archive and share the first 2 letters with the skeleton
            // Try all possible combinations for the last 2 characters
            const chars = 'abcdefghijklmnopqrstuvwxyz';
            
            for (const c1 of chars) {
                for (const c2 of chars) {
                    const animFilename = `${prefix}${c1}${c2}.a`;
                    const animData = onLoadFile(animFilename);
                    if (animData) {
                        try {
                            const anim = new FieldAnimation(animData);
                            // Check if bone count matches (or special case for single bone)
                            if (anim.data.nBones === hrc.data.bones.length || 
                                (hrc.data.bones.length === 1 && anim.data.nBones === 0)) {
                                return anim;
                            }
                        } catch {
                            // Not a valid animation file, continue searching
                        }
                    }
                }
            }
            return null;
        };

        // Load and render actual models with animation transforms
        const loadModels = async () => {
            const bones = hrc.data.bones;
            const boundingBox = new THREE.Box3();
            
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
            
            // Wrap in a container to flip the model right-side up
            const modelContainer = new THREE.Group();
            modelContainer.rotation.x = Math.PI;
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
                                    // Pass flipped=true because modelContainer has rotation.x = PI which reverses winding order
                                    const mesh = createMeshFromPFile(pfile, textures, true);
                                    
                                    // Apply accumulated transform
                                    mesh.applyMatrix4(currentMatrix);
                                    
                                    skeletonGroup.add(mesh);
                                    allMeshes.push(mesh);
                                    
                                    // Expand bounding box
                                    const meshBox = new THREE.Box3().setFromObject(mesh);
                                    boundingBox.union(meshBox);
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
                
                // Expand bounding box with bone endpoint
                const boneEnd = new THREE.Vector3(0, 0, 0).applyMatrix4(currentMatrix);
                boundingBox.expandByPoint(boneEnd);
            }

            // If no models loaded, fall back to placeholder visualization
            if (allMeshes.length <= 1) {
                const placeholderGroup = createPlaceholderWithAnimation(hrc, frame);
                skeletonGroup.add(placeholderGroup);
                allMeshes.push(placeholderGroup);
            }

            // Position model so feet are at y=0 and fit camera
            if (!boundingBox.isEmpty()) {
                // After flipping, the model's bottom is at -boundingBox.max.y
                // Shift the model up so the bottom is at y=0
                modelContainer.position.y = boundingBox.max.y;
                
                // Fit camera - model height is now from 0 to (max.y - min.y)
                const modelHeight = boundingBox.max.y - boundingBox.min.y;
                const flippedBox = new THREE.Box3(
                    new THREE.Vector3(boundingBox.min.x, 0, boundingBox.min.z),
                    new THREE.Vector3(boundingBox.max.x, modelHeight, boundingBox.max.z)
                );
                
                fitCameraToScene(camera, controls, flippedBox);
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

// Culling flags from FF7 P file format (PHundret structure)
const V_CULLFACE = 0x2000;
const V_NOCULL = 0x4000;

// Determine material side based on hundret culling flags
// If flipped is true, invert front/back (used for models with rotation.x = PI transform)
function getMaterialSide(hundret, flipped = false) {
    const field_C = hundret?.field_C || 0;
    const field_8 = hundret?.field_8 || 0;

    let side;

    // Check V_NOCULL first (higher priority)
    if (field_C & V_NOCULL) {
        if (field_8 & V_NOCULL) {
            return THREE.DoubleSide; // No culling - render both sides (no inversion needed)
        } else {
            side = THREE.BackSide; // Cull front faces
        }
    }
    // Check V_CULLFACE
    else if (field_C & V_CULLFACE) {
        if (field_8 & V_CULLFACE) {
            side = THREE.BackSide; // Cull front faces
        } else {
            side = THREE.FrontSide; // Cull back faces (standard)
        }
    }
    // Default: cull back faces (standard backface culling)
    else {
        side = THREE.FrontSide;
    }

    // Invert front/back if model will be flipped (rotation.x = PI reverses winding order)
    if (flipped && side !== THREE.DoubleSide) {
        side = side === THREE.FrontSide ? THREE.BackSide : THREE.FrontSide;
    }

    return side;
}

// Create mesh from P file data with textures, normals, and proper culling
// flipped: true if the model will have rotation.x = PI applied (inverts winding order)
function createMeshFromPFile(pfile, textures = [], flipped = false) {
    const { vertices, polygons, vertexColors, texCoords, groups, normals, hundrets } = pfile.model;
    const meshGroup = new THREE.Group();
    const hasFileNormals = normals && normals.length > 0;

    // Process each group separately to respect per-group culling settings
    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
        const group = groups[groupIdx];
        const hundret = hundrets[groupIdx];
        const isTextured = group.texFlag === 1 && textures.length > 0 && group.texID < textures.length && textures[group.texID];

        const positions = [];
        const normalArray = [];
        const uvs = [];
        const colors = [];

        // Process polygons for this group
        for (let i = 0; i < group.numPoly; i++) {
            const polyIdx = group.offsetPoly + i;
            if (polyIdx >= polygons.length) continue;

            const poly = polygons[polyIdx];
            const [i0, i1, i2] = poly.vertices;
            const vi0 = i0 + group.offsetVert;
            const vi1 = i1 + group.offsetVert;
            const vi2 = i2 + group.offsetVert;

            if (vi0 >= vertices.length || vi1 >= vertices.length || vi2 >= vertices.length) continue;

            // Positions
            const v0 = vertices[vi0], v1 = vertices[vi1], v2 = vertices[vi2];
            positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);

            // Normals from file (if available)
            if (hasFileNormals && poly.normals) {
                const [n0, n1, n2] = poly.normals;
                const norm0 = normals[n0] || { x: 0, y: 1, z: 0 };
                const norm1 = normals[n1] || { x: 0, y: 1, z: 0 };
                const norm2 = normals[n2] || { x: 0, y: 1, z: 0 };
                normalArray.push(norm0.x, norm0.y, norm0.z);
                normalArray.push(norm1.x, norm1.y, norm1.z);
                normalArray.push(norm2.x, norm2.y, norm2.z);
            }

            // Texture coordinates (if textured)
            if (isTextured && texCoords.length > 0) {
                const uv0 = texCoords[group.offsetTex + i0] || { u: 0, v: 0 };
                const uv1 = texCoords[group.offsetTex + i1] || { u: 0, v: 0 };
                const uv2 = texCoords[group.offsetTex + i2] || { u: 0, v: 0 };
                uvs.push(uv0.u, uv0.v, uv1.u, uv1.v, uv2.u, uv2.v);
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
                const defaultColor = isTextured ? 1 : 0.6;
                colors.push(defaultColor, defaultColor, defaultColor);
                colors.push(defaultColor, defaultColor, defaultColor);
                colors.push(defaultColor, defaultColor, defaultColor);
            }
        }

        if (positions.length === 0) continue;

        // Create geometry
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        if (isTextured && uvs.length > 0) {
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }

        // Use file normals or compute them
        if (normalArray.length > 0) {
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalArray, 3));
        } else {
            geometry.computeVertexNormals();
        }

        // Get material side based on hundret culling flags
        const side = getMaterialSide(hundret, flipped);

        // Create material
        const material = isTextured
            ? new THREE.MeshLambertMaterial({
                map: textures[group.texID],
                vertexColors: true,
                side,
                transparent: true,
                alphaTest: 0.1,
            })
            : new THREE.MeshLambertMaterial({
                vertexColors: true,
                side,
            });

        meshGroup.add(new THREE.Mesh(geometry, material));
    }

    return meshGroup;
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

function fitCameraToScene(camera, controls, boundingBox) {
    const size = boundingBox.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDist = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraDist *= 1.5;

    // Position camera to look at the origin
    camera.position.set(
        cameraDist * 0.3,
        cameraDist * 0.3,
        cameraDist
    );
    camera.lookAt(0, 0, 0);

    controls.target.set(0, 0, 0);
    controls.minDistance = maxDim * 0.1;
    controls.maxDistance = maxDim * 10;
    controls.update();

    camera.near = Math.max(0.01, maxDim / 100);
    camera.far = Math.max(1000, maxDim * 100);
    camera.updateProjectionMatrix();
}
