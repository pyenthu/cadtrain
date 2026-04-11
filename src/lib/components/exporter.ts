/**
 * Export component geometry as SVG (via three-svg-renderer) and PNG (via canvas).
 *
 * Usage from browser:
 *   const { svgString, pngDataUrl } = await exportComponent(geo, params);
 */

import * as THREE from 'three';
import { SVGRenderer, SVGMesh, FillPass, VisibleChainPass } from 'three-svg-renderer';

export interface ExportResult {
  svgString: string;
  pngDataUrl: string;
}

/**
 * Render a BufferGeometry to SVG + PNG from a fixed camera angle.
 */
export async function exportComponent(
  geometry: THREE.BufferGeometry,
  options: { width?: number; height?: number; color?: string } = {}
): Promise<ExportResult> {
  const W = options.width || 400;
  const H = options.height || 600;
  const color = options.color || '#cc2222';

  // === Build Three.js scene ===
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  // Mesh with material
  const material = new THREE.MeshPhongMaterial({
    color,
    specular: '#ffffff',
    shininess: 200,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  const point = new THREE.PointLight(0xffffff, 200, 50);
  point.position.set(4, -3, -2);
  scene.add(point);

  // Camera — narrow FOV from far away simulates orthographic
  // Position matches bottom sub: looking along X axis, Z-down convention
  const camera = new THREE.PerspectiveCamera(5, W / H, 1, 200);
  camera.position.set(60, 1, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  // === SVG Export ===
  const svgRenderer = new SVGRenderer();
  svgRenderer.addPass(new FillPass());
  svgRenderer.addPass(new VisibleChainPass());

  const svgMesh = new SVGMesh(mesh);
  const svg = await svgRenderer.generateSVG([svgMesh], camera, { w: W, h: H });
  const svgString = svg.svg();

  // === PNG Export via offscreen canvas ===
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
