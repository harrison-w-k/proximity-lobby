import * as THREE from 'three';
import { MAP_RADIUS, SWIM_LIMIT, type PlayerState } from '../../shared/protocol';
import { clampToArena, waterDepth, WADE_DEPTH } from '../../shared/map';
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

// ---------- retro look ----------
// The scene is drawn small (about 512x288) and scaled up with nearest-neighbour filtering, then
// reduced to 16 levels per channel with an ordered (Bayer) dither: the chunky, gritty look of
// late-90s 3D. Models are low-poly and flat shaded; textures are tiny and unfiltered.
const RT_HEIGHT = 288;
const COLOR_LEVELS = 15; // 16 shades per channel

export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

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

/** A small canvas as an unfiltered, mip-less texture (hard pixels at any distance). */
function pixelTexture(c: HTMLCanvasElement, repeat = 0): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
  }
  return tex;
}

function makeCheckerTexture(): THREE.CanvasTexture {
  const rnd = seeded(11);
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7ccf56';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#58a83c';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  // a few speckles so big flat tiles don't look like vector fills
  for (let i = 0; i < 26; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(20,70,20,0.35)' : 'rgba(210,255,170,0.35)';
    g.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1);
  }
  return pixelTexture(c, (MAP_RADIUS * 2) / 6); // one texture tile = 6 m, so squares are 3 m
}

function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(4, 8, 248, 48);
  g.fillStyle = '#fff';
  g.font = '700 30px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2.0, 0.5, 1);
  sprite.position.y = 2.15;
  return sprite;
}

// ---------- scenery: banded sky, sun, blocky clouds, sea, island ----------
const SKY_HORIZON = 0xbfe4ff; // fog and sea fade into this, so the horizon is seamless

function makeSkyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2c5fd6) },
      mid: { value: new THREE.Color(0x5b9cf2) },
      horizon: { value: new THREE.Color(SKY_HORIZON) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 horizon;
      varying vec3 vDir;
      void main(){
        // hard bands instead of a smooth gradient
        float h = floor(clamp(vDir.y, 0.0, 1.0) * 7.0) / 7.0;
        vec3 c = mix(horizon, mid, smoothstep(0.0, 0.4, h));
        c = mix(c, top, smoothstep(0.35, 0.95, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), mat);
  dome.renderOrder = -10;
  return dome;
}

function makeSun(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      if (d < 7.5) g.fillStyle = '#fffbd0';
      else if (d < 10) g.fillStyle = '#ffe566';
      else if (d < 14) g.fillStyle = 'rgba(255,240,150,0.35)';
      else continue;
      g.fillRect(x, y, 1, 1);
    }
  }
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: pixelTexture(c), transparent: true, fog: false, depthWrite: false }),
  );
  sun.scale.set(260, 260, 1);
  sun.position.set(-300, 250, -520);
  return sun;
}

function makeClouds(): THREE.Sprite[] {
  const rnd = seeded(5);
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 16;
  const g = c.getContext('2d')!;
  // stacked rectangles: the classic blocky cloud
  g.fillStyle = '#ffffff';
  g.fillRect(4, 8, 40, 5);
  g.fillRect(9, 5, 14, 5);
  g.fillRect(24, 3, 14, 7);
  g.fillStyle = '#d2e2f4';
  g.fillRect(4, 12, 40, 2);
  const tex = pixelTexture(c);
  const clouds: THREE.Sprite[] = [];
  for (let i = 0; i < 10; i++) {
    const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    const angle = (i / 10) * Math.PI * 2 + rnd() * 0.4;
    const radius = 560 + rnd() * 160;
    cloud.position.set(Math.cos(angle) * radius, 120 + rnd() * 170, Math.sin(angle) * radius);
    const w = 260 + rnd() * 200;
    cloud.scale.set(w, w / 3, 1);
    clouds.push(cloud);
  }
  return clouds;
}

