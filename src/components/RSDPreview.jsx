import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { RSDFile } from '../rsdfile.ts';
import { PFile } from '../pfile.ts';
import { TexFile } from '../texfile.ts';
import './RSDPreview.css';

export function RSDPreview({ data, onLoadFile }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const meshRef = useRef(null);

    const [wireframe, setWireframe] = useState(false);
    const [showVertexColors, setShowVertexColors] = useState(true);
    const [useSmoothShading, setUseSmoothShading] = useState(true);

    // Parse the RSD file and load referenced P model and textures
    const { pfile, textures, stats, error } = useMemo(() => {
        try {
            const parsedRSD = new RSDFile(data);
            const pModelFilename = parsedRSD.getPModelFilename().toLowerCase();

            if (!pModelFilename) {
                return { pfile: null, textures: [], stats: null, error: 'RSD file has no model reference' };
            }

            // Load P model
            const pData = onLoadFile(pModelFilename);
            if (!pData) {
                return { pfile: null, textures: [], stats: null, error: `Model file not found: ${pModelFilename}` };
            }

            const parsedPFile = new PFile(pData);

            // Load textures
            const loadedTextures = [];
            for (const texFilename of parsedRSD.getTextureFilenames()) {
                const texData = onLoadFile(texFilename.toLowerCase());
                if (texData) {
                    try {
                        const texFile = new TexFile(texData);
                        const texture = new THREE.DataTexture(
                            texFile.getPixels(0),
                            texFile.data.width,
                            texFile.data.height,
                            THREE.RGBAFormat
                        );
                        texture.flipY = false;
                        texture.magFilter = THREE.NearestFilter;
                        texture.minFilter = THREE.NearestFilter;
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        texture.needsUpdate = true;
                        loadedTextures.push(texture);
                    } catch (texErr) {
                        console.warn(`Failed to load texture ${texFilename}:`, texErr);
                        loadedTextures.push(null);
                    }
                } else {
                    loadedTextures.push(null);
                }
            }

            return {
                pfile: parsedPFile,
                textures: loadedTextures,
                stats: {
                    ...parsedPFile.getStats(),
                    texturesLoaded: loadedTextures.filter(t => t !== null).length,
                    texturesTotal: parsedRSD.getTextureFilenames().length,
                },
                error: null,
            };
        } catch (err) {
            return { pfile: null, textures: [], stats: null, error: err.message };
        }
    }, [data, onLoadFile]);

    // Initialize Three.js scene
    useEffect(() => {
        if (!containerRef.current || !pfile) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);
        sceneRef.current = scene;

        // Camera
        const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
        camera.up.set(0, 1, 0);

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        // Controls - trackball style for unrestricted rotation
        const controls = new TrackballControls(camera, renderer.domElement);
        controls.rotateSpeed = 2.0;
        controls.zoomSpeed = 1.2;
        controls.panSpeed = 0.8;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // Create mesh from P file with textures
        const mesh = createMeshFromPFile(pfile, textures, showVertexColors, useSmoothShading);
        meshRef.current = mesh;
        scene.add(mesh);

        // Fit camera to model
        fitCameraToMesh(camera, controls, mesh);

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
            // Dispose textures
            for (const tex of textures) {
                if (tex) tex.dispose();
            }
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [pfile, textures, showVertexColors, useSmoothShading]);

    // Update wireframe
    useEffect(() => {
        if (meshRef.current) {
            meshRef.current.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material.wireframe = wireframe;
                }
            });
        }
    }, [wireframe]);

    if (error) {
        return (
            <div className="rsd-error">
                <div className="rsd-error-icon">⚠️</div>
                <div className="rsd-error-text">Failed to load RSD resource</div>
                <div className="rsd-error-detail">{error}</div>
            </div>
        );
    }

    return (
        <div className="rsd-preview">
            <div className="rsd-toolbar">
                <label className="rsd-toggle">
                    <input
                        type="checkbox"
                        checked={wireframe}
                        onChange={(e) => setWireframe(e.target.checked)}
                    />
                    Wireframe
                </label>
                <label className="rsd-toggle">
                    <input
                        type="checkbox"
                        checked={showVertexColors}
                        onChange={(e) => setShowVertexColors(e.target.checked)}
                    />
                    Vertex Colors
                </label>
                <label className="rsd-toggle">
                    <input
                        type="checkbox"
                        checked={useSmoothShading}
                        onChange={(e) => setUseSmoothShading(e.target.checked)}
                    />
                    Smooth Shading
                </label>
                {stats && (
                    <div className="rsd-stats">
                        <span>{stats.vertices} verts</span>
                        <span>{stats.polygons} polys</span>
                        <span>{stats.groups} groups</span>
                        <span>{stats.texturesLoaded}/{stats.texturesTotal} tex</span>
                    </div>
                )}
            </div>
            <div className="rsd-canvas" ref={containerRef} />
        </div>
    );
}

// Create mesh from P file data with textures
function createMeshFromPFile(pfile, textures = [], useVertexColors = true, useSmoothShading = true) {
    const { vertices, polygons, vertexColors, texCoords, groups } = pfile.model;
    const meshGroup = new THREE.Group();

    // Process each group separately for per-group texture handling
    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
        const group = groups[groupIdx];
        const isTextured = group.texFlag === 1 && textures.length > 0 && group.texID < textures.length && textures[group.texID];

        const positions = [];
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

            // Texture coordinates (if textured)
            if (isTextured && texCoords.length > 0) {
                const uv0 = texCoords[group.offsetTex + i0] || { u: 0, v: 0 };
                const uv1 = texCoords[group.offsetTex + i1] || { u: 0, v: 0 };
                const uv2 = texCoords[group.offsetTex + i2] || { u: 0, v: 0 };
                uvs.push(uv0.u, uv0.v, uv1.u, uv1.v, uv2.u, uv2.v);
            }

            // Vertex colors
            if (useVertexColors && vertexColors.length > 0) {
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
        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        if (isTextured && uvs.length > 0) {
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }

        // Create material - always use DoubleSide (no culling)
        let material;
        if (useSmoothShading) {
            // For smooth shading, merge vertices so normals can be averaged
            geometry = BufferGeometryUtils.mergeVertices(geometry);
            geometry.computeVertexNormals();

            material = isTextured
                ? new THREE.MeshLambertMaterial({
                    map: textures[group.texID],
                    vertexColors: true,
                    side: THREE.DoubleSide,
                    transparent: true,
                    alphaTest: 0.1,
                })
                : new THREE.MeshLambertMaterial({
                    vertexColors: true,
                    side: THREE.DoubleSide,
                });
        } else {
            // For flat shading, keep non-indexed geometry
            geometry.computeVertexNormals();

            material = isTextured
                ? new THREE.MeshStandardMaterial({
                    map: textures[group.texID],
                    vertexColors: true,
                    side: THREE.DoubleSide,
                    transparent: true,
                    alphaTest: 0.1,
                    flatShading: true,
                })
                : new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    side: THREE.DoubleSide,
                    flatShading: true,
                });
        }

        meshGroup.add(new THREE.Mesh(geometry, material));
    }

    return meshGroup;
}

function fitCameraToMesh(camera, controls, mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;

    camera.position.set(center.x + cameraZ * 0.5, center.y + cameraZ * 0.3, center.z + cameraZ);
    camera.lookAt(center);

    controls.target.copy(center);
    controls.update();

    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
}
