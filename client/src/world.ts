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
export const DEFAULT_FOV = 75;
const THIRD_DISTANCE = 3.6; // metres behind the head in third person
const THIRD_LIFT = 0.3; // and a little above, so you see over your own shoulders

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

// ---------- scenery: twilight sky, sea and island ----------
const SKY_HORIZON = 0x2a2552; // fog and sea fade into this, so the horizon is seamless

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x03050d) },
      mid: { value: new THREE.Color(0x0d1432) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
      glow: { value: new THREE.Color(0x7a4a86) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 glow;
      varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.28, h));
        c = mix(c, top, smoothstep(0.22, 0.85, h));
        c = mix(c, glow, (1.0 - smoothstep(0.0, 0.09, abs(h))) * 0.55);   // faint warm band at the horizon
        c = mix(c, horizon * 0.55, smoothstep(0.0, -0.25, h));            // below the horizon: deeper
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  dome.renderOrder = -10;
  return dome;
}

function makeStars(): THREE.Group {
  const rnd = seeded(7);
  const group = new THREE.Group();
  const layer = (count: number, size: number, color: number, opacity: number) => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = 0.03 + rnd() * 0.97; // upper hemisphere only
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 800, y * 800, Math.sin(a) * r * 800], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: false,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    });
    group.add(new THREE.Points(g, m));
  };
  layer(1600, 1.3, 0xffffff, 0.75);
  layer(140, 2.4, 0xcfe0ff, 0.95);
  return group;
}

function makeMoon(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const halo = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  halo.addColorStop(0, 'rgba(235,242,255,0.55)');
  halo.addColorStop(0.35, 'rgba(160,185,255,0.18)');
  halo.addColorStop(1, 'rgba(160,185,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#f4f7ff';
  g.beginPath();
  g.arc(128, 128, 30, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }),
  );
  moon.scale.set(220, 220, 1);
  moon.position.set(-340, 300, -460);
  return moon;
}

