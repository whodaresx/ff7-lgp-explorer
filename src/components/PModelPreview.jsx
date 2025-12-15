import { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { PFile } from '../pfile.ts';
import './PModelPreview.css';

export function PModelPreview({ data }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const meshRef = useRef(null);

    const [wireframe, setWireframe] = useState(false);
    const [showVertexColors, setShowVertexColors] = useState(true);
    const [useRetroShading, setUseRetroShading] = useState(true);

    // Parse the P file and compute stats
    const { pfile, stats, error } = useMemo(() => {
        try {
            const parsed = new PFile(data);
            return { pfile: parsed, stats: parsed.getStats(), error: null };
        } catch (err) {
            return { pfile: null, stats: null, error: err.message };
        }
    }, [data]);

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
        camera.up.set(0, 1, 0); // Ensure Y-up for turntable rotation

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
        const ambientLight = new THREE.AmbientLight(0xffffff, useRetroShading ? 0.4 : 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, useRetroShading ? 0.8 : 0.8);
        directionalLight.position.set(1, 1, 1);
        scene.add(directionalLight);

        // Create mesh from P file
        const mesh = createMeshFromPFile(pfile, showVertexColors, useRetroShading);
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
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [pfile, showVertexColors, useRetroShading]);

    // Update wireframe
    useEffect(() => {
        if (meshRef.current) {
            meshRef.current.material.wireframe = wireframe;
        }
    }, [wireframe]);

    if (error) {
        return (
            <div className="pmodel-error">
                <div className="pmodel-error-icon">⚠️</div>
                <div className="pmodel-error-text">Failed to parse P file</div>
                <div className="pmodel-error-detail">{error}</div>
            </div>
        );
    }

    return (
        <div className="pmodel-preview">
            <div className="pmodel-toolbar">
                <label className="pmodel-toggle">
                    <input
                        type="checkbox"
                        checked={wireframe}
                        onChange={(e) => setWireframe(e.target.checked)}
                    />
                    Wireframe
                </label>
                <label className="pmodel-toggle">
                    <input
                        type="checkbox"
                        checked={showVertexColors}
                        onChange={(e) => setShowVertexColors(e.target.checked)}
                    />
                    Vertex Colors
                </label>
                <label className="pmodel-toggle">
                    <input
                        type="checkbox"
                        checked={useRetroShading}
                        onChange={(e) => setUseRetroShading(e.target.checked)}
                    />
                    Smooth Shading
                </label>
                {stats && (
                    <div className="pmodel-stats">
                        <span>{stats.vertices} verts</span>
                        <span>{stats.polygons} polys</span>
                        <span>{stats.groups} groups</span>
                    </div>
                )}
            </div>
            <div className="pmodel-canvas" ref={containerRef} />
        </div>
    );
}

function createMeshFromPFile(pfile, useVertexColors, useRetroShading = true) {
    const { vertices, polygons, vertexColors, texCoords } = pfile.model;

    const positions = [];
    const colors = [];
    const uvs = [];

    // Build triangles from polygons
    for (const poly of polygons) {
        const [i0, i1, i2] = poly.vertices;

        // Skip invalid indices
        if (i0 >= vertices.length || i1 >= vertices.length || i2 >= vertices.length) {
            continue;
        }

        const v0 = vertices[i0];
        const v1 = vertices[i1];
        const v2 = vertices[i2];

        // Add positions (FF7 uses Y-up, same as Three.js)
        positions.push(v0.x, v0.y, v0.z);
        positions.push(v1.x, v1.y, v1.z);
        positions.push(v2.x, v2.y, v2.z);

        // Add vertex colors
        if (useVertexColors && vertexColors.length > 0) {
            const c0 = vertexColors[i0] || { r: 128, g: 128, b: 128 };
            const c1 = vertexColors[i1] || { r: 128, g: 128, b: 128 };
            const c2 = vertexColors[i2] || { r: 128, g: 128, b: 128 };

            colors.push(c0.r / 255, c0.g / 255, c0.b / 255);
            colors.push(c1.r / 255, c1.g / 255, c1.b / 255);
            colors.push(c2.r / 255, c2.g / 255, c2.b / 255);
        } else {
            // Default gray color
            colors.push(0.6, 0.6, 0.6);
            colors.push(0.6, 0.6, 0.6);
            colors.push(0.6, 0.6, 0.6);
        }

        // Add UVs if available
        if (texCoords.length > 0) {
            const uv0 = texCoords[i0] || { u: 0, v: 0 };
            const uv1 = texCoords[i1] || { u: 0, v: 0 };
            const uv2 = texCoords[i2] || { u: 0, v: 0 };

            uvs.push(uv0.u, uv0.v);
            uvs.push(uv1.u, uv1.v);
            uvs.push(uv2.u, uv2.v);
        }
    }

    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    if (uvs.length > 0) {
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }

    // FF7 retro shading: Gouraud shading (per-vertex lighting, interpolated)
    // Modern shading: PBR with per-pixel lighting
    let material;
    if (useRetroShading) {
        // For smooth Gouraud shading, we need indexed geometry with shared vertices
        // mergeVertices() combines vertices at the same position so normals can be averaged
        geometry = BufferGeometryUtils.mergeVertices(geometry);
        geometry.computeVertexNormals();

        // MeshLambertMaterial = Gouraud shading (lighting computed per-vertex, then interpolated)
        material = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
        });
    } else {
        // For flat shading, keep non-indexed geometry (each face has its own vertices/normals)
        geometry.computeVertexNormals();
        material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            side: THREE.DoubleSide,
            flatShading: true,
        });
    }

    return new THREE.Mesh(geometry, material);
}

function fitCameraToMesh(camera, controls, mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5; // Add some margin

    camera.position.set(center.x + cameraZ * 0.5, center.y + cameraZ * 0.3, center.z + cameraZ);
    camera.lookAt(center);

    controls.target.copy(center);
    controls.update();

    // Update near/far planes based on model size
    camera.near = maxDim / 100;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();
}
