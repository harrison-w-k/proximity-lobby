// The 3D world of a match: terrain, water, lava, vegetation, the animals and the effects.
import * as THREE from 'three';
import { toonMat } from './toon';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Biome, MAP_RADIUS, Terrain, WATER_Y, CELL, type Res } from '../../../shared/arena/terrain';
import { FL } from '../../../shared/arena/proto';
import { STRIKE_TIME, poseFor, telegraphFor, type Cue, type Telegraph } from './anim';
import { makeMobRig, makePlayerRig, type Rig, type RigState } from './models';
import { makeDummyRig } from './dummy';

const SKY_TOP = 0x5f968a;
const SKY_HORIZON = 0xe6cf92;

export interface FighterView {
  id: string;
  name: string;
  animal: string;
  team: number;
  role: number;
  rig: Rig;
  group: THREE.Group;
  plate: THREE.Sprite;
  plateKey: string;
  dummy?: boolean;
  /** a dummy's damage per second over the current run of hits (a run ends after 3 s without one) */
  dps?: number;
  dpsRun?: { first: number; last: number; total: number };
  hpAbs: number;
  maxHp: number;
  ovh: number; // overhealth
  shadow: THREE.Mesh;
  x: number;
  z: number;
  tx: number;
  tz: number;
  yaw: number;
  tyaw: number;
  hp: number;
  level: number;
  flags: number;
  speed: number;
  seen: number;
  attack: number;
  hurt: number;
  self: boolean;
  swim: boolean;
  lastX: number;
  lastZ: number;
  speedS: number;
  speaking: boolean;
  cue: Cue | null;
  guard: boolean;
  guardStart: number;
  jy: number;
  vy: number;
  lastJy?: number;
  drop?: number; // seconds since the arrival began (negative = still waiting)
  dying?: number; // seconds left of the fall-over
  fallDir?: number;
  pop?: number; // 1 -> 0 while a newly evolved form springs into being
  evolveUntil?: number; // glowing while it evolves
  lastState?: RigState;
  shield: THREE.Mesh;
  stars?: THREE.Group;
}

interface MobView {
  id: number;
  def: number;
  rig: Rig;
  group: THREE.Group;
  shadow: THREE.Mesh | null;
  x: number;
  z: number;
  tx: number;
  tz: number;
  yaw: number;
  tyaw: number;
  seen: number;
  speedS: number;
  lastX: number;
  lastZ: number;
  attack: number;
  hurt: number;
  flags: number;
  flee: boolean;
  aquatic: boolean;
  flies: boolean;
  hp: number;
  bar?: THREE.Sprite;
  barHp: number;
  big: boolean;
  cue: Cue | null;
  warnUntil: number;
}

