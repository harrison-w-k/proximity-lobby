// Dev tool (not part of the game): draws animals from chosen angles onto one canvas, so model changes can be
// checked by eye. In the dev server, open the console and run:
//   (await import('/src/dev/modelsheet.ts')).renderSheet(['house_cat', 'gray_wolf'], { yaw: 0.6 })
import * as THREE from 'three';
import { toonMat } from '../arena/toon';
import { makePlayerRig } from '../arena/models';

export interface SheetOpts {
  cols?: number;
  cell?: number; // px per animal
  yaw?: number; // radians, 0 = side-on, PI/2 = front
  pitch?: number;
  frames?: number; // advance the walk cycle this many frames first
  speed?: number;
  close?: boolean; // frame the head
  state?: Record<string, unknown>; // extra rig state (e.g. { air: 2, soar: true })
}

export function renderSheet(ids: string[], o: SheetOpts = {}): string {
  const cols = o.cols ?? 4;
  const cell = o.cell ?? 320;
  const rows = Math.ceil(ids.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.setScissorTest(true);
  r.setClearColor(0x6fa8c8);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556655, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 32), toonMat({ color: 0x6f8f4a }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  ids.forEach((id, i) => {
    const rig = makePlayerRig(id);
    for (let f = 0; f < (o.frames ?? 0); f++) rig.update(1 / 30, { speed: o.speed ?? 4, attack: 0, hurt: 0, stun: false, flee: false, swim: false, t: f / 30 });
    if (!o.frames) for (let k = 0; k < (o.state ? 30 : 1); k++) rig.update(0.016, { speed: 0, attack: 0, hurt: 0, stun: false, flee: false, swim: false, t: 0, ...o.state });
    scene.add(rig.root);
    const box = new THREE.Box3().setFromObject(rig.root);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    let target = c;
    let dist = Math.max(size.x, size.y, size.z) * 2.1;
    if (o.close) {
      target = new THREE.Vector3(c.x, box.max.y - size.y * 0.3, box.max.z - size.z * 0.12);
      dist = Math.max(size.y, size.z) * 0.85;
    }
    const yaw = o.yaw ?? 0;
    const pitch = o.pitch ?? 0.12;
    cam.position.set(target.x + Math.sin(yaw) * dist * Math.cos(pitch), target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * dist * Math.cos(pitch));
    // yaw 0 looks from +z (the animal faces +z): rotate so "side-on" is the default
    cam.position.set(target.x + Math.cos(yaw) * dist * Math.cos(pitch), target.y + Math.sin(pitch) * dist, target.z + Math.sin(yaw) * dist * Math.cos(pitch));
    cam.lookAt(target);
    const x = (i % cols) * cell;
    const y = (rows - 1 - Math.floor(i / cols)) * cell;
    r.setViewport(x, y, cell, cell);
    r.setScissor(x, y, cell, cell);
    r.render(scene, cam);
    scene.remove(rig.root);
  });
  const url = canvas.toDataURL('image/png');
  r.dispose();
  return url;
}

/** Lay several views of several animals over the page, so a model change can be checked by eye. */
export function showSheet(ids: string[], views: SheetOpts[], cell = 360): number {
  const imgs: string[] = [];
  for (const id of ids) for (const v of views) imgs.push(renderSheet([id], { cols: 1, cell, ...v }));
  document.getElementById('__s')?.remove();
  const d = document.createElement('div');
  d.id = '__s';
  d.style.cssText = 'position:fixed;inset:0;background:#222;z-index:99999;overflow:auto;display:flex;flex-wrap:wrap;gap:3px;align-content:flex-start';
  d.innerHTML = imgs.map((u) => `<img src="${u}" style="width:${cell}px;height:${cell}px">`).join('');
  document.body.appendChild(d);
  return imgs.length;
}