function makeWaterTexture(): THREE.CanvasTexture {
  const rnd = seeded(21);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a1733';
  g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const len = 6 + rnd() * 22;
    g.strokeStyle = `rgba(120,160,255,${0.05 + rnd() * 0.14})`;
    g.lineWidth = 1 + rnd() * 1.6;
    for (const dx of [-256, 0, 256]) {
      // draw wrapped copies so the texture tiles without a seam
      g.beginPath();
      g.moveTo(x + dx, y);
      g.lineTo(x + dx + len, y + (rnd() - 0.5) * 3);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(160, 160);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePalm(rnd: () => number): THREE.Group {
  const palm = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5d4d3b });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2c6b57, side: THREE.DoubleSide });
  const height = 4 + rnd() * 1.6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.2, height, 6), trunkMat);
  trunk.position.y = height / 2;
  palm.add(trunk);
  const crown = new THREE.Group();
  crown.position.y = height;
  for (let i = 0; i < 8; i++) {
    const geo = new THREE.ConeGeometry(0.32, 3.0, 4);
    geo.translate(0, 1.5, 0); // base at the origin, pointing +y
    const leaf = new THREE.Mesh(geo, leafMat);
    leaf.rotation.z = -(Math.PI / 2 + 0.15 + rnd() * 0.45); // fan outward with a gentle droop
    leaf.scale.set(1, 1, 0.35);
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 8) * Math.PI * 2 + rnd() * 0.3;
    pivot.add(leaf);
    crown.add(pivot);
  }
  palm.add(crown);
  palm.rotation.z = (rnd() - 0.5) * 0.18; // slight lean
  palm.rotation.y = rnd() * Math.PI * 2;
  return palm;
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
  readonly camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 1500);
  readonly avatars = new Map<string, Avatar>();
  readonly pos = new THREE.Vector3(0, EYE_HEIGHT, 0); // camera position (feet + eye height)
  yaw = 0;
  pitch = 0;
  feetY = 0; // height of our feet above the floor; > 0 while jumping
  orbit = true; // slow fly-around of the arena behind the main screen; off once we join
  thirdPerson = false; // toggled with T; the camera eases between the two views
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
  private orbitAngle = Math.random() * Math.PI * 2;
  private tpBlend = 0; // 0 = first person, 1 = fully third person
  private selfThird = new THREE.Group(); // our full avatar, shown only in third person
  private selfBody = new THREE.Group();
  private selfSkin = new THREE.MeshLambertMaterial({ color: 0x6b7bd6 });
  private ray = new THREE.Raycaster();
  private centre = new THREE.Vector2(0, 0);
  private waterTex?: THREE.CanvasTexture;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Twilight over a dark sea: the fog is the horizon colour, so the water melts into the sky.
    const horizon = new THREE.Color(SKY_HORIZON);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 70, 340);
    this.camera.rotation.order = 'YXZ';
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.add(new THREE.HemisphereLight(0x8fa0ff, 0x151a2b, 1.0));
    const moonlight = new THREE.DirectionalLight(0xb9c8ff, 1.0);
    moonlight.position.set(-34, 60, -46); // from the moon's side of the sky
    this.scene.add(moonlight);

    this.scene.add(makeSkyDome(), makeStars(), makeMoon());
    this.buildIsland();
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
    this.ray.setFromCamera(this.centre, this.camera);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects([...this.avatars.values()].map((a) => a.hit), false);
    return hits.length ? (hits[0].object.userData.id as string) : null;
  }

  /** The checkered arena sits on a sand-ringed island in a dark sea, with palms and rocks. */
  private buildIsland() {
    const R = MAP_RADIUS;
    const rnd = seeded(1337);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96),
      new THREE.MeshLambertMaterial({ map: makeCheckerTexture(this.renderer.capabilities.getMaxAnisotropy()) }),
    );
    floor.rotation.x = -Math.PI / 2;

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.5, R, 96),
      new THREE.MeshBasicMaterial({ color: 0x4f7cff }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;

    const beach = new THREE.Mesh(
      new THREE.RingGeometry(R, R + 7, 96),
      new THREE.MeshLambertMaterial({ color: 0x8f836d }),
    );
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = -0.02;

    const foam = new THREE.Mesh(
      new THREE.RingGeometry(R + 6.6, R + 8.2, 96),
      new THREE.MeshBasicMaterial({ color: 0xbcd0ff, transparent: true, opacity: 0.35 }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.3;

    this.waterTex = makeWaterTexture();
    const sea = new THREE.Mesh(
      new THREE.CircleGeometry(1000, 64),
      new THREE.MeshBasicMaterial({ map: this.waterTex }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.35;

    this.scene.add(floor, rim, beach, foam, sea);

    // Palms along the beach. Decoration only: they are outside the walkable circle.
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const r = R + 1.8 + rnd() * 3.4;
      const palm = makePalm(rnd);
      palm.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      this.scene.add(palm);
    }

    // Rocks on the beach and out in the shallows.
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x4a4f66 });
    for (let i = 0; i < 16; i++) {
      const angle = rnd() * Math.PI * 2;
      const r = R + 3 + rnd() * 24;
      const size = 0.7 + rnd() * 1.6;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), rockMat);
      rock.position.set(Math.cos(angle) * r, size * 0.25 - 0.3, Math.sin(angle) * r);
      rock.scale.y = 0.6;
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      this.scene.add(rock);
    }
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

    const capsule = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.0, 4, 12), this.selfSkin);
    capsule.position.y = 0.85;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.2), new THREE.MeshLambertMaterial({ color: 0x151824 }));
    visor.position.set(0, 1.4, -0.28); // faces -Z like everyone else's avatar
    this.selfThird.add(capsule, visor);
    this.scene.add(this.selfThird);
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

  // three.js only schedules the next frame after this callback returns, so an exception here
  // would freeze the game for good. Each stage is isolated: one bad value cannot stop the rest.
  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.safe('update', () => this.update(dt));
    this.safe('render', () => this.renderer.render(this.scene, this.camera));
    this.safe('frame', () => this.onFrame?.(dt));
  };

  private reported = new Set<string>();
  private safe(stage: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      const key = `${stage}: ${e instanceof Error ? e.message : String(e)}`;
      if (this.reported.has(key)) return; // log each distinct error once, not 60 times a second
      this.reported.add(key);
      console.error('[game] frame error (game kept running)', key, e);
    }
  }

  private update(dt: number) {
    this.move(dt);
    if (this.waterTex) {
      this.waterTex.offset.x += dt * 0.006;
      this.waterTex.offset.y += dt * 0.0025;
    }
    for (const a of this.avatars.values()) a.update(dt);
    this.collide();
    this.pos.y = this.feetY + this.eye;
    this.tpBlend += ((this.thirdPerson ? 1 : 0) - this.tpBlend) * (1 - Math.exp(-7 * dt));
    if (Math.abs(this.tpBlend - (this.thirdPerson ? 1 : 0)) < 0.001) this.tpBlend = this.thirdPerson ? 1 : 0;
    if (this.orbit) {
      this.orbitAngle += dt * 0.06;
      const r = MAP_RADIUS * 0.7;
      this.camera.position.set(Math.cos(this.orbitAngle) * r, 6, Math.sin(this.orbitAngle) * r);
      this.camera.lookAt(0, 5, 0); // slightly down, so the horizon, moon and stars frame the menu
    } else {
      // Smoothstep so the pull-back starts and ends gently; the head position never moves.
      const t = this.tpBlend * this.tpBlend * (3 - 2 * this.tpBlend);
      const cp = Math.cos(this.pitch);
      const back = THIRD_DISTANCE * t;
      this.camera.position.set(
        this.pos.x + Math.sin(this.yaw) * cp * back,
        Math.max(0.35, this.pos.y - Math.sin(this.pitch) * back + THIRD_LIFT * t),
        this.pos.z + Math.cos(this.yaw) * cp * back,
      );
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }
    // First-person torso and legs only while the camera is at the head; the capsule takes over as it pulls back.
    this.selfBody.visible = !this.orbit && this.tpBlend < 0.02;
    this.selfThird.visible = !this.orbit && this.tpBlend >= 0.02;
    this.selfThird.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfThird.rotation.y = this.yaw;
    this.selfThird.scale.y = 0.7 + 0.3 * Math.min(1, Math.max(0, (this.eye - EYE_CROUCH) / (EYE_HEIGHT - EYE_CROUCH)));
    this.selfBody.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfBody.rotation.y = this.yaw;
    this.selfBody.scale.y = this.eye / EYE_HEIGHT;
  }

}
