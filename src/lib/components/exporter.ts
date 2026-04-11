/**
 * Export component geometry as SVG via three-svg-renderer.
 * PNG is captured directly from the live Threlte canvas instead.
 */

import * as THREE from 'three';
import { SVGRenderer, SVGMesh, FillPass, VisibleChainPass } from 'three-svg-renderer';

/**
 * Render a BufferGeometry to SVG from orthographic cross-section view.
 */
export async function exportSVG(
  geometry: THREE.BufferGeometry,
  options: { width?: number; height?: number; color?: string } = {}
): Promise<string> {
  const W = options.width || 200;
  const H = options.height || 320;
  const color = options.color || '#cc2222';

  // Scene with solid-color material (FillPass needs material.color)
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  const material = new THREE.MeshPhongMaterial({
    color,
    specular: '#ffffff',
    shininess: 200,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  // Camera matching ComponentScene (zoom=60, pos=[6,0,0], Z-down)
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
  (camera as any).aspect = aspect;

  // SVG render
  const svgRenderer = new SVGRenderer();
  svgRenderer.addPass(new FillPass());
  svgRenderer.addPass(new VisibleChainPass());

  const svgMesh = new SVGMesh(mesh);
  const svg = await svgRenderer.generateSVG([svgMesh], camera as any, { w: W, h: H });
  return svg.svg();
}
