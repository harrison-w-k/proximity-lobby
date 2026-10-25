// A training dummy for the lobby island: a wooden post with a crossbar and a painted target on a sack head.
import * as THREE from 'three';
import { toonMat } from './toon';
import type { Rig, RigState } from './models';

const WOOD = 0x9b6b3f;
const DARK = 0x6b4526;
const SACK = 0xd9c48f;

export function makeDummyRig(): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const part = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z = 0) => {
    const m = new THREE.Mesh(geo, toonMat({ color, flatShading: true }));
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  part(new THREE.CylinderGeometry(0.5, 0.6, 0.18, 12), DARK, 0, 0.09); // base
  part(new THREE.CylinderGeometry(0.17, 0.2, 1.7, 8), WOOD, 0, 0.95); // post
  part(new THREE.BoxGeometry(1.3, 0.16, 0.16), WOOD, 0, 1.35); // arms
  part(new THREE.SphereGeometry(0.34, 12, 10), SACK, 0, 1.95); // head
  // a target painted on the front of the chest
  const rings = [0.34, 0.24, 0.14, 0.06];
  const cols = [0xf2f2f2, 0xd8382c, 0xf2f2f2, 0xd8382c];
  rings.forEach((r, i) => {
    const t = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: cols[i], side: THREE.DoubleSide }));
    t.position.set(0, 1.15, 0.2 + i * 0.002);
    body.add(t);
  });
  const mats: THREE.MeshToonMaterial[] = [];
  body.traverse((o) => {
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshToonMaterial) mats.push(o.material);
  });
  let wobble = 0;
  return {
    root,
    height: 2.4,
    radius: 0.6,
    update(dt: number, s: RigState) {
      // a hit rocks the post back and it swings back upright
      wobble = Math.max(wobble * Math.exp(-dt * 3), s.hurt * 0.35);
      body.rotation.x = Math.sin(s.t * 14) * wobble;
      body.rotation.z = Math.cos(s.t * 11) * wobble * 0.6;
    },
    setTint(color: number | null) {
      for (const m of mats) m.emissive.setHex(color ?? 0);
    },
  };
}
