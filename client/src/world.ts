import * as THREE from 'three';
import { MAP_RADIUS, type PlayerState } from '../../shared/protocol';
import { clampToArena } from '../../shared/map';
import { pushOut } from './collision';

export const EYE_HEIGHT = 1.6;
const EYE_CROUCH = 1.0;
const WALK_SPEED = 5;
const SPRINT_SPEED = 9;
const CROUCH_SPEED = 2.5;
const BODY_RADIUS = 0.4;
const GRAVITY = 22; // m/s^2
const JUMP_SPEED = 7.5; // m/s => about 1.3 m jump
// How quickly velocity eases toward the wanted velocity (per second). Lower = floatier.
const GROUND_ACCEL = 10;
const GROUND_DECEL = 14;
const AIR_ACCEL = 2.5;
const WALL_HEIGHT = 6;
export const DEFAULT_FOV = 75;

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
  tex.repeat.set((MAP_RADIUS * 2) / 4, (MAP_RADIUS * 2) / 4); // each tile = 4 m => 2 m squares
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

const CROUCH_SCALE = 0.7;
const NAME_HEIGHT = 2.15;

class Avatar {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh; // what the crosshair ray tests against
  private shell = new THREE.Group(); // capsule + visor; squashed when crouching
  private label: THREE.Sprite;
  private body: THREE.MeshStandardMaterial;
  private tx: number;
  private tz: number;
  private ty: number;
  private try_: number;
  private crouch: boolean;

