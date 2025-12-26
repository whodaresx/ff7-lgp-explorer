import { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RSDFile } from '../rsdfile.ts';
import { PFile } from '../pfile.ts';
import { TexFile } from '../texfile.ts';
import { createMeshFromPFile, fitCameraToObject } from '../utils/pfileRenderer.js';
import { usePersistedState } from '../utils/settings.ts';
import { BackgroundColorPicker } from './BackgroundColorPicker.jsx';
import './RSDPreview.css';

export function RSDPreview({ data, onLoadFile }) {
    const containerRef = useRef(null);
    const sceneRef = useRef(null);
    const meshRef = useRef(null);

    const [wireframe, setWireframe] = usePersistedState('wireframe');
    const [vertexColors, setVertexColors] = usePersistedState('vertexColors');
    const [smoothShading, setSmoothShading] = usePersistedState('smoothShading');
    const [cullingEnabled, setCullingEnabled] = useState(false);
    const [backgroundColor, setBackgroundColor] = usePersistedState('backgroundColor');

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
        scene.background = new THREE.Color(backgroundColor);
        sceneRef.current = scene;

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

        // Controls - orbit style (no roll)
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;
        controls.screenSpacePanning = true; // Shift+drag to pan

        const lightIntensity = 5;

        // FF7-style lighting setup
        const ambientLight = new THREE.AmbientLight(0x888888, lightIntensity);
        scene.add(ambientLight);

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

        // Container for the model - flip Y and Z to match FF7 coordinate system
        const modelContainer = new THREE.Group();
        modelContainer.scale.y = -1;
        modelContainer.scale.z = -1;
        scene.add(modelContainer);

        // Create mesh from P file with textures using shared utility
        const mesh = createMeshFromPFile(pfile, {
            textures,
            vertexColors,
            smoothShading,
            cullingEnabled: false, // Disabled due to Y-flip on container
        });
        meshRef.current = mesh;
        modelContainer.add(mesh);

        // Fit camera to model container
        fitCameraToObject(camera, controls, modelContainer);

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
    }, [pfile, textures, vertexColors, smoothShading, cullingEnabled]);

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

    // Update background color
    useEffect(() => {
        if (sceneRef.current) {
            sceneRef.current.background = new THREE.Color(backgroundColor);
        }
    }, [backgroundColor]);

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
                        checked={vertexColors}
                        onChange={(e) => setVertexColors(e.target.checked)}
                    />
                    Vertex Colors
                </label>
                <label className="rsd-toggle">
                    <input
                        type="checkbox"
                        checked={smoothShading}
                        onChange={(e) => setSmoothShading(e.target.checked)}
                    />
                    Smooth Shading
                </label>
                <label className="rsd-toggle">
                    <input
                        type="checkbox"
                        checked={cullingEnabled}
                        onChange={(e) => setCullingEnabled(e.target.checked)}
                    />
                    Face Culling
                </label>
                {stats && (
                    <div className="rsd-stats">
                        <span>{stats.vertices} verts</span>
                        <span>{stats.polygons} polys</span>
                        <span>{stats.groups} groups</span>
                        <span>{stats.texturesLoaded}/{stats.texturesTotal} tex</span>
                    </div>
                )}
                <BackgroundColorPicker value={backgroundColor} onChange={setBackgroundColor} />
            </div>
            <div className="rsd-canvas" ref={containerRef} />
        </div>
    );
}
