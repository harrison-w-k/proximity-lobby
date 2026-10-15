import * as THREE from 'three';
import { MAP_HALF, type PlayerState } from '../../shared/protocol';
import { pushOut } from './collision';

export const EYE_HEIGHT = 1.6;
const WALK_SPEED = 5;
const SPRINT_SPEED = 9;
const BODY_RADIUS = 0.4;
const FLOOR_SIZE = 400;

export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

function makeCheckerTexture(maxAniso: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e9e9';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#3b3f4a';
  g.fillRect(0, 0, 32, 32);
  g.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(FLOOR_SIZE / 4, FLOOR_SIZE / 4); // each tile = 4 m => 2 m squares
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = maxAniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.roundRect(4, 8, 248, 48, 16);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '600 28px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.15;
  return sprite;
}

class Avatar {
  readonly group = new THREE.Group();
  private body: THREE.MeshStandardMaterial;
  private tx: number;
  private tz: number;
  private try_: number;

  constructor(p: PlayerState) {
    const color = new THREE.Color().setHSL(hueFor(p.id) / 360, 0.65, 0.55);
    this.body = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 12), this.body);
    capsule.position.y = 0.85;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.16, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x151824 }),
    );
    visor.position.set(0, 1.4, -0.28); // faces -Z (same as camera forward at yaw 0)
    this.group.add(capsule, visor, makeNameSprite(p.name));
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = p.ry;
    this.tx = p.x;
    this.tz = p.z;
    this.try_ = p.ry;
  }

  setTarget(x: number, z: number, ry: number) {
    this.tx = x;
    this.tz = z;
    this.try_ = ry;
  }

  setSpeaking(on: boolean) {
    this.body.emissiveIntensity = on ? 0.9 : 0;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-15 * dt);
    const g = this.group;
    g.position.x += (this.tx - g.position.x) * k;
    g.position.z += (this.tz - g.position.z) * k;
    let d = this.try_ - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest angle
    g.rotation.y += d * k;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh | THREE.Sprite;
      (m as THREE.Mesh).geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.SpriteMaterial | undefined;
      (mat as THREE.SpriteMaterial | undefined)?.map?.dispose();
      mat?.dispose();
    });
  }
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
  readonly avatars = new Map<string, Avatar>();
  readonly pos = new THREE.Vector3(0, EYE_HEIGHT, 0);
  yaw = 0;
  pitch = 0;
  inputEnabled = true;
  lookSensitivity = 1; // multiplier on mouse look; 1 = the original feel
  onFrame?: (dt: number) => void;

  private keys = new Set<string>();
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const sky = new THREE.Color(0x9ccfee);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 40, 140);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
      new THREE.MeshLambertMaterial({ map: makeCheckerTexture(this.renderer.capabilities.getMaxAnisotropy()) }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

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
      const k = 0.0022 * this.lookSensitivity;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * k));
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
    const p = pushOut(this.pos.x, this.pos.z, [...this.avatars.values()].map((a) => a.group.position), BODY_RADIUS * 2);
    this.pos.x = Math.max(-lim, Math.min(lim, p.x));
    this.pos.z = Math.max(-lim, Math.min(lim, p.z));
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.move(dt);
    for (const a of this.avatars.values()) a.update(dt);
    this.collide();
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(dt);
  };
}