  constructor(p: PlayerState) {
    const color = new THREE.Color().setHSL(hueFor(p.id) / 360, 0.65, 0.55);
    this.body = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0 });
    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 12), this.body);
    capsule.position.y = 0.85;
    capsule.userData.id = p.id;
    this.hit = capsule;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.16, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x151824 }),
    );
    visor.position.set(0, 1.4, -0.28); // faces -Z (same as camera forward at yaw 0)
    this.shell.add(capsule, visor);
    this.label = makeNameSprite(p.name);
    this.group.add(this.shell, this.label);
    this.group.position.set(p.x, p.y ?? 0, p.z);
    this.group.rotation.y = p.ry;
    this.tx = p.x;
    this.tz = p.z;
    this.ty = p.y ?? 0;
    this.try_ = p.ry;
    this.crouch = p.crouch ?? false;
    const s = this.crouch ? CROUCH_SCALE : 1;
    this.shell.scale.y = s;
    this.label.position.y = NAME_HEIGHT * s;
  }

  setTarget(x: number, z: number, ry: number, y: number, crouch: boolean) {
    this.tx = x;
    this.tz = z;
    this.ty = y;
    this.try_ = ry;
    this.crouch = crouch;
  }

  setSpeaking(on: boolean) {
    this.body.emissiveIntensity = on ? 0.9 : 0;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-15 * dt);
    const g = this.group;
    g.position.x += (this.tx - g.position.x) * k;
    g.position.z += (this.tz - g.position.z) * k;
    g.position.y += (this.ty - g.position.y) * k;
    const want = this.crouch ? CROUCH_SCALE : 1;
    this.shell.scale.y += (want - this.shell.scale.y) * k;
    this.label.position.y = NAME_HEIGHT * this.shell.scale.y;
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
  readonly camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 400);
  readonly avatars = new Map<string, Avatar>();
  readonly pos = new THREE.Vector3(0, EYE_HEIGHT, 0); // camera position (feet + eye height)
  yaw = 0;
  pitch = 0;
  feetY = 0; // height of our feet above the floor; > 0 while jumping
  crouching = false;
  inputEnabled = true;
  lookSensitivity = 1; // multiplier on mouse look; 1 = the original feel
  onFrame?: (dt: number) => void;

  private keys = new Set<string>();
  private last = performance.now();
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private eye = EYE_HEIGHT; // current eye height, eased toward standing/crouching
  private selfBody = new THREE.Group();
  private selfSkin = new THREE.MeshLambertMaterial({ color: 0x6b7bd6 });
  private ray = new THREE.Raycaster();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const sky = new THREE.Color(0x9ccfee);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 50, 170);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f9c, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);

    // A circular arena with a visible edge, so the world clearly ends.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(MAP_RADIUS, 96),
      new THREE.MeshLambertMaterial({ map: makeCheckerTexture(this.renderer.capabilities.getMaxAnisotropy()) }),
    );
    floor.rotation.x = -Math.PI / 2;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(MAP_RADIUS, MAP_RADIUS, WALL_HEIGHT, 96, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x2b3350, side: THREE.BackSide }),
    );
    wall.position.y = WALL_HEIGHT / 2;
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(MAP_RADIUS - 0.5, MAP_RADIUS, 96),
      new THREE.MeshBasicMaterial({ color: 0x4f7cff }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(MAP_RADIUS, MAP_RADIUS, 0.3, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x4f7cff, side: THREE.BackSide }),
    );
    cap.position.y = WALL_HEIGHT;
    this.scene.add(floor, wall, rim, cap);
    this.buildSelfBody();

    window.addEventListener('resize', this.resize);
    this.resize();

    window.addEventListener('keydown', (e) => {
      if (!this.inputEnabled) return;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      // Ctrl is sprint: stop Ctrl+S / Ctrl+D / Ctrl+A etc. from opening browser dialogs mid-game.
      // (Ctrl+W, Ctrl+T, Ctrl+N are reserved by the browser and cannot be blocked.)
      if ((e.ctrlKey || e.metaKey) && document.pointerLockElement === this.canvas) e.preventDefault();
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
    this.feetY = 0;
    this.eye = EYE_HEIGHT;
    this.vx = this.vy = this.vz = 0;
    this.pos.set(x, EYE_HEIGHT, z);
  }

  setFov(deg: number) {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  /** Colour our own body like the capsule other players see us as. */
  setSelfId(id: string) {
    this.selfSkin.color.setHSL(hueFor(id) / 360, 0.65, 0.55);
  }

  /** Id of the player under the crosshair within `maxDist` metres, if any. Call after render. */
  playerUnderCrosshair(maxDist: number): string | null {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects([...this.avatars.values()].map((a) => a.hit), false);
    return hits.length ? (hits[0].object.userData.id as string) : null;
  }

  /** Torso, arms and legs under the camera so you can see yourself when you look down. */
  private buildSelfBody() {
    const dark = new THREE.MeshLambertMaterial({ color: 0x20242f });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };
    // z > 0 is behind the camera, so nothing here can block the view straight ahead.
    this.selfBody.add(
      box(0.46, 0.55, 0.26, 0, 1.12, 0.1, this.selfSkin), // torso
      box(0.14, 0.55, 0.16, -0.31, 1.12, 0.1, this.selfSkin), // arms
      box(0.14, 0.55, 0.16, 0.31, 1.12, 0.1, this.selfSkin),
      box(0.17, 0.85, 0.2, -0.11, 0.425, 0.1, dark), // legs
      box(0.17, 0.85, 0.2, 0.11, 0.425, 0.1, dark),
    );
    this.scene.add(this.selfBody);
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

  applyState(id: string, x: number, z: number, ry: number, y: number, crouch: boolean) {
    this.avatars.get(id)?.setTarget(x, z, ry, y, crouch);
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

  /** Smoothed walking, sprint (Ctrl), crouch (Shift) and jump (Space) with gravity. */
  private move(dt: number) {
    const k = this.keys;
    const on = this.inputEnabled;
    let f = on ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    let s = on ? (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) : 0;

    this.crouching = on && (k.has('ShiftLeft') || k.has('ShiftRight'));
    const sprinting = on && !this.crouching && (k.has('ControlLeft') || k.has('ControlRight'));
    const speed = this.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;

    let tx = 0;
    let tz = 0;
    const wantsMove = f !== 0 || s !== 0;
    if (wantsMove) {
      const len = Math.hypot(f, s);
      f /= len;
      s /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      tx = (-sin * f + cos * s) * speed;
      tz = (-cos * f - sin * s) * speed;
    }

    // Ease toward the wanted velocity: a short ramp up, a short slide to a stop, and momentum in the air.
    const grounded = this.feetY <= 0 && this.vy <= 0;
    const rate = grounded ? (wantsMove ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL;
    const a = 1 - Math.exp(-rate * dt);
    this.vx += (tx - this.vx) * a;
    this.vz += (tz - this.vz) * a;

    if (on && grounded && k.has('Space')) this.vy = JUMP_SPEED;
    this.vy -= GRAVITY * dt;
    this.feetY += this.vy * dt;
    if (this.feetY <= 0) {
      this.feetY = 0;
      this.vy = 0;
    }

    const p = clampToArena(this.pos.x + this.vx * dt, this.pos.z + this.vz * dt, MAP_RADIUS - BODY_RADIUS);
    this.pos.x = p.x;
    this.pos.z = p.z;

    const wantEye = this.crouching ? EYE_CROUCH : EYE_HEIGHT;
    this.eye += (wantEye - this.eye) * (1 - Math.exp(-14 * dt));
  }

  /** Players are solid: slide around others and get nudged if someone walks into you. */
  private collide() {
    const p = pushOut(this.pos.x, this.pos.z, [...this.avatars.values()].map((a) => a.group.position), BODY_RADIUS * 2);
    const q = clampToArena(p.x, p.z, MAP_RADIUS - BODY_RADIUS);
    this.pos.x = q.x;
    this.pos.z = q.z;
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.move(dt);
    for (const a of this.avatars.values()) a.update(dt);
    this.collide();
    this.pos.y = this.feetY + this.eye;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.selfBody.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfBody.rotation.y = this.yaw;
    this.selfBody.scale.y = this.eye / EYE_HEIGHT;
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(dt);
  };
}
