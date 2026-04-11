/**
 * Export component geometry as SVG (via three-svg-renderer) and PNG (via canvas).
 *
 * Uses OrthographicCamera matching the component viewer Scene.
 * three-svg-renderer types say PerspectiveCamera but internally uses
 * Vector3.project() which works with any camera. We set camera.aspect manually.
 */

import * as THREE from 'three';
import { SVGRenderer, SVGMesh, FillPass, VisibleChainPass } from 'three-svg-renderer';

export interface ExportResult {
  svgString: string;
  pngDataUrl: string;
}

/**
 * Render a BufferGeometry to SVG + PNG from orthographic cross-section view.
 */
export async function exportComponent(
  geometry: THREE.BufferGeometry,
  options: { width?: number; height?: number; color?: string; cutVCGeometry?: THREE.BufferGeometry } = {}
): Promise<ExportResult> {
  const W = options.width || 300;
  const H = options.height || 450;
  const color = options.color || '#cc2222';

  // === Build Three.js scene ===
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  // SVG renderer needs solid material color (not vertex colors)
  // FillPass reads polygon.color from material.color
  const material = new THREE.MeshPhongMaterial({
    color,
    specular: '#ffffff',
    shininess: 200,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const point = new THREE.PointLight(0xffffff, 200, 50);
  point.position.set(4, -3, -2);
  scene.add(point);

  // === OrthographicCamera — match ComponentScene.svelte (zoom=60, pos=[6,0,0]) ===
  // Three.js OrthographicCamera: frustum = viewSize / (2 * zoom)
  // With zoom=60 and default viewSize, the frustum half-size ≈ W/(2*zoom)
  const aspect = W / H;
  const zoom = 60;
  const halfH = H / (2 * zoom);
  const halfW = halfH * aspect;
  const camera = new THREE.OrthographicCamera(
    -halfW, halfW, halfH, -halfH, 0.1, 100
  );
  camera.position.set(6, 0, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  // Set .aspect for three-svg-renderer (it reads camera.aspect in SVGRenderer.ts:72)
  (camera as any).aspect = aspect;

  // === SVG Export ===
  const svgRenderer = new SVGRenderer();
  svgRenderer.addPass(new FillPass());
  svgRenderer.addPass(new VisibleChainPass());

  const svgMesh = new SVGMesh(mesh);
  const svg = await svgRenderer.generateSVG([svgMesh], camera as any, { w: W, h: H });
  const svgString = svg.svg();

  // === PNG Export via offscreen canvas ===
  // Use vertex-colored geometry if available (matches 3D view: grey bore + red outer)
  if (options.cutVCGeometry) {
    const vcMaterial = new THREE.MeshPhongMaterial({
      vertexColors: true, specular: '#ffffff', shininess: 300, side: THREE.DoubleSide,
    });
    const vcMesh = new THREE.Mesh(options.cutVCGeometry, vcMaterial);
    scene.remove(mesh);
    scene.add(vcMesh);
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.render(scene, camera);
  const pngDataUrl = renderer.domElement.toDataURL('image/png');
  renderer.dispose();

  return { svgString, pngDataUrl };
}