/** Geometries merge only if they are all indexed or all not. */
const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export class ArenaScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(68, 1, 0.3, 640);
  readonly terrain: Terrain;
  readonly ring = { value: MAP_RADIUS } as { value: number };
  private time = { value: 0 };
  private fog: THREE.Fog;
  private water!: THREE.Mesh;
  private waterTex!: THREE.CanvasTexture;
  private wallLava!: THREE.Mesh;
  private wallNext!: THREE.Mesh;
  private sun: THREE.DirectionalLight;
  private fighters = new Map<string, FighterView>();
  private mobs = new Map<number, MobView>();
  private mobIds: string[];
  private drops = new Map<number, { g: THREE.Group; kind: string; seen: number; y0: number }>();
  private hidden = new Map<number, { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[]>();
  private fxList: { update(dt: number): boolean }[] = [];
  private trailAt = new Map<string, number>();
  private dustAt = new Map<string, number>();
  private prevJy = new Map<string, number>();
  private prevYaw = new Map<string, number>();
  private decals: { g: THREE.Group; mats: THREE.MeshBasicMaterial[]; t: number; wind: number; hostile: boolean; heavy: boolean }[] = [];
  private floaters: { s: THREE.Sprite; vy: number; life: number; max: number; base: number }[] = [];
  private projs = new Map<number, { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }>();
  private lure: { g: THREE.Group; until: number } | null = null;
  private clock = 0;
  private selfId = '';
  private selfPos = new THREE.Vector3();
  nodeTimes = new Map<number, number>();
  private nodeMeshes = new Map<number, { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; zero: THREE.Matrix4 }>();
  private tmpM = new THREE.Matrix4();

  /** The lobby island has no lava and no outer wall. */
  readonly island: boolean;

  constructor(seed: number, mobIds: string[], island = false) {
    this.mobIds = mobIds;
    this.island = island;
    this.terrain = new Terrain(seed, island ? 'island' : 'wild');
    this.fog = new THREE.Fog(SKY_HORIZON, 90, 380);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(SKY_HORIZON);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xf4e6b4, 0x5c7a48, 1.25));
    this.sun = new THREE.DirectionalLight(0xffd98e, 1.8);
    this.sun.position.set(180, 260, 90);
    this.scene.add(this.sun);
    this.scene.add(this.makeSky());
    this.buildTerrain();
    this.buildWater();
    this.buildWalls();
    if (island) this.ring.value = 1e5; // far beyond the sea: no lava on the terrain
    this.buildVegetation();
  }

  // --- static world ----------------------------------------------------------------------------

  private makeSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(600, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(SKY_TOP) }, hor: { value: new THREE.Color(SKY_HORIZON) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(h, 0.55)), 1.0); }',
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -10;
    m.frustumCulled = false;
    (m as unknown as { isSky: boolean }).isSky = true;
    return m;
  }

  private terrainColor(x: number, z: number, h: number, bio: number, slope: number): THREE.Color {
    const c = new THREE.Color();
    const n = noise(x * 0.31, z * 0.27) * 0.12 - 0.06;
    if (h < WATER_Y - 0.1) c.setHex(h < -1.5 ? 0x2f4a47 : 0x7f8a5a);
    else if (h < WATER_Y + 0.5) c.setHex(0xcdb472);
    else {
      switch (bio) {
        case Biome.Forest:
          c.setHex(0x56743a);
          break;
        case Biome.Wetlands:
          c.setHex(0x4f8d6c);
          break;
        case Biome.Grassland:
          c.setHex(0xb3a64e);
          break;
        default:
          c.setHex(0xb89a60);
          if (h > 24) c.setHex(0xe9dcb8);
          else if (h > 15) c.lerp(new THREE.Color(0xc9b58a), (h - 15) / 9);
      }
      if (slope > 0.75) c.lerp(new THREE.Color(0xa59f92), Math.min(1, (slope - 0.75) * 2.5));
    }
    c.multiplyScalar(1 + n);
    return c;
  }

  private buildTerrain() {
    const t = this.terrain;
    const N = t.gridSize;
    const pos = new Float32Array(N * N * 3);
    const col = new Float32Array(N * N * 3);
    const hg = t.heightGrid();
    const bg = t.biomeGrid();
    for (let gz = 0; gz < N; gz++) {
      for (let gx = 0; gx < N; gx++) {
        const i = gz * N + gx;
        const x = gx * CELL - MAP_RADIUS;
        const z = gz * CELL - MAP_RADIUS;
        const h = hg[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        const hx = hg[gz * N + Math.min(N - 1, gx + 1)] - hg[gz * N + Math.max(0, gx - 1)];
        const hz = hg[Math.min(N - 1, gz + 1) * N + gx] - hg[Math.max(0, gz - 1) * N + gx];
        const slope = Math.hypot(hx, hz) / (2 * CELL);
        const c = this.terrainColor(x, z, h, bg[i], slope);
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6);
    let k = 0;
    for (let gz = 0; gz < N - 1; gz++) {
      for (let gx = 0; gx < N - 1; gx++) {
        const a = gz * N + gx;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        idx[k++] = a;
        idx[k++] = c;
        idx[k++] = b;
        idx[k++] = b;
        idx[k++] = c;
        idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mat = toonMat({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRing = this.ring;
      sh.uniforms.uTime = this.time;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uRing;\nvarying vec3 vW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat rr = length(position.xz);\ntransformed.y = mix(transformed.y, -1.4, smoothstep(uRing, uRing + 7.0, rr));\nvW = vec3(position.x, transformed.y, position.z);');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uRing; uniform float uTime; varying vec3 vW;
float th21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float tvn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(th21(i), th21(i+vec2(1,0)), f.x), mix(th21(i+vec2(0,1)), th21(i+vec2(1,1)), f.x), f.y); }
float tfb(vec2 p){ return tvn(p)*0.55 + tvn(p*2.1+7.3)*0.3 + tvn(p*4.3+3.1)*0.15; }
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float tg = tfb(vW.xz * 0.5) * 0.9 + tfb(vW.xz * 2.2) * 0.5 + tvn(vec2(vW.x * 7.0, vW.z * 1.2)) * 0.3;
float tmot = tfb(vW.xz * 0.12);
float sandy = step(vW.y, 1.1);
float rip = sin(vW.x * 3.1 + tfb(vW.xz * 0.5) * 6.0) * 0.5 + 0.5;
diffuseColor.rgb *= mix(0.55 + tg * 0.5, 0.8 + rip * 0.3, sandy) * (0.8 + tmot * 0.4);
float rr2 = length(vW.xz);
float lava = smoothstep(uRing - 0.2, uRing + 2.5, rr2);
float n1 = vn(vW.xz * 0.35 + vec2(uTime * 0.25, uTime * 0.18));
float n2 = vn(vW.xz * 0.9 - vec2(uTime * 0.2, 0.0));
vec3 lavaCol = mix(vec3(0.55, 0.06, 0.02), vec3(1.0, 0.72, 0.12), smoothstep(0.35, 0.8, n1 * 0.6 + n2 * 0.5));
float scorch = smoothstep(uRing - 9.0, uRing, rr2) * (1.0 - lava);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.38, 0.3), scorch * 0.8);
diffuseColor.rgb = mix(diffuseColor.rgb, lavaCol, lava);`,
        )
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lavaCol * lava * 0.95 + vec3(0.9, 0.25, 0.0) * scorch * 0.12;');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  private buildWater() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#2f7fa3';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.12})`;
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      g.fillRect(x, y, 6 + Math.random() * 14, 1 + Math.random() * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(70, 70);
    tex.magFilter = THREE.NearestFilter;
    this.waterTex = tex;
    const geo = new THREE.CircleGeometry(MAP_RADIUS + 20, 48);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ map: tex, color: 0x8fcfae, transparent: true, opacity: 0.78, shininess: 80, specular: 0xbfe6ff, depthWrite: false }));
    this.water.position.y = WATER_Y - 0.05;
    this.water.renderOrder = 1;
    this.scene.add(this.water);
  }

  private wallMat(color: number, alpha: number) {
    return new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { col: { value: new THREE.Color(color) }, alpha: { value: alpha }, time: this.time },
      vertexShader: 'varying float vY; varying vec2 vU; void main(){ vY = uv.y; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 col; uniform float alpha; uniform float time; varying float vY; varying vec2 vU; void main(){ float s = 0.75 + 0.25 * sin(vU.x * 140.0 + time * 2.0); gl_FragColor = vec4(col, alpha * pow(1.0 - vY, 1.6) * s); }',
    });
  }

  private buildWalls() {
    const geo = new THREE.CylinderGeometry(1, 1, 70, 96, 1, true);
    geo.translate(0, 30, 0);
    this.wallLava = new THREE.Mesh(geo, this.wallMat(0xff5a14, 0.55));
    this.wallLava.frustumCulled = false;
    this.wallNext = new THREE.Mesh(geo, this.wallMat(0xffffff, 0.45));
    this.wallNext.frustumCulled = false;
    this.wallNext.visible = false;
    this.scene.add(this.wallLava, this.wallNext);
    this.setRing(MAP_RADIUS - 6, 0, false);
  }

  setRing(r: number, next: number, warn: boolean) {
    if (this.island) {
      this.wallLava.visible = false;
      this.wallNext.visible = false;
      return;
    }
    this.ring.value = r;
    this.wallLava.scale.set(r, 1, r);
    this.wallNext.visible = warn && next > 0;
    this.wallNext.scale.set(next, 1, next);
  }

  private chunkKey(x: number, z: number) {
    return `${Math.floor((x + MAP_RADIUS) / 90)},${Math.floor((z + MAP_RADIUS) / 90)}`;
  }

  private seeA = { value: new THREE.Vector3() };
  private seeB = { value: new THREE.Vector3() };

  private ringMaterial(m: THREE.Material, kind = '') {
    const rock = kind === 'rock' || kind === 'stone' ? 'true' : 'false';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRing = this.ring;
      sh.uniforms.uA = this.seeA;
      sh.uniforms.uB = this.seeB;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uRing;
varying vec3 vWP;
varying vec3 vLoc;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
if (length(instanceMatrix[3].xz) > uRing - 1.0) transformed *= 0.0;
vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
#endif
vWP = wp4.xyz;
vLoc = position;`,
        );
      // leaves, trunks and rocks between the camera and your animal melt away
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 lp = vLoc;
  vec3 dc = diffuseColor.rgb;
  bool bark = dc.r > dc.g * 1.1 && dc.g > dc.b * 1.1;
  float ang = atan(lp.z, lp.x);
  float t;
  if (${rock}) {
    t = 0.5 + tfb(vec2(lp.y * 4.0 + lp.x * 1.3, lp.z * 1.7)) * 0.8 + tvn(lp.xy * 12.0 + lp.z * 7.0) * 0.3;
    float crack = smoothstep(0.02, 0.0, abs(tvn(lp.xz * 3.5 + lp.y * 2.0) - 0.5) - 0.01);
    t *= 1.0 - crack * 0.5;
  } else if (bark) {
    t = 0.4 + tvn(vec2(ang * 4.0, lp.y * 0.7)) * 0.8 + tvn(vec2(ang * 11.0, lp.y * 2.0)) * 0.35;
  } else {
    t = 0.5 + tfb(lp.xy * 3.0 + lp.z * 2.5) * 0.9 + tvn(lp.zy * 9.0 + lp.x * 6.0) * 0.3;
  }
  diffuseColor.rgb = dc * t;
}`)
        .replace('#include <common>', `#include <common>
float th21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float tvn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(th21(i), th21(i+vec2(1,0)), f.x), mix(th21(i+vec2(0,1)), th21(i+vec2(1,1)), f.x), f.y); }
float tfb(vec2 p){ return tvn(p)*0.55 + tvn(p*2.1+7.3)*0.3 + tvn(p*4.3+3.1)*0.15; }
varying vec3 vLoc;
uniform vec3 uA;
uniform vec3 uB;
varying vec3 vWP;`)
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
{
  vec3 ab = uB - uA;
  float tt = clamp(dot(vWP - uA, ab) / max(dot(ab, ab), 0.001), 0.0, 1.0);
  float dd = length(vWP - (uA + ab * tt));
  if ((tt < 0.96 && dd < 1.9) || length(vViewPosition) < 3.0) discard;
}`,
        );
    };
    return m;
  }

  private buildVegetation() {
    const t = this.terrain;
    const rnd = (a: number) => noise(a * 1.7, a * 0.37);
    const treeGeo = (crown: number, trunk: number, kind: 'round' | 'pine' | 'fruit' | 'hive') => {
      const parts: THREE.BufferGeometry[] = [];
      const add = (g: THREE.BufferGeometry, c: number, m?: THREE.Matrix4) => {
        const gg = g.clone();
        if (m) gg.applyMatrix4(m);
        const n = gg.attributes.position.count;
        const col = new Float32Array(n * 3);
        const cc = new THREE.Color(c);
        for (let i = 0; i < n; i++) {
          col[i * 3] = cc.r;
          col[i * 3 + 1] = cc.g;
          col[i * 3 + 2] = cc.b;
        }
        gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
        gg.deleteAttribute('uv');
        parts.push(gg);
      };
      const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
      add(new THREE.CylinderGeometry(0.28, 0.4, 3.2, 5), trunk, T(0, 1.6, 0));
      if (kind === 'pine') {
        for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(2.1 - i * 0.45, 2.4, 6), crown, T(0, 2.6 + i * 1.5, 0));
      } else {
        add(new THREE.IcosahedronGeometry(2.2, 1), crown, T(0, 4.6, 0, 1, 0.85, 1));
        add(new THREE.IcosahedronGeometry(1.5, 1), crown, T(1.3, 3.8, 0.5));
        add(new THREE.IcosahedronGeometry(1.4, 1), crown, T(-1.1, 4.0, -0.6));
      }
      if (kind === 'fruit') for (let i = 0; i < 9; i++) add(new THREE.IcosahedronGeometry(0.2, 0), 0xe8531d, T(Math.cos(i * 2.4) * 2.0, 3.8 + (i % 3) * 0.6, Math.sin(i * 2.4) * 2.0));
      if (kind === 'hive') add(new THREE.CylinderGeometry(0.2, 0.5, 1.1, 6), 0xd9a441, T(0.9, 2.9, 0));
      return mergeGeometries(parts.map(flat), false)!;
    };
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.scale(1, 0.75, 1);
    const bushGeo = (() => {
      const a = new THREE.IcosahedronGeometry(0.9, 1);
      a.scale(1.3, 0.8, 1.3);
      a.translate(0, 0.5, 0);
      return a;
    })();
    const berriesGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const g = new THREE.IcosahedronGeometry(0.11, 0);
        g.translate(Math.cos(i * 2.1) * 0.85, 0.7 + (i % 3) * 0.18, Math.sin(i * 2.1) * 0.85);
        parts.push(g);
      }
      return mergeGeometries(parts.map(flat), false)!;
    })();
    const herbGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const g = new THREE.ConeGeometry(0.05, 0.6, 4);
        g.translate(Math.cos(i * 1.7) * 0.2, 0.3, Math.sin(i * 1.7) * 0.2);
        parts.push(g);
      }
      for (let i = 0; i < 3; i++) {
        const g = new THREE.IcosahedronGeometry(0.1, 0);
        g.translate(Math.cos(i * 2.9) * 0.22, 0.65, Math.sin(i * 2.9) * 0.22);
        parts.push(g);
      }
      return mergeGeometries(parts.map(flat), false)!;
    })();
    const reedGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 9; i++) {
        const g = new THREE.CylinderGeometry(0.03, 0.04, 1.4 + (i % 3) * 0.3, 4);
        g.translate(Math.cos(i * 2.3) * 0.3, 0.7, Math.sin(i * 2.3) * 0.3);
        parts.push(g);
      }
      return mergeGeometries(parts.map(flat), false)!;
    })();
    const mudGeo = new THREE.CylinderGeometry(1.2, 1.4, 0.12, 8);
    const tuftGeo = (() => {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) {
        const g = new THREE.ConeGeometry(0.06, 0.8, 3);
        g.translate(Math.cos(i * 1.3) * 0.2, 0.4, Math.sin(i * 1.3) * 0.2);
        parts.push(g);
      }
      return mergeGeometries(parts.map(flat), false)!;
    })();

    const kinds: Record<string, { geo: THREE.BufferGeometry; mat: THREE.Material; node?: boolean; jitter?: boolean }> = {
      tree: { geo: treeGeo(0xd0903a, 0x5e4430, 'round'), mat: toonMat({ vertexColors: true, flatShading: true }) },
      pine: { geo: treeGeo(0x2d6b5c, 0x5b3f29, 'pine'), mat: toonMat({ vertexColors: true, flatShading: true }) },
      fruit: { geo: treeGeo(0x6dba4c, 0x7a5238, 'fruit'), mat: toonMat({ vertexColors: true, flatShading: true }), node: true },
      hive: { geo: treeGeo(0x6fae4a, 0x7a5238, 'hive'), mat: toonMat({ vertexColors: true, flatShading: true }), node: true },
      bush: { geo: bushGeo, mat: toonMat({ color: 0x6c8c3a, flatShading: true }) },
      berryBush: { geo: bushGeo, mat: toonMat({ color: 0x4a7c42, flatShading: true }) },
      berry: { geo: berriesGeo, mat: toonMat({ color: 0xd42a3c, flatShading: true, emissive: 0x330508 }), node: true },
      rock: { geo: rockGeo, mat: toonMat({ color: 0xc2b28c, flatShading: true }), jitter: true },
      stone: { geo: rockGeo, mat: toonMat({ color: 0xd2c6a2, flatShading: true }), jitter: true },
      herb: { geo: herbGeo, mat: toonMat({ color: 0x7ec06a, flatShading: true, emissive: 0x0a1a0a }), node: true },
      reed: { geo: reedGeo, mat: toonMat({ color: 0x9aa655, flatShading: true }), node: true },
      mud: { geo: mudGeo, mat: toonMat({ color: 0x5a4330, flatShading: true }), node: true },
      tuft: { geo: tuftGeo, mat: toonMat({ color: 0xb0a64a, flatShading: true }) },
    };
    for (const [name, k] of Object.entries(kinds)) {
      this.ringMaterial(k.mat, name);
      k.geo.computeBoundingSphere();
    }

    type Item = { kind: string; r: Res | null; x: number; z: number; s: number; id: number };
    const buckets = new Map<string, Item[]>();
    const push = (kind: string, it: Item) => {
      const key = `${kind}|${this.chunkKey(it.x, it.z)}`;
      const b = buckets.get(key);
      if (b) b.push(it);
      else buckets.set(key, [it]);
    };
    for (const r of t.res) {
      const h = t.heightAt(r.x, r.z);
      void h;
      switch (r.kind) {
        case 'berry':
          push('berryBush', { kind: 'berryBush', r, x: r.x, z: r.z, s: 1, id: r.id });
          push('berry', { kind: 'berry', r, x: r.x, z: r.z, s: 1, id: r.id });
          break;
        default:
          push(r.kind, { kind: r.kind, r, x: r.x, z: r.z, s: r.s, id: r.id });
      }
    }
    // tufts of long grass
    for (let i = 0; i < 9000; i++) {
      const a = noise(i * 0.713, 3.1) * Math.PI * 2;
      const rr = Math.sqrt(noise(i * 0.377, 9.7)) * (MAP_RADIUS - 20);
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (t.tallGrass(x, z) && t.heightAt(x, z) > WATER_Y + 0.3) push('tuft', { kind: 'tuft', r: null, x, z, s: 0.8 + noise(i, 5.5) * 0.8, id: -1 });
    }

    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const col = new THREE.Color();
    for (const [key, items] of buckets) {
      const kind = key.split('|')[0];
      const def = kinds[kind];
      const mesh = new THREE.InstancedMesh(def.geo, def.mat, items.length);
      items.forEach((it, i) => {
        const y = t.heightAt(it.x, it.z);
        e.set(0, noise(it.x, it.z) * Math.PI * 2, 0);
        if (def.jitter) e.set((noise(it.z, it.x) - 0.5) * 0.5, e.y, (noise(it.x + 3, it.z) - 0.5) * 0.5);
        q.setFromEuler(e);
        const s = it.s;
        if (kind === 'rock' || kind === 'stone') sc.set(s * (0.9 + noise(it.x, 4) * 0.5), s * (0.8 + noise(it.z, 4) * 0.7) * (kind === 'stone' ? 0.75 : 1), s * (0.9 + noise(it.x, 8) * 0.5));
        else if (kind === 'tree' || kind === 'pine' || kind === 'fruit' || kind === 'hive') sc.setScalar(s * 0.62); // trees stay in proportion to the animals
        else sc.setScalar(s);
        const yy = kind === 'reed' || kind === 'mud' ? Math.max(y, WATER_Y - 0.3) : y - 0.1;
        p.set(it.x, yy, it.z);
        const m = new THREE.Matrix4().compose(p, q, sc);
        mesh.setMatrixAt(i, m);
        if (kind === 'tree' || kind === 'pine' || kind === 'bush' || kind === 'tuft' || kind === 'rock' || kind === 'stone' || kind === 'fruit') {
          const v = 0.82 + noise(it.x * 2, it.z * 2) * 0.35;
          col.setRGB(v, v * (0.95 + noise(it.z, 1) * 0.1), v);
          mesh.setColorAt(i, col);
        }
        if (def.node && it.id >= 0) {
          const zero = new THREE.Matrix4().compose(p, q, new THREE.Vector3(0, 0, 0));
          const nm = this.nodeMeshes.get(it.id * 10 + (kind === 'berry' ? 1 : 0));
          void nm;
          this.nodeMeshes.set(it.id * 10 + (kind === 'berry' ? 1 : 0), { mesh, index: i, matrix: m, zero });
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      this.scene.add(mesh);
    }
    void rnd;
  }

  /** A harvest node was used (or came back). */
  setNode(id: number, until: number, now: number) {
    if (until <= now) return;
    this.nodeTimes.set(id, until);
    for (const key of [id * 10, id * 10 + 1]) {
      const n = this.nodeMeshes.get(key);
      // fruit and hive trees keep their trunk; only the small pickups disappear
      if (!n || n.mesh.geometry.attributes.color !== undefined) continue;
      n.mesh.setMatrixAt(n.index, n.zero);
      n.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  refreshNodes(matchTime: number) {
    for (const [id, until] of this.nodeTimes) {
      if (until <= matchTime) {
        this.nodeTimes.delete(id);
        for (const key of [id * 10, id * 10 + 1]) {
          const n = this.nodeMeshes.get(key);
          if (!n) continue;
          n.mesh.setMatrixAt(n.index, n.matrix);
          n.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  // --- fighters and mobs ---------------------------------------------------------------------------

  private makeShadow(r: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 2;
    return m;
  }

  private plateCanvas = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    return c;
  })();

  private drawPlate(v: FighterView, mine: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 96;
    const g = c.getContext('2d')!;
    const friend = v.team === mine;
    const hunted = (v.flags & FL.hunted) !== 0;
    const round = (x: number, y: number, w: number, h: number, r: number) => {
      g.beginPath();
      g.roundRect(x, y, w, h, r);
    };
    // the name, with a soft dark edge
    g.font = '700 26px "Baloo 2", "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(8,24,28,.9)';
    const title = v.dummy && v.dps ? `${v.name}  ·  ${v.dps} DPS` : v.name;
    g.strokeText(title, 160, 20);
    g.fillStyle = hunted ? '#ffd23f' : v.dummy ? '#ffd9a0' : friend ? '#a6f594' : '#ffffff';
    g.fillText(title, 160, 20);
    // the health bar: rounded, with the overhealth as a gold layer along its top edge
    const bx = 64;
    const by = 44;
    const bw = 244;
    const bh = 24;
    const frac = Math.max(0, Math.min(1, v.hpAbs > 0 || v.maxHp > 1 ? v.hpAbs / Math.max(1, v.maxHp) : v.hp / 100));
    g.fillStyle = 'rgba(8,24,28,.92)';
    round(bx - 3, by - 3, bw + 6, bh + 6, 11);
    g.fill();
    g.save();
    round(bx, by, bw, bh, 8);
    g.clip();
    g.fillStyle = '#1b3a3f';
    g.fillRect(bx, by, bw, bh);
    const col = v.dummy ? ['#ffb347', '#e0842a'] : friend ? ['#7be05a', '#3c9a2c'] : frac < 0.3 ? ['#ff6a5a', '#c42a1c'] : ['#f05a4a', '#b8281b'];
    const grad = g.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, col[0]);
    grad.addColorStop(1, col[1]);
    g.fillStyle = grad;
    g.fillRect(bx, by, bw * frac, bh);
    g.fillStyle = 'rgba(255,255,255,.22)'; // a glossy highlight
    g.fillRect(bx, by, bw * frac, bh * 0.38);
    if (v.ovh > 0) {
      const sf = Math.min(1, v.ovh / Math.max(1, v.maxHp));
      g.fillStyle = '#ffd23f';
      g.fillRect(bx, by, bw * sf, 7);
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.fillRect(bx, by, bw * sf, 2);
    }
    g.restore();
    // the numbers
    const label = v.maxHp > 1 ? `${Math.ceil(v.hpAbs)} / ${Math.round(v.maxHp)}${v.ovh > 0 ? `  +${Math.round(v.ovh)}` : ''}` : `${Math.round(v.hp)}%`;
    g.font = '700 19px "Baloo 2", "Trebuchet MS", sans-serif';
    g.lineWidth = 4;
    g.strokeText(label, bx + bw / 2, by + bh / 2 + 1);
    g.fillStyle = '#ffffff';
    g.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    // the level, in a little badge
    if (!v.dummy) {
      g.fillStyle = 'rgba(8,24,28,.92)';
      round(6, by - 3, 50, bh + 6, 11);
      g.fill();
      g.fillStyle = '#ffe27a';
      g.font = '700 16px "Baloo 2", "Trebuchet MS", sans-serif';
      g.fillText(`Lv ${v.level}`, 31, by + bh / 2 + 1);
    }
    g.font = '20px sans-serif';
    g.fillStyle = '#fff';
    if (hunted) g.fillText('🎯', 300, 20);
    if (friend && !v.self && !v.dummy) g.fillText('🛡️', 20, 20);
    if (v.speaking) g.fillText('🔊', 300, 84);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  private buildFighterRig(animal: string, dummy?: boolean): Rig {
    if (dummy) return makeDummyRig();
    return makePlayerRig(animal);
  }

  /** Create or refresh the models for the roster. */
  setRoster(list: { id: string; name: string; animal: string; team: number; role: number; dummy?: boolean }[], selfId: string) {
    this.selfId = selfId;
    const ids = new Set(list.map((l) => l.id));
    for (const [id, v] of this.fighters) {
      if (!ids.has(id)) {
        this.scene.remove(v.group, v.shadow);
        this.fighters.delete(id);
      }
    }
    for (const r of list) {
      let v = this.fighters.get(r.id);
      if (v && (v.role !== r.role || v.animal !== r.animal)) {
        this.scene.remove(v.group, v.shadow);
        v = undefined;
      }
      if (!v) {
        const rig = this.buildFighterRig(r.animal, r.dummy);
        const group = new THREE.Group();
        group.add(rig.root);
        const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: undefined, transparent: true, depthWrite: false, depthTest: false }));
        plate.scale.set(4.0, 1.2, 1);
        plate.renderOrder = 20;
        group.add(plate);
        const shadow = this.makeShadow(rig.radius * 1.1);
        const old = this.fighters.get(r.id);
        const evolved = !!old && old.animal !== r.animal;
        v = {
          id: r.id, name: r.name, animal: r.animal, team: r.team, role: r.role, rig, group, plate, plateKey: '', shadow,
          x: old?.x ?? 0, z: old?.z ?? 0, tx: old?.tx ?? 0, tz: old?.tz ?? 0, yaw: old?.yaw ?? 0, tyaw: old?.tyaw ?? 0, hp: 100, hpAbs: 0, maxHp: 1, ovh: 0, dummy: r.dummy, level: old?.level ?? 1, flags: 0, speed: 0,
          seen: old?.seen ?? 0, attack: 0, hurt: 0, self: r.id === selfId, swim: false, lastX: old?.x ?? 0, lastZ: old?.z ?? 0, speedS: 0, speaking: false, cue: null, guard: false, guardStart: -9, jy: 0, vy: 0, shield: this.makeShield(),
        };
        if (evolved) v.pop = 1;
        group.add(v.shield);
        v.stars = this.makeStars(rig.height + 0.15);
        group.add(v.stars);
        plate.position.y = rig.height + 0.45;
        group.visible = false;
        shadow.visible = false;
        this.scene.add(group, shadow);
        this.fighters.set(r.id, v);
      }
      v.name = r.name;
      v.team = r.team;
      v.self = r.id === selfId;
    }
  }

  /** One afterimage of a dash: a stretched, glowing streak that fades behind the animal. */
  private dashTrail(x: number, y: number, z: number, yaw: number, radius: number, team: number) {
    const color = team === this.fighters.get(this.selfId)?.team ? 0xcfeeff : 0xffd9a8;
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1, 5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.rotation.x = -Math.PI / 2; // lie along the direction of travel, tip trailing behind
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.scale.set(radius * 1.1, 2.6 + radius, radius * 0.7);
    m.position.set(x - Math.sin(yaw) * (1.1 + radius * 0.6), y + 0.55 + radius * 0.3, z - Math.cos(yaw) * (1.1 + radius * 0.6));
    this.scene.add(m);
    let t = 0;
    this.fxList.push({
      update: (dt) => {
        t += dt;
        const k = t / 0.32;
        (m.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - k);
        m.scale.x *= 1 - dt * 2.5;
        m.scale.z *= 1 - dt * 2.5;
        if (k >= 1) {
          this.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
          return false;
        }
        return true;
      },
    });
  }

  /** Three little stars circling a stunned animal's head. */
  private makeStars(height: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe27a });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), mat);
      s.userData.k = i;
      g.add(s);
    }
    g.position.y = height;
    g.visible = false;
    return g;
  }

  private spinStars(g: THREE.Group, on: boolean, t: number, radius: number) {
    g.visible = on;
    if (!on) return;
    g.children.forEach((c, i) => {
      const a = t * 6 + (i * Math.PI * 2) / 3;
      c.position.set(Math.cos(a) * radius, Math.sin(t * 9 + i) * 0.05, Math.sin(a) * radius);
      c.rotation.y = t * 8;
      c.rotation.x = t * 5;
    });
  }

  private makeShield(): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(1.25, 16, 10, Math.PI / 2 - 0.95, 1.9, 0.3, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.position.set(0, 0.5, 0.15);
    m.visible = false;
    return m;
  }

  /** Start an attack animation on a fighter (the telegraph). */
  cue(id: string, c: Omit<Cue, 'animal' | 'start' | 'strike' | 'rec'> & { rec?: number }) {
    const v = this.fighters.get(id);
    if (!v) return;
    v.cue = { ...c, animal: v.animal, start: this.clock, strike: STRIKE_TIME, rec: c.rec ?? 0.25 };
    if (v.role === 2 || v.animal === '') v.attack = 1;
  }
  cueMob(id: number, w: number, big: boolean) {
    const v = this.mobs.get(id);
    if (!v) return;
    const animal = v.def === this.mobIds.indexOf('alpha_gator') ? 'croc' : 'bear';
    v.cue = { kind: 'swing', animal, combo: big ? 2 : 0, heavy: big, skill: '', fx: '', start: this.clock, wind: w, strike: STRIKE_TIME, rec: 0.6 };
    v.warnUntil = this.clock + w;
  }
  /** Does this fighter's current move still have its wind-up to come? (0..1 progress, or -1) */
  windProgress(id: string): number {
    const c = this.fighters.get(id)?.cue;
    if (!c) return -1;
    const e = this.clock - c.start;
    return e < c.wind ? e / c.wind : -1;
  }

  /** A flat patch of ground (a ring, an arc or a disc) that follows the terrain, so it shows on slopes and curves. */
  private drape(x: number, z: number, yaw: number, r0: number, r1: number, a0: number, a1: number, segs: number, rings: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const idx: number[] = [];
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    for (let j = 0; j <= rings; j++) {
      const r = r0 + ((r1 - r0) * j) / rings;
      for (let i = 0; i <= segs; i++) {
        const a = a0 + ((a1 - a0) * i) / segs;
        const f = r * Math.cos(a); // forward
        const side = r * Math.sin(a);
        const wx = x + sy * f - cy * side;
        const wz = z + cy * f + sy * side;
        pos.push(wx, this.groundY(wx, wz) + 0.2, wz);
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const p = j * (segs + 1) + i;
        idx.push(p, p + segs + 1, p + 1, p + 1, p + segs + 1, p + segs + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  private drapeRect(x: number, z: number, yaw: number, len: number, wid: number): THREE.BufferGeometry {
    const pos: number[] = [];
    const idx: number[] = [];
    const n = Math.max(4, Math.ceil(len / 1.5));
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    for (let i = 0; i <= n; i++) {
      for (const sd of [-wid / 2, 0, wid / 2]) {
        const f = (len * i) / n;
        const wx = x + sy * f - cy * sd;
        const wz = z + cy * f + sy * sd;
        pos.push(wx, this.groundY(wx, wz) + 0.2, wz);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 2; k++) {
        const p = i * 3 + k;
        idx.push(p, p + 3, p + 1, p + 1, p + 3, p + 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Mark on the ground where a move is about to land, fading in as the wind-up runs out. */
  telegraph(x: number, z: number, yaw: number, tg: Telegraph, wind: number, hostile: boolean, heavy: boolean) {
    const g = new THREE.Group();
    const mats: THREE.MeshBasicMaterial[] = [];
    const mk = (geo: THREE.BufferGeometry, op: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: hostile ? (heavy ? 0xff3a1a : 0xff6a3a) : 0xffe9a8, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      mats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 3;
      m.frustumCulled = false;
      return m;
    };
    if (tg.shape === 'arc') {
      const a = (tg.arc * Math.PI) / 180;
      g.add(mk(this.drape(x, z, yaw, 0.15, tg.r, -a / 2, a / 2, 26, 5), 0.34));
      g.add(mk(this.drape(x, z, yaw, tg.r - 0.2, tg.r, -a / 2, a / 2, 26, 1), 0.7));
    } else if (tg.shape === 'circle') {
      g.add(mk(this.drape(x, z, yaw, 0.01, tg.r, -Math.PI, Math.PI, 40, Math.max(3, Math.ceil(tg.r / 2))), 0.28));
      g.add(mk(this.drape(x, z, yaw, tg.r - 0.25, tg.r, -Math.PI, Math.PI, 48, 1), 0.7));
    } else {
      g.add(mk(this.drapeRect(x, z, yaw, tg.r, tg.width), 0.32));
    }
    this.scene.add(g);
    this.decals.push({ g, mats, t: 0, wind, hostile, heavy });
  }

  telegraphSkill(x: number, z: number, yaw: number, skillId: string, wind: number, hostile: boolean, heavy: boolean) {
    const tg = telegraphFor(skillId);
    if (tg) this.telegraph(x, z, yaw, tg, wind, hostile, heavy);
  }

  setSpeaking(id: string, on: boolean) {
    const v = this.fighters.get(id);
    if (v) v.speaking = on;
  }

  /** Positions of things worth aiming at: other animals and wildlife. */
  aimTargets(mineTeam: number): { x: number; z: number; r: number; foe: boolean }[] {
    const out: { x: number; z: number; r: number; foe: boolean }[] = [];
    for (const v of this.fighters.values()) {
      if (v.self || !v.group.visible || v.team === mineTeam || v.role === 3) continue;
      out.push({ x: v.x, z: v.z, r: 0.6, foe: true });
    }
    for (const m of this.mobs.values()) out.push({ x: m.x, z: m.z, r: m.rig.radius, foe: false });
    return out;
  }

  /** Where every visible creature is, for the minimap: [x, z, 0 small | 1 big | 2 alpha]. */
  mobBlips(): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const m of this.mobs.values()) out.push([m.x, m.z, m.big ? (m.rig.radius > 1.2 ? 2 : 1) : 0]);
    return out;
  }

  /** Count a blow on a target dummy towards its damage per second. */
  dummyHit(id: string, n: number) {
    const v = this.fighters.get(id);
    if (!v?.dummy) return;
    const t = performance.now() / 1000;
    if (!v.dpsRun || t - v.dpsRun.last > 3) v.dpsRun = { first: t, last: t, total: 0 };
    v.dpsRun.total += n;
    v.dpsRun.last = t;
    v.dps = Math.round(v.dpsRun.total / Math.max(1.5, t - v.dpsRun.first));
  }

  fighter(id: string) {
    return this.fighters.get(id);
  }
  allFighters() {
    return this.fighters.values();
  }

  /** Server says where the other fighters are. */
  applyFighters(list: [string, number, number, number, number, number, number, number, number, number, number][], _arenaClock?: number) {
    const now = this.clock; // the scene's own clock: the arena's runs at a different speed during hit-stop
    for (const [id, x, z, yaw, hp, lvl, flags, jy, hpAbs, maxHp, shield] of list) {
      const v = this.fighters.get(id);
      if (!v) continue;
      if (now - v.seen > 0.8) {
        v.x = x;
        v.z = z;
        v.yaw = yaw;
      }
      v.tx = x;
      v.tz = z;
      v.tyaw = yaw;
      v.hp = hp;
      v.hpAbs = hpAbs;
      v.maxHp = maxHp;
      v.ovh = shield;
      v.level = lvl;
      if ((flags & FL.atk) && !(v.flags & FL.atk)) v.attack = 1;
      v.flags = flags;
      v.jy = jy ?? 0;
      v.seen = now;
    }
  }

  /** Where we draw ourselves (the predicted position). */
  setSelf(x: number, z: number, yaw: number, hpPct: number, level: number, flags: number, speed: number, jy = 0) {
    const v = this.fighters.get(this.selfId);
    if (!v) return;
    v.x = x;
    v.z = z;
    v.tx = x;
    v.tz = z;
    v.tyaw = yaw;
    v.hp = hpPct;
    v.level = level;
    if ((flags & FL.atk) && !(v.flags & FL.atk)) v.attack = 1;
    v.flags = flags;
    v.jy = jy;
    v.speed = speed;
    v.seen = this.clock;
    this.selfPos.set(x, this.groundY(x, z), z);
    this.seeB.value.set(x, this.groundY(x, z) + 1.0, z);
  }

  /** Which entity (id) the camera should follow when you are not the one being controlled. */
  focusOn(id: string) {
    this.selfId = id;
    for (const v of this.fighters.values()) v.self = v.id === id;
  }

  applyMobs(list: [number, number, number, number, number, number, number][], _arenaClock?: number) {
    const now = this.clock;
    for (const [id, def, x, z, yaw, hp, flags] of list) {
      let v = this.mobs.get(id);
      if (!v) {
        const defId = this.mobIds[def];
        const rig = makeMobRig(defId);
        const group = new THREE.Group();
        group.add(rig.root);
        const big = defId.startsWith('alpha') || defId === 'wildpig' || defId === 'heron' || defId === 'pike';
        const shadow = big || defId === 'fox' || defId === 'goat' || defId === 'rabbit' || defId === 'duck' ? this.makeShadow(Math.max(0.3, rig.radius)) : null;
        v = {
          id, def, rig, group, shadow, x, z, tx: x, tz: z, yaw, tyaw: yaw, seen: now, speedS: 0, lastX: x, lastZ: z, attack: 0, hurt: 0, flags,
          flee: false, aquatic: ['minnow', 'perch', 'pike'].includes(defId), flies: ['sparrow'].includes(defId), hp: 100, barHp: 100, big, cue: null, warnUntil: 0,
        };
        const mst = this.makeStars(rig.height + 0.15);
        group.add(mst);
        (group as unknown as { stars: THREE.Group }).stars = mst;
        if (big) {
          const bar = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
          bar.scale.set(defId.startsWith('alpha') ? 3 : 1.4, 0.2, 1);
          bar.position.y = rig.height + 0.3;
          bar.renderOrder = 20;
          group.add(bar);
          v.bar = bar;
        }
        this.scene.add(group);
        if (shadow) this.scene.add(shadow);
        this.mobs.set(id, v);
      }
      v.tx = x;
      v.tz = z;
      v.tyaw = yaw;
      v.hp = hp;
      if ((flags & 4) && !(v.flags & 4)) v.attack = 1;
      if ((flags & 8) && !(v.flags & 8)) v.hurt = 1;
      v.flags = flags;
      v.flee = (flags & 2) !== 0;
      v.seen = now;
    }
  }

  private barTexture(pct: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    const g = c.getContext('2d')!;
    g.fillStyle = '#08272a';
    g.fillRect(0, 0, 64, 8);
    g.fillStyle = '#e5483a';
    g.fillRect(1, 1, Math.max(0, 62 * pct / 100), 6);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  private dropMesh(kind: string, id = 0): THREE.Group {
    const g = new THREE.Group();
    const m = (c: number) => toonMat({ color: c, flatShading: true, emissive: c, emissiveIntensity: 0.25 });
    switch (kind) {
      case 'morsel': {
        // a small bright pellet, a different colour each, like the food in deeeep.io
        const c = [0xff7a8a, 0x7fe3c4, 0x7fc8ff, 0xffd23f, 0xc78bff, 0xff9a52][id % 6];
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), m(c));
        gem.scale.y = 1.25;
        g.add(gem);
        const glow = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = -0.25;
        g.add(glow);
        return g;
      }
      case 'meat': {
        g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), m(0xc4443b)));
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), m(0xf2eee0));
        bone.rotation.z = 1.2;
        g.add(bone);
        break;
      }
      case 'pile': {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), m(0x8a6a3c));
        s.scale.y = 0.8;
        g.add(s);
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 5), m(0xf2eee0)));
        break;
      }
      case 'feather': {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.5), m(0x9bd0ff));
        g.add(f);
        break;
      }
      case 'tusk':
      case 'musk':
      case 'honey':
      case 'mud':
      case 'reed':
      case 'berry':
      case 'herb':
      case 'water':
      default: {
        const c = { tusk: 0xf2eee0, musk: 0xb067e0, honey: 0xe8b830, mud: 0x6a4a30, reed: 0x9aa655, berry: 0xd42a3c, herb: 0x7ec06a, water: 0x4aa8ff }[kind] ?? 0xffffff;
        g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), m(c)));
      }
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 16), new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.1;
    g.add(ring);
    return g;
  }

  applyDrops(list: [number, string, number, number, number][], _arenaClock?: number) {
    const now = this.clock;
    for (const [id, kind, x, z] of list) {
      let d = this.drops.get(id);
      if (!d) {
        const g = this.dropMesh(kind, id);
        this.scene.add(g);
        d = { g, kind, seen: now, y0: 0 };
        this.drops.set(id, d);
      }
      d.g.position.set(x, this.groundY(x, z) + 0.45, z);
      d.y0 = d.g.position.y;
      d.seen = now;
    }
  }

  /** A picked-up item does not just vanish: it spins up, arcs into whoever took it, and bursts into sparkles. */
  private collectFx(g: THREE.Group) {
    let who: FighterView | null = null;
    let best = 36; // within 6 m
    for (const v of this.fighters.values()) {
      const d = (v.x - g.position.x) ** 2 + (v.z - g.position.z) ** 2;
      if (d < best) {
        best = d;
        who = v;
      }
    }
    if (!who) {
      this.scene.remove(g);
      return;
    }
    const target = who;
    let col = 0xffe9a0;
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
      if (m && m.color && col === 0xffe9a0 && (o as THREE.Mesh).isMesh && !(m as unknown as THREE.MeshBasicMaterial).transparent) col = m.color.getHex();
    });
    const from = g.position.clone();
    const base = g.scale.x || 1;
    let t = 0;
    const dur = 0.42;
    this.ringFx(from.x, from.z, 0.9, col, 0.35);
    this.fxList.push({
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        const e = k * k * (3 - 2 * k); // ease in and out
        const h = target.rig.height * 0.6 + this.groundY(target.x, target.z);
        g.position.set(from.x + (target.x - from.x) * e, from.y + (h - from.y) * e + Math.sin(k * Math.PI) * 1.1, from.z + (target.z - from.z) * e);
        g.rotation.y += dt * (8 + 30 * k);
        g.scale.setScalar(base * (k < 0.3 ? 1 + k * 1.6 : 1.5 * (1 - (k - 0.3) / 0.7) + 0.05));
        if (Math.random() < 0.7) this.burst(g.position.x, g.position.y, g.position.z, col, 1, 0.8, 0.35);
        if (k >= 1) {
          this.scene.remove(g);
          this.burst(g.position.x, g.position.y, g.position.z, col, 14, 3.4, 0.55);
          this.burst(g.position.x, g.position.y, g.position.z, 0xffffff, 6, 2, 0.4);
          return false;
        }
        return true;
      },
    });
  }

  groundY(x: number, z: number): number {
    return Math.max(this.terrain.heightAt(x, z), WATER_Y - 0.1);
  }

  // --- effects -----------------------------------------------------------------------------------

  ringFx(x: number, z: number, r: number, color: number, dur = 0.6) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, this.groundY(x, z) + 0.25, z);
    this.scene.add(m);
    let t = 0;
    this.fxList.push({
      update: (dt) => {
        t += dt;
        const k = Math.min(1, t / dur);
        m.scale.setScalar(Math.max(0.1, r * k));
        (m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        if (k >= 1) {
          this.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
          return false;
        }
        return true;
      },
    });
  }

  burst(x: number, y: number, z: number, color: number, n = 10, speed = 3, life = 0.5) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + 0.5, (Math.random() - 0.5) * speed));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.22, transparent: true, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    let t = 0;
    this.fxList.push({
      update: (dt) => {
        t += dt;
        const a = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < n; i++) {
          vel[i].y -= 9 * dt;
          a.setXYZ(i, a.getX(i) + vel[i].x * dt, a.getY(i) + vel[i].y * dt, a.getZ(i) + vel[i].z * dt);
        }
        a.needsUpdate = true;
        (pts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t / life);
        if (t >= life) {
          this.scene.remove(pts);
          geo.dispose();
          (pts.material as THREE.Material).dispose();
          return false;
        }
        return true;
      },
    });
  }

  slash(x: number, z: number, yaw: number, range: number, color: number) {
    const m = new THREE.Mesh(new THREE.RingGeometry(range * 0.3, range, 14, 1, -0.9, 1.8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = yaw - Math.PI / 2 + Math.PI;
    m.position.set(x, this.groundY(x, z) + 0.7, z);
    this.scene.add(m);
    let t = 0;
    this.fxList.push({
      update: (dt) => {
        t += dt;
        (m.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t / 0.22);
        if (t >= 0.22) {
          this.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
          return false;
        }
        return true;
      },
    });
  }

  /**
   * How far along the line from the animal (t) to the wanted camera spot (c) is clear, 0..1: the camera
   * is pulled in so trees, rocks and hills never come between you and your animal.
   */
  cameraClear(tx: number, ty: number, tz: number, cx: number, cy: number, cz: number): number {
    const n = 16;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = tx + (cx - tx) * f;
      const y = ty + (cy - ty) * f;
      const z = tz + (cz - tz) * f;
      if (y < this.groundY(x, z) + 0.45) return (i - 1) / n;
      for (const r of this.terrain.near(x, z, 2)) {
        if (r.r <= 0 || r.h < 1) continue;
        if (Math.hypot(x - r.x, z - r.z) < r.r + 0.25 && y < this.groundY(r.x, r.z) + r.h) return (i - 1) / n;
      }
    }
    return 1;
  }

  /** An animal glows and trembles while it evolves. */
  evolveGlow(id: string, secs: number) {
    const v = this.fighters.get(id);
    if (v) v.evolveUntil = this.clock + secs;
  }

  /** Everyone drops in from the sky at the start, landing one after another in a puff of dust. */
  dropIn() {
    for (const v of this.fighters.values()) v.drop = v.self ? 0 : -Math.random() * 0.7;
  }

  onLand?: () => void;

  /** A fighter who has just been eliminated tips over and fades out instead of blinking away. */
  faint(id: string) {
    const v = this.fighters.get(id);
    if (!v || v.self || !v.group.visible) return;
    v.dying = 0.9;
    v.fallDir = Math.random() < 0.5 ? -1 : 1;
    this.burst(v.x, this.groundY(v.x, v.z) + 0.8, v.z, 0xffe9a0, 14, 3.2, 0.7);
  }

  /** A creature that has gone (usually killed) tips over and shrinks away instead of blinking out. */
  private mobFall(v: MobView) {
    const g = v.group;
    const s0 = g.scale.x;
    const dir = Math.random() < 0.5 ? -1 : 1;
    let t = 0;
    this.fxList.push({
      update: (dt) => {
        t += dt / 0.5;
        if (t >= 1) {
          this.scene.remove(g);
          return false;
        }
        g.rotation.z = dir * Math.min(1, t * 2.2) * 1.5;
        g.scale.setScalar(s0 * (1 - t * t * 0.95));
        return true;
      },
    });
  }

  floater(x: number, y: number, z: number, text: string, color: string, size = 1) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.font = '700 38px Josefin Sans, "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = '#08272a';
    g.strokeText(text, 64, 36);
    g.fillStyle = color;
    g.fillText(text, 64, 36);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    s.scale.set(1.8 * size, 0.68 * size, 1);
    s.position.set(x, y, z);
    s.renderOrder = 30;
    this.scene.add(s);
    this.floaters.push({ s, vy: 2.2, life: 0, max: 0.9, base: size });
    s.scale.set(0, 0, 1);
  }

  projectile(id: number, x: number, z: number, tx: number, tz: number, color: number) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color }));
    const from = new THREE.Vector3(x, this.groundY(x, z) + 0.9, z);
    const to = new THREE.Vector3(tx, this.groundY(tx, tz) + 0.9, tz);
    m.position.copy(from);
    this.scene.add(m);
    this.projs.set(id, { m, from, to, t: 0, dur: from.distanceTo(to) / 30 });
  }

  lureAt(x: number, z: number) {
    if (this.lure) this.scene.remove(this.lure.g);
    const g = new THREE.Group();
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.4, 6), toonMat({ color: 0xe8b830, emissive: 0x553300 }));
    jar.position.y = 0.2;
    g.add(jar);
    g.position.set(x, this.groundY(x, z), z);
    this.scene.add(g);
    this.lure = { g, until: this.clock + 14 };
    this.ringFx(x, z, 10, 0xffd23f, 1.2);
  }

  // --- per frame -----------------------------------------------------------------------------------

  update(dt: number, mineTeam: number, matchTime: number) {
    this.clock += dt;
    this.time.value = this.clock;
    this.seeA.value.copy(this.camera.position);
    this.waterTex.offset.x += dt * 0.012;
    this.waterTex.offset.y += dt * 0.007;
    (this.water.material as THREE.MeshPhongMaterial).opacity = 0.7;
    this.refreshNodes(matchTime);
    const now = this.clock;

    for (const v of this.fighters.values()) {
      const visible = v.self || now - v.seen < 0.7 || (v.dying ?? 0) > 0;
      v.group.visible = visible;
      v.shadow.visible = visible;
      if (!visible) continue;
      if (!v.self) {
        const k = 1 - Math.exp(-dt * 11);
        v.x += (v.tx - v.x) * k;
        v.z += (v.tz - v.z) * k;
      }
      let dy = v.tyaw - v.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.yaw += dy * (1 - Math.exp(-dt * 12));
      const ground = this.groundY(v.x, v.z);
      const depth = Math.max(0, WATER_Y - this.terrain.heightAt(v.x, v.z));
      v.swim = depth > 0.4;
      const y = ground - (v.swim ? Math.min(0.5, depth * 0.3) : 0);
      const prevJy = v.jy;
      const rockFloor = this.terrain.floorAt(v.x, v.z, v.jy);
      const airH = Math.max(0, v.jy - rockFloor); // height above whatever it stands on, a rock included
      let dropOff = 0;
      if (v.drop !== undefined) {
        v.drop += dt;
        const u = Math.max(0, Math.min(1, v.drop / 0.8));
        dropOff = 26 * (1 - u * u);
        if (u >= 1) {
          v.drop = undefined;
          this.burst(v.x, ground + 0.2, v.z, 0xfff4d0, 16, 4, 0.7);
          this.ringFx(v.x, v.z, 3.5, 0xfff4d0, 0.5);
          if (v.self) this.onLand?.();
        }
      }
      v.group.position.set(v.x, y + v.jy + dropOff, v.z);
      v.group.rotation.y = v.yaw;
      if (v.dying !== undefined) {
        v.dying -= dt;
        const u = 1 - Math.max(0, v.dying) / 0.9;
        v.group.rotation.z = Math.min(1, u * 2.4) * 1.5 * (v.fallDir ?? 1);
        v.group.scale.setScalar(1 - Math.max(0, u - 0.55) * 2.1);
        if (v.dying <= 0) {
          v.dying = undefined;
          v.group.scale.setScalar(1);
          v.group.rotation.z = 0;
        }
      }
      v.shadow.position.set(v.x, ground + rockFloor + 0.06, v.z);
      v.shadow.scale.setScalar(Math.max(0.45, 1 - airH * 0.25) * Math.max(0.2, 1 - dropOff / 30));
      v.vy += ((v.jy - (v.lastJy ?? prevJy)) / Math.max(dt, 1e-3) - v.vy) * 0.5;
      v.lastJy = v.jy;
      const moved = Math.hypot(v.x - v.lastX, v.z - v.lastZ) / Math.max(dt, 1e-3);
      v.lastX = v.x;
      v.lastZ = v.z;
      v.speedS += (Math.min(moved, 30) - v.speedS) * (1 - Math.exp(-dt * 9));
      v.attack = Math.max(0, v.attack - dt * 3.5);
      v.hurt = Math.max(0, v.hurt - dt * 2);
      let pose = null;
      let warn = 0;
      if (v.cue) {
        pose = poseFor(v.cue, now);
        if (!pose) v.cue = null;
        else {
          const e = now - v.cue.start;
          if (e < v.cue.wind && (v.cue.kind === 'swing' || v.cue.kind === 'skill')) warn = (0.35 + 0.65 * (e / v.cue.wind)) * (v.cue.heavy ? 1.25 : 1);
        }
      }
      const guarding = (v.flags & FL.guard) !== 0;
      if (guarding && !v.guard) v.guardStart = now;
      v.guard = guarding;
      const sh = v.shield;
      sh.visible = guarding;
      if (guarding) {
        const parry = now - v.guardStart < 0.24;
        const mat = sh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(parry ? 0xffe27a : 0x8fd8ff);
        mat.opacity = parry ? 0.6 : 0.3 + Math.sin(now * 10) * 0.04;
        sh.scale.setScalar(v.rig.radius > 0.9 ? 1.5 : v.rig.radius < 0.5 ? 0.8 : 1);
      }
      // how fast it is turning, for leaning into corners
      let turn = 0;
      {
        const py = this.prevYaw.get(v.id) ?? v.yaw;
        let dy = v.yaw - py;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        turn = dy / Math.max(dt, 1e-3);
        this.prevYaw.set(v.id, v.yaw);
      }
      // dust kicked up by a sprint, and a bigger puff on landing (only near the camera)
      const nearCam = Math.hypot(v.x - this.camera.position.x, v.z - this.camera.position.z) < 45;
      if (nearCam && v.x < 1000) {
        const was = this.prevJy.get(v.id) ?? 0;
        const ground2 = this.groundY(v.x, v.z);
        const wet = this.terrain.depthAt(v.x, v.z) > 0.1;
        const col = wet ? 0xcfeeff : this.terrain.biomeAt(v.x, v.z) === 0 ? 0x8a7a55 : 0xd2c299;
        if (was > 0.15 && airH < 0.05) this.burst(v.x, ground2 + rockFloor + 0.15, v.z, col, 9, 2.6, 0.45);
        else if (v.speedS > 7 && airH < 0.05 && this.clock - (this.dustAt.get(v.id) ?? -1) > 0.17) {
          this.dustAt.set(v.id, this.clock);
          this.burst(v.x - Math.sin(v.yaw) * 0.5, ground2 + 0.12, v.z - Math.cos(v.yaw) * 0.5, col, 4, 1.4, 0.38);
        }
      }
      this.prevJy.set(v.id, airH);
      const st: RigState = { turn, speed: v.speedS, attack: v.attack, hurt: v.hurt, stun: (v.flags & FL.stun) !== 0, flee: false, swim: v.swim, t: now, pose, guard: guarding, air: airH, vy: v.vy, warn, counter: (v.flags & FL.counter) !== 0, soar: (v.flags & FL.soar) !== 0, crouch: (v.flags & FL.crouch) !== 0 };
      v.lastState = st;
      v.rig.update(dt, st);
      if ((v.evolveUntil ?? 0) > now) v.rig.root.scale.setScalar(1 + Math.sin(now * 16) * 0.04);
      else if (v.pop !== undefined) {
        v.pop = Math.max(0, v.pop - dt * 2.2);
        const c = 1.9;
        v.rig.root.scale.setScalar(1 - (c + 1) * v.pop ** 3 + c * v.pop ** 2);
        if (v.pop === 0) v.pop = undefined;
      } else if (v.rig.root.scale.x !== 1) v.rig.root.scale.setScalar(1);
      if (v.stars) this.spinStars(v.stars, (v.flags & FL.stun) !== 0, now, Math.max(0.35, v.rig.radius * 0.7));
      v.rig.setTint((v.evolveUntil ?? 0) > now ? 0xbff0ff : (v.flags & FL.marked) !== 0 ? 0xffd23f : (v.flags & FL.hunted) !== 0 ? 0xff7a1a : v.self || v.dummy ? null : v.team === mineTeam ? 0x2f9bff : 0xff3a3a); // blue teammates, red hostiles
      // hide models in bushes/underwater from far away is the server's job; here just the plate
      const key = `${v.dps ?? 0}|${v.hpAbs}|${v.maxHp}|${v.ovh}|${v.level}|${v.flags & (FL.hunted | 1)}|${v.role}|${mineTeam}|${v.speaking ? 1 : 0}`;
      if (key !== v.plateKey) {
        v.plateKey = key;
        const old = (v.plate.material as THREE.SpriteMaterial).map;
        (v.plate.material as THREE.SpriteMaterial).map = this.drawPlate(v, mineTeam);
        (v.plate.material as THREE.SpriteMaterial).needsUpdate = true;
        old?.dispose();
      }
      const dist = Math.hypot(v.x - this.camera.position.x, v.z - this.camera.position.z);
      v.plate.visible = !v.self && (dist < 55 || v.team === mineTeam || (v.flags & FL.hunted) !== 0);
      v.rig.root.visible = !(v.flags & FL.hidden) || v.self || v.team === mineTeam || dist < 10;
    }

    for (const [id, v] of this.mobs) {
      // animals beyond 25 m are only updated when they change (or every 0.3 s), so they get longer before they count as gone
      const away = Math.hypot(v.x - this.camera.position.x, v.z - this.camera.position.z);
      if (now - v.seen > (away < 25 ? 0.6 : away < 50 ? 1.0 : 1.4)) {
        if (v.shadow) this.scene.remove(v.shadow);
        this.mobs.delete(id);
        if (Math.hypot(v.x - this.camera.position.x, v.z - this.camera.position.z) < 45) this.mobFall(v);
        else this.scene.remove(v.group);
        continue;
      }
      const k = 1 - Math.exp(-dt * 10);
      v.x += (v.tx - v.x) * k;
      v.z += (v.tz - v.z) * k;
      let dy = v.tyaw - v.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.yaw += dy * (1 - Math.exp(-dt * 12));
      const ground = this.groundY(v.x, v.z);
      let y = ground;
      if (v.aquatic) y = WATER_Y - 0.7;
      else if (v.flies) y = ground + (v.def >= 0 ? 0.9 : 0);
      v.group.position.set(v.x, y, v.z);
      v.group.rotation.y = v.yaw;
      if (v.shadow) v.shadow.position.set(v.x, ground + 0.06, v.z);
      const moved = Math.hypot(v.x - v.lastX, v.z - v.lastZ) / Math.max(dt, 1e-3);
      v.lastX = v.x;
      v.lastZ = v.z;
      v.speedS += (Math.min(moved, 30) - v.speedS) * (1 - Math.exp(-dt * 8));
      v.attack = Math.max(0, v.attack - dt * 3);
      v.hurt = Math.max(0, v.hurt - dt * 2.5);
      let mpose = null;
      let mwarn = 0;
      if (v.cue) {
        mpose = poseFor(v.cue, now);
        if (!mpose) v.cue = null;
      }
      if (now < v.warnUntil) mwarn = 0.5 + 0.5 * (1 - (v.warnUntil - now) / Math.max(0.1, v.cue?.wind ?? 0.5));
      if (v.flags & 128) mwarn = Math.max(mwarn, 0.9); // a wild animal crouching to bite
      v.rig.setTint(0xffd23f); // wild animals glow yellow
      v.rig.update(dt, { speed: v.speedS, attack: v.attack, hurt: v.hurt, stun: (v.flags & 32) !== 0, flee: v.flee, swim: false, t: now, pose: mpose, warn: mwarn });
      const mstars = (v.group as unknown as { stars?: THREE.Group }).stars;
      if (mstars) this.spinStars(mstars, (v.flags & 32) !== 0, now, Math.max(0.4, v.rig.radius * 0.6));
      if (v.bar && Math.abs(v.hp - v.barHp) > 1) {
        v.barHp = v.hp;
        const old = (v.bar.material as THREE.SpriteMaterial).map;
        (v.bar.material as THREE.SpriteMaterial).map = this.barTexture(v.hp);
        (v.bar.material as THREE.SpriteMaterial).needsUpdate = true;
        old?.dispose();
      } else if (v.bar && !(v.bar.material as THREE.SpriteMaterial).map) {
        (v.bar.material as THREE.SpriteMaterial).map = this.barTexture(v.hp);
        (v.bar.material as THREE.SpriteMaterial).needsUpdate = true;
      }
    }

    for (const [id, d] of this.drops) {
      if (now - d.seen > 0.8) {
        this.drops.delete(id);
        this.collectFx(d.g);
        continue;
      }
      d.g.position.y = d.y0 + Math.sin(now * 3 + id) * 0.08;
      d.g.rotation.y += dt * 1.2;
    }
    if (this.lure && now > this.lure.until) {
      this.scene.remove(this.lure.g);
      this.lure = null;
    }
    for (const [id, p] of this.projs) {
      p.t += dt;
      const k = Math.min(1, p.t / Math.max(0.05, p.dur));
      p.m.position.lerpVectors(p.from, p.to, k);
      if (k >= 1) {
        this.scene.remove(p.m);
        this.projs.delete(id);
      }
    }
    // a streak of light behind anyone who is dashing
    for (const v of this.fighters.values()) {
      if (!v.group.visible || !(v.flags & FL.dash)) continue;
      const last = this.trailAt.get(v.id) ?? -1;
      if (this.clock - last < 0.025) continue;
      this.trailAt.set(v.id, this.clock);
      this.dashTrail(v.x, this.groundY(v.x, v.z) + v.jy, v.z, v.yaw, v.rig.radius, v.team);
    }
    this.fxList = this.fxList.filter((f) => f.update(dt));
    this.decals = this.decals.filter((d) => {
      d.t += dt;
      const k = d.t / Math.max(0.05, d.wind);
      const flash = d.t > d.wind ? Math.max(0, 1 - (d.t - d.wind) / 0.14) : 0;
      const pulse = d.hostile ? 0.75 + 0.25 * Math.sin(d.t * (d.heavy ? 34 : 22)) : 0.5;
      const a = d.t <= d.wind ? Math.min(1, 0.25 + 0.75 * k) * pulse : flash;
      d.mats.forEach((m, i) => {
        m.opacity = (i === 0 ? 0.45 : 0.95) * a;
        if (flash > 0) m.color.setHex(0xffffff);
      });
      if (d.t > d.wind + 0.14) {
        this.scene.remove(d.g);
        d.g.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        return false;
      }
      return true;
    });
    this.floaters = this.floaters.filter((f) => {
      f.life += dt;
      f.s.position.y += f.vy * dt;
      f.vy *= 0.94;
      // pop in with a little overshoot
      const u = Math.min(1, f.life / 0.2) - 1;
      const k = 1 + 2.7 * u * u * u + 1.7 * u * u;
      f.s.scale.set(1.8 * f.base * k, 0.68 * f.base * k, 1);
      (f.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - f.life / f.max);
      if (f.life >= f.max) {
        this.scene.remove(f.s);
        (f.s.material as THREE.SpriteMaterial).map?.dispose();
        f.s.material.dispose();
        return false;
      }
      return true;
    });

    // underwater haze
    const under = this.camera.position.y < WATER_Y;
    if (under) {
      this.fog.color.setHex(0x2a6f86);
      this.fog.near = 2;
      this.fog.far = 30;
      (this.scene.background as THREE.Color).setHex(0x2a6f86);
    } else {
      this.fog.color.setHex(SKY_HORIZON);
      this.fog.near = 90;
      this.fog.far = 380;
      (this.scene.background as THREE.Color).setHex(SKY_HORIZON);
    }
  }

  get focusPos() {
    return this.selfPos;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
        o.geometry?.dispose();
      }
    });
  }
}
