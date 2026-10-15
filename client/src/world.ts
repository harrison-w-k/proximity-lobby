import * as THREE from 'three';
import { MAP_HALF, type PlayerState } from '../../shared/protocol';
import { pushOut, pushOutBoxes, pushOutDiscs } from './collision';
import { buildEnvironment, type Environment } from './environment';
import { Avatar } from './avatar';

export const EYE_HEIGHT = 1.6;
const WALK_SPEED = 5;
const SPRINT_SPEED = 9;
const BODY_RADIUS = 0.4;
const PIXEL_ROWS = 320; // internal render height: chunky retro pixels, upscaled with nearest-neighbour

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 600);
  readonly avatars = new Map<string, Avatar>();
  private env: Environment;
  readonly pos = new THREE.Vector3(0, EYE_HEIGHT, 0);
  yaw = 0;
  pitch = 0;
  inputEnabled = true;
  onFrame?: (dt: number) => void;

  private keys = new Set<string>();
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setClearColor(0x133c78);
    this.scene.fog = new THREE.Fog(0x133c78, 30, 150);
    this.camera.rotation.order = 'YXZ';
    this.env = buildEnvironment(this.scene, this.renderer.capabilities.getMaxAnisotropy());

    window.addEventListener('resize', this.resize);
    this.resize();

    window.addEventListener('keydown', (e) => {
      if (!this.inputEnabled) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas || !this.inputEnabled) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * 0.0022));
    });

    this.renderer.setAnimationLoop(this.tick);
  }

  lock() {
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* needs a user gesture; the "click to resume" prompt covers it */
    }
  }

  clearKeys() {
    this.keys.clear();
  }

  teleport(x: number, z: number) {
    this.pos.set(x, EYE_HEIGHT, z);
  }

  addPlayer(p: PlayerState) {
    if (this.avatars.has(p.id)) return;
    const a = new Avatar(p);
    this.avatars.set(p.id, a);
    this.scene.add(a.group);
  }

  removePlayer(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.group);
    a.dispose();
    this.avatars.delete(id);
  }

  applyState(id: string, x: number, z: number, ry: number) {
    this.avatars.get(id)?.setTarget(x, z, ry);
  }

  setSpeaking(id: string, on: boolean) {
    this.avatars.get(id)?.setSpeaking(on);
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const px = Math.max(1, Math.round(h / PIXEL_ROWS));
    this.renderer.setPixelRatio(1 / px);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private move(dt: number) {
    if (!this.inputEnabled) return;
    const k = this.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    if (!f && !s) return;
    const len = Math.hypot(f, s);
    f /= len;
    s /= len;
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const lim = MAP_HALF - BODY_RADIUS;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x + (-sin * f + cos * s) * speed * dt));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z + (-cos * f - sin * s) * speed * dt));
  }

  /** Players are solid: slide around others and get nudged if someone walks into you. */
  private collide() {
    const lim = MAP_HALF - BODY_RADIUS;
    let p = pushOut(this.pos.x, this.pos.z, [...this.avatars.values()].map((a) => a.group.position), BODY_RADIUS * 2);
    for (let i = 0; i < 3; i++) {
      p = pushOutBoxes(p.x, p.z, this.env.boxes, BODY_RADIUS);
      p = pushOutDiscs(p.x, p.z, this.env.discs, BODY_RADIUS);
    }
    this.pos.x = Math.max(-lim, Math.min(lim, p.x));
    this.pos.z = Math.max(-lim, Math.min(lim, p.z));
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.move(dt);
    for (const a of this.avatars.values()) a.update(dt);
    this.env.update(now / 1000, dt);
    this.collide();
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(dt);
  };
}