function makeWaterTexture(): THREE.CanvasTexture {
  const rnd = seeded(21);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1f7ce0';
  g.fillRect(0, 0, 64, 64);
  const colors = ['#4aa3f5', '#6cbcff', '#1966c4'];
  for (let i = 0; i < 90; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const x = Math.floor(rnd() * 64);
    const y = Math.floor(rnd() * 64);
    const len = 2 + Math.floor(rnd() * 6);
    g.fillRect(x, y, len, 1);
    if (x + len > 64) g.fillRect(0, y, x + len - 64, 1); // wrap so it tiles
  }
  return pixelTexture(c, 120);
}

const flat = (color: number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

function makePalm(rnd: () => number): THREE.Group {
  const palm = new THREE.Group();
  const trunkMat = flat(0x8a6a45);
  const leafMat = flat(0x3fa04a, { side: THREE.DoubleSide });
  const height = 4 + rnd() * 1.6;
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.3, height, 0.3), trunkMat);
  trunk.position.y = height / 2;
  palm.add(trunk);
  const crown = new THREE.Group();
  crown.position.y = height;
  for (let i = 0; i < 6; i++) {
    const geo = new THREE.ConeGeometry(0.34, 3.0, 3);
    geo.translate(0, 1.5, 0); // base at the origin, pointing +y
    const leaf = new THREE.Mesh(geo, leafMat);
    leaf.rotation.z = -(Math.PI / 2 + 0.15 + rnd() * 0.45); // fan outward with a gentle droop
    leaf.scale.set(1, 1, 0.35);
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 6) * Math.PI * 2 + rnd() * 0.3;
    pivot.add(leaf);
    crown.add(pivot);
  }
  palm.add(crown);
  palm.rotation.z = (rnd() - 0.5) * 0.18; // slight lean
  palm.rotation.y = rnd() * Math.PI * 2;
  return palm;
}

// ---------- the character ----------
// One blocky model, used for every other player AND for your own body, so what you see when you
// look down is the same character everyone else sees walking around.
interface Character {
  group: THREE.Group;
  head: THREE.Group; // hidden in first person so it can't block the view
  shirt: THREE.MeshLambertMaterial;
  setHue(h: number): void;
}

function makeCharacter(hue: number): Character {
  const shirtColor = new THREE.Color().setHSL(hue / 360, 0.7, 0.52);
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor, emissive: shirtColor, emissiveIntensity: 0, flatShading: true });
  const skin = flat(0xf0c49a);
  const pants = flat(0x2c3e73);
  const hair = flat(0x3a2a1c);
  const visorMat = flat(0x151824);

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const group = new THREE.Group();
  group.add(
    box(0.2, 0.78, 0.22, -0.11, 0.39, 0, pants), // legs
    box(0.2, 0.78, 0.22, 0.11, 0.39, 0, pants),
    box(0.5, 0.64, 0.28, 0, 1.1, 0, shirt), // torso
    box(0.16, 0.46, 0.2, -0.34, 1.19, 0, shirt), // arms
    box(0.16, 0.46, 0.2, 0.34, 1.19, 0, shirt),
    box(0.15, 0.16, 0.18, -0.34, 0.88, 0, skin), // hands
    box(0.15, 0.16, 0.18, 0.34, 0.88, 0, skin),
  );
  const head = new THREE.Group();
  head.add(
    box(0.4, 0.4, 0.4, 0, 1.62, 0, skin),
    box(0.42, 0.12, 0.42, 0, 1.84, 0, hair),
    box(0.36, 0.1, 0.03, 0, 1.66, -0.21, visorMat), // faces -Z, the direction you walk
  );
  group.add(head);

  return {
    group,
    head,
    shirt,
    setHue(h: number) {
      shirt.color.setHSL(h / 360, 0.7, 0.52);
      shirt.emissive.copy(shirt.color);
    },
  };
}

const CROUCH_SCALE = 0.7;
const NAME_HEIGHT = 2.15;

