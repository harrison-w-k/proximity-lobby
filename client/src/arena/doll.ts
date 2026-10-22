// The paper doll: a small live model of your own animal in the corner of the screen, like the
// player in Minecraft's inventory. It plays the same animations as the animal in the world.
import * as THREE from 'three';
import { makeLeaderRig, makePlayerRig, type Rig, type RigState } from './models';

export interface Rect {
  x: number; // CSS pixels from the left
  y: number; // CSS pixels from the top
  w: number;
  h: number;
}

export class Doll {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  private rig: Rig | null = null;
  private key = '';
  private yaw = 2.5;
  private hurt = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x7a6a4a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 20), new THREE.MeshBasicMaterial({ color: 0x3b4a2a, transparent: true, opacity: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    floor.name = 'floor';
    this.scene.add(floor);
  }

  /** Rebuild the model when the animal (or a leader's form) changes. */
  set(animal: string, role: number, swarm: string | undefined, tier: number, paint?: [number, number], who?: string) {
    const key = `${animal}|${role}|${swarm}|${tier}|${paint?.join(',') ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = role === 2 ? makeLeaderRig(swarm ?? 'rat', tier) : makePlayerRig(animal, paint, who);
    this.scene.add(this.rig.root);
    // frame the whole animal, whatever its size
    const box = new THREE.Box3().setFromObject(this.rig.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.02;
    this.camera.position.set(0, sphere.center.y + dist * 0.18, dist);
    this.camera.lookAt(0, sphere.center.y, 0);
    const floor = this.scene.getObjectByName('floor') as THREE.Mesh;
    floor.scale.setScalar(Math.max(0.6, sphere.radius * 0.9));
  }

  /** Copy the world animal's animation, and turn with the camera like Minecraft's doll. */
  update(dt: number, st: RigState | undefined, bodyYaw: number, camYaw: number) {
    if (!this.rig || !st) return;
    let rel = bodyYaw - camYaw;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    const target = 2.45 + rel * 0.55;
    this.yaw += (target - this.yaw) * (1 - Math.exp(-dt * 8));
    this.rig.root.rotation.y = this.yaw;
    this.hurt = Math.max(this.hurt - dt * 2, st.hurt);
    this.rig.update(dt, { ...st, hurt: this.hurt });
  }

  /** Draw into a corner of the main canvas (call after the world has been drawn). */
  render(r: THREE.WebGLRenderer, rect: Rect) {
    if (!this.rig) return;
    const buf = r.getDrawingBufferSize(new THREE.Vector2());
    const k = buf.x / Math.max(1, window.innerWidth);
    const x = Math.round(rect.x * k);
    const w = Math.round(rect.w * k);
    const h = Math.round(rect.h * k);
    const y = Math.round(buf.y - (rect.y + rect.h) * k);
    const prev = r.autoClear;
    r.autoClear = false;
    r.setScissorTest(true);
    r.setScissor(x, y, w, h);
    r.setViewport(x, y, w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    r.clearDepth();
    r.render(this.scene, this.camera);
    r.setScissorTest(false);
    r.setViewport(0, 0, buf.x, buf.y);
    r.autoClear = prev;
  }
}
