// Dev-only: every reptile on one screen, from a three-quarter view (a for-looking-at page, not part of the game).
import * as THREE from 'three';
import { makePlayerRig } from '../arena/models';

const IDS = ['gecko', 'monitor', 'komodo', 'croc', 'snapping_turtle', 'tortoise', 'sea_turtle', 'cobra', 'viper', 'python'];
const q = new URLSearchParams(location.search);
const only = q.get('only')?.split(',') ?? IDS;
const view = q.get('view') ?? '34'; // 34, side, top, front
const W = 1600;
const H = 900;
const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(W, H);
r.setScissorTest(true);
document.body.append(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8aa0b0);
scene.add(new THREE.HemisphereLight(0xf4e6b4, 0x5c7a48, 1.25));
const sun = new THREE.DirectionalLight(0xffd98e, 1.8);
sun.position.set(180, 260, 90);
scene.add(sun);
const cols = Math.min(Number(q.get('cols') ?? 5), only.length);
const rows = Math.ceil(only.length / cols);
const tiles: { rig: ReturnType<typeof makePlayerRig>; cam: THREE.PerspectiveCamera; x: number; y: number }[] = [];
only.forEach((id, i) => {
  const rig = makePlayerRig(id);
  rig.root.position.set(i * 60, 0, 0);
  scene.add(rig.root);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 24), new THREE.MeshLambertMaterial({ color: 0x6f8a52 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(i * 60, -0.01, 0);
  scene.add(ground);
  rig.update(0.016, { speed: 0, attack: 0, hurt: 0, stun: false, flee: false, swim: false, t: 0 });
  const box = new THREE.Box3().setFromObject(rig.root);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const m = Math.max(s.x, s.y * 1.4, s.z) * 1.15 + 0.2;
  const cam = new THREE.PerspectiveCamera(35, W / cols / (H / rows), 0.05, 200);
  const d = m / Math.tan((35 * Math.PI) / 360) * 0.5;
  const dir = view === 'side' ? [1, 0.12, 0] : view === 'top' ? [0.05, 1, 0.3] : view === 'front' ? [0, 0.25, 1] : [0.8, 0.45, 0.85];
  const l = Math.hypot(...dir);
  cam.position.set(c.x + (dir[0] / l) * d, c.y + (dir[1] / l) * d, c.z + (dir[2] / l) * d);
  cam.lookAt(c);
  tiles.push({ rig, cam, x: i % cols, y: Math.floor(i / cols) });
});
const w = W / cols;
const h = H / rows;
let t = 0;
const frame = () => {
  t += 0.016;
  for (const { rig, cam, x, y } of tiles) {
    rig.update(0.016, { speed: 0, attack: 0, hurt: 0, stun: false, flee: false, swim: false, t });
    r.setViewport(x * w, H - (y + 1) * h, w, h);
    r.setScissor(x * w, H - (y + 1) * h, w, h);
    r.render(scene, cam);
  }
  (window as unknown as { done: number }).done = 1;
};
frame();
(window as unknown as { frame: () => void }).frame = frame;