class Avatar {
  readonly group = new THREE.Group();
  readonly hit: THREE.Mesh; // what the crosshair ray tests against (invisible)
  private shell = new THREE.Group(); // the character; squashed when crouching
  private label: THREE.Sprite;
  private body: THREE.MeshLambertMaterial;
  private tx: number;
  private tz: number;
  private ty: number;
  private try_: number;
  private crouch: boolean;

  constructor(p: PlayerState) {
    const ch = makeCharacter(hueFor(p.id));
    this.body = ch.shirt;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.6), new THREE.MeshBasicMaterial());
    hit.visible = false;
    hit.position.y = 0.95;
    hit.userData.id = p.id;
    this.hit = hit;
    this.shell.add(ch.group, hit);
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
  // 0 = first person, 1 = third person behind you, 2 = third person in front of you (T cycles, like Minecraft F5)
  viewMode: 0 | 1 | 2 = 0;
  crouching = false;
  inputEnabled = true;
  lookSensitivity = 1; // multiplier on mouse look; 1 = the original feel
  onFrame?: (dt: number) => void;
  onSentHome?: () => void; // fired when you drift past the swim limit and are returned to the centre

  private keys = new Set<string>();
  private last = performance.now();
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private eye = EYE_HEIGHT; // current eye height, eased toward standing/crouching
  private orbitAngle = Math.random() * Math.PI * 2;
  private tpBlend = 0; // 0 = camera at the head, 1 = fully pulled back
  private frontBlend = 0; // 0 = camera behind you, 1 = camera in front, facing you
  private selfThird = new THREE.Group(); // our full character, shown while the camera is pulled back
  private selfBody = new THREE.Group(); // the same character, minus head, seen when looking down
  private selfChars: Character[] = [];
  private ray = new THREE.Raycaster();
  private centre = new THREE.Vector2(0, 0);
  private waterTex?: THREE.CanvasTexture;

  // low-resolution render target + the pass that scales, dithers and quantises it to the screen
  private rt = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private postMat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tDiffuse: { value: this.rt.texture }, size: { value: new THREE.Vector2(2, 2) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 size; varying vec2 vUv;
      float bayer2(vec2 p) { return mod(p.x * 2.0 + p.y * 3.0, 4.0); }
      float bayer4(vec2 p) {
        vec2 q = floor(p);
        return (bayer2(mod(q, 2.0)) * 4.0 + bayer2(mod(floor(q / 2.0), 2.0))) / 16.0;
      }
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = pow(max(c, 0.0), vec3(1.0 / 2.2));                 // linear -> display
        float levels = ${COLOR_LEVELS}.0;
        float d = (bayer4(vUv * size) - 0.5) / levels;          // ordered dither at the low-res pixel grid
        c = floor((c + d) * levels + 0.5) / levels;             // 16 shades per channel
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);

    // Short, bright fog in the horizon colour: the sea melts into the sky.
    const horizon = new THREE.Color(SKY_HORIZON);
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 45, 230);
    this.camera.rotation.order = 'YXZ';

    this.scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x7a96b8, 1.25));
    const sunlight = new THREE.DirectionalLight(0xfff4d6, 1.5);
    sunlight.position.set(-34, 70, -46); // from the sun's side of the sky
    this.scene.add(sunlight);

    this.scene.add(makeSkyDome(), makeSun(), ...makeClouds());
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

  private sendHome() {
    this.teleport(0, 0);
    this.onSentHome?.();
  }

  cycleView() {
    this.viewMode = ((this.viewMode + 1) % 3) as 0 | 1 | 2;
  }

  setFov(deg: number) {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  /** Colour our own body like the character other players see us as. */
  setSelfId(id: string) {
    for (const c of this.selfChars) c.setHue(hueFor(id));
  }

  /** Id of the player under the crosshair within `maxDist` metres, if any. Call after render. */
  playerUnderCrosshair(maxDist: number): string | null {
    this.ray.setFromCamera(this.centre, this.camera);
    this.ray.far = maxDist;
    const hits = this.ray.intersectObjects([...this.avatars.values()].map((a) => a.hit), false);
    return hits.length ? (hits[0].object.userData.id as string) : null;
  }

  /** A tiled arena on a sandy island in a bright sea, with palms, rocks and a ring of buoys. */
  private buildIsland() {
    const R = MAP_RADIUS;
    const rnd = seeded(1337);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R, 24),
      new THREE.MeshLambertMaterial({ map: makeCheckerTexture() }),
    );
    floor.rotation.x = -Math.PI / 2;

    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.5, R, 24), new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.01;

    const beach = new THREE.Mesh(new THREE.RingGeometry(R, R + 7, 24), flat(0xe6cf8a));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = -0.02;

    const foam = new THREE.Mesh(
      new THREE.RingGeometry(R + 6.6, R + 8.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = -0.3;

    this.waterTex = makeWaterTexture();
    const sea = new THREE.Mesh(new THREE.CircleGeometry(1000, 16), new THREE.MeshBasicMaterial({ map: this.waterTex }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.35;

    this.scene.add(floor, rim, beach, foam, sea);

    // A ring of buoys marks how far out you can swim.
    const buoyMat = flat(0xff6a2a);
    const buoyTop = flat(0xffffff);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const buoy = new THREE.Group();
      buoy.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 4), buoyMat));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.47, 6, 3, 0, Math.PI * 2, 0, 0.8), buoyTop);
      buoy.add(cap);
      buoy.position.set(Math.cos(a) * (SWIM_LIMIT - 0.5), -0.25, Math.sin(a) * (SWIM_LIMIT - 0.5));
      this.scene.add(buoy);
    }

    // Palms along the beach. Decoration only: they sit outside the tiled arena.
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
      const r = R + 1.8 + rnd() * 3.4;
      const palm = makePalm(rnd);
      palm.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      this.scene.add(palm);
    }

    // Rocks on the beach and out in the shallows.
    const rockMat = flat(0x8a93a6);
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

  /**
   * Your own body: the same character other players see. In first person the head is hidden (and
   * the model sits a little behind the camera) so you only see arms, torso and legs when you look
   * down; once the camera pulls back the full character takes over.
   */
  private buildSelfBody() {
    const fp = makeCharacter(210);
    fp.head.visible = false;
    fp.group.position.z = 0.2; // z > 0 is behind the camera: clear of the near plane, yet the chest and legs show when you look down
    this.selfBody.add(fp.group);
    this.scene.add(this.selfBody);

    const tp = makeCharacter(210);
    this.selfThird.add(tp.group);
    this.scene.add(this.selfThird);

    this.selfChars = [fp, tp];
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
    // The scene is rendered at a fixed small height; the width follows the window shape.
    const rw = Math.max(2, Math.round((RT_HEIGHT * w) / Math.max(1, h)));
    this.rt.setSize(rw, RT_HEIGHT);
    this.postMat.uniforms.size.value.set(rw, RT_HEIGHT);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private renderRetro() {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }

  /** Smoothed walking, sprint (Ctrl), crouch (Shift) and jump (Space) with gravity. */
  private move(dt: number) {
    const k = this.keys;
    const on = this.inputEnabled;
    let f = on ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    let s = on ? (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) : 0;

    this.crouching = on && (k.has('ShiftLeft') || k.has('ShiftRight'));
    const sprinting = on && !this.crouching && (k.has('ControlLeft') || k.has('ControlRight'));
    // In the sea you sink to about chest height and wade more slowly.
    const depth = waterDepth(this.pos.x, this.pos.z);
    const ground = -WADE_DEPTH * depth;
    const speed = (this.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED) * (1 - 0.45 * depth);

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
    const grounded = this.feetY <= ground + 1e-3 && this.vy <= 0;
    const rate = grounded ? (wantsMove ? GROUND_ACCEL : GROUND_DECEL) : AIR_ACCEL;
    const a = 1 - Math.exp(-rate * dt);
    this.vx += (tx - this.vx) * a;
    this.vz += (tz - this.vz) * a;

    if (on && grounded && k.has('Space')) this.vy = JUMP_SPEED * (1 - 0.35 * depth);
    this.vy -= GRAVITY * dt;
    this.feetY += this.vy * dt;
    if (this.feetY <= ground) {
      this.feetY = ground; // follows the sea floor smoothly as you wade in
      this.vy = 0;
    }

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    // A ring of buoys marks the limit; past it you are returned to the island.
    if (Math.hypot(this.pos.x, this.pos.z) > SWIM_LIMIT - 1) this.sendHome();

    const wantEye = this.crouching ? EYE_CROUCH : EYE_HEIGHT;
    this.eye += (wantEye - this.eye) * (1 - Math.exp(-14 * dt));
  }

  /** Players are solid: slide around others and get nudged if someone walks into you. */
  private collide() {
    const p = pushOut(this.pos.x, this.pos.z, [...this.avatars.values()].map((a) => a.group.position), BODY_RADIUS * 2);
    const q = clampToArena(p.x, p.z, SWIM_LIMIT);
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
    this.safe('render', () => this.renderRetro());
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
      // step the scroll in whole texels so the water crawls in chunky pixel jumps
      const t = performance.now() / 1000;
      this.waterTex.offset.x = Math.floor(t * 3) / 64;
      this.waterTex.offset.y = Math.floor(t * 1.2) / 64;
    }
    for (const a of this.avatars.values()) a.update(dt);
    this.collide();
    this.pos.y = this.feetY + this.eye;
    const ease = 1 - Math.exp(-7 * dt);
    const wantBack = this.viewMode > 0 ? 1 : 0;
    const wantFront = this.viewMode === 2 ? 1 : 0;
    this.tpBlend += (wantBack - this.tpBlend) * ease;
    this.frontBlend += (wantFront - this.frontBlend) * ease;
    if (Math.abs(this.tpBlend - wantBack) < 0.001) this.tpBlend = wantBack;
    if (Math.abs(this.frontBlend - wantFront) < 0.001) this.frontBlend = wantFront;
    if (this.orbit) {
      this.orbitAngle += dt * 0.06;
      const r = MAP_RADIUS * 0.7;
      this.camera.position.set(Math.cos(this.orbitAngle) * r, 6, Math.sin(this.orbitAngle) * r);
      this.camera.lookAt(0, 5, 0); // slightly down, so the horizon, sun and clouds frame the menu
    } else {
      // Smoothstep so moves start and end gently. The camera orbits the head: pulling back is a
      // change of distance, and going to the front view swings it 180 degrees around you (yaw + PI)
      // with the pitch mirrored, so it always looks at you. The head itself never moves.
      const t = this.tpBlend * this.tpBlend * (3 - 2 * this.tpBlend);
      const f = this.frontBlend * this.frontBlend * (3 - 2 * this.frontBlend);
      const camYaw = this.yaw + Math.PI * f;
      const camPitch = this.pitch * (1 - 2 * f);
      const cp = Math.cos(camPitch);
      const back = THIRD_DISTANCE * t;
      this.camera.position.set(
        this.pos.x + Math.sin(camYaw) * cp * back,
        Math.max(0.35, this.pos.y - Math.sin(camPitch) * back + THIRD_LIFT * t),
        this.pos.z + Math.cos(camYaw) * cp * back,
      );
      this.camera.rotation.set(camPitch, camYaw, 0);
    }
    // The headless first-person body only while the camera is at the head; the full character
    // (identical model, with its head) takes over as the camera pulls back.
    this.selfBody.visible = !this.orbit && this.tpBlend < 0.02;
    this.selfThird.visible = !this.orbit && this.tpBlend >= 0.02;
    const squash = 0.7 + 0.3 * Math.min(1, Math.max(0, (this.eye - EYE_CROUCH) / (EYE_HEIGHT - EYE_CROUCH)));
    this.selfThird.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfThird.rotation.y = this.yaw;
    this.selfThird.scale.y = squash;
    this.selfBody.position.set(this.pos.x, this.feetY, this.pos.z);
    this.selfBody.rotation.y = this.yaw;
    this.selfBody.scale.y = squash;
  }
}
