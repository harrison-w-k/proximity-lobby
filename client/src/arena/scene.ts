// The 3D world of a match: terrain, water, lava, vegetation, the animals and the effects.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GULAG_R, GULAG_X } from '../../../shared/arena/move';
import { Biome, MAP_RADIUS, Terrain, WATER_Y, CELL, type Res } from '../../../shared/arena/terrain';
import { FL } from '../../../shared/arena/proto';
import { STRIKE_TIME, poseFor, telegraphFor, type Cue, type Telegraph } from './anim';
import { makeLeaderRig, makeMobRig, makePlayerRig, type Rig, type RigState } from './models';

const SKY_TOP = 0x5d8fd0;
const SKY_HORIZON = 0xcfe0ea;

export interface FighterView {
  id: string;
  name: string;
  animal: string;
  team: number;
  role: number;
  swarm?: string;
  tier: number;
  rig: Rig;
  group: THREE.Group;
  plate: THREE.Sprite;
  plateKey: string;
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
  shield: THREE.Mesh;
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
  private decals: { g: THREE.Group; mats: THREE.MeshBasicMaterial[]; t: number; wind: number; hostile: boolean; heavy: boolean }[] = [];
  private floaters: { s: THREE.Sprite; vy: number; life: number; max: number }[] = [];
  private projs = new Map<number, { m: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number }>();
  private lure: { g: THREE.Group; until: number } | null = null;
  private clock = 0;
  private selfId = '';
  gulagLook = false;
  private selfPos = new THREE.Vector3();
  nodeTimes = new Map<number, number>();
  private nodeMeshes = new Map<number, { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; zero: THREE.Matrix4 }>();
  private tmpM = new THREE.Matrix4();

  constructor(seed: number, mobIds: string[]) {
    this.mobIds = mobIds;
    this.terrain = new Terrain(seed);
    this.fog = new THREE.Fog(SKY_HORIZON, 90, 380);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(SKY_HORIZON);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x6f7a55, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff2d6, 1.7);
    this.sun.position.set(180, 260, 90);
    this.scene.add(this.sun);
    this.scene.add(this.makeSky());
    this.buildTerrain();
    this.buildWater();
    this.buildWalls();
    this.buildVegetation();
    this.buildGulag();
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
    if (h < WATER_Y - 0.1) c.setHex(h < -1.5 ? 0x4b5f55 : 0x9c9570);
    else if (h < WATER_Y + 0.5) c.setHex(0xd8c88c);
    else {
      switch (bio) {
        case Biome.Forest:
          c.setHex(0x3f6e38);
          break;
        case Biome.Wetlands:
          c.setHex(0x5f8a45);
          break;
        case Biome.Grassland:
          c.setHex(0xa3b94d);
          break;
        default:
          c.setHex(0x8b8672);
          if (h > 24) c.setHex(0xe3e6e8);
          else if (h > 15) c.lerp(new THREE.Color(0xc7c8c2), (h - 15) / 9);
      }
      if (slope > 0.75) c.lerp(new THREE.Color(0x77716a), Math.min(1, (slope - 0.75) * 2.5));
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
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
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
    this.water = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ map: tex, transparent: true, opacity: 0.72, shininess: 80, specular: 0xbfe6ff, depthWrite: false }));
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

  private ringMaterial(m: THREE.Material) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uRing = this.ring;
      sh.uniforms.uA = this.seeA;
      sh.uniforms.uB = this.seeB;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uRing;
varying vec3 vWP;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
if (length(instanceMatrix[3].xz) > uRing - 1.0) transformed *= 0.0;
vec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 wp4 = modelMatrix * vec4(transformed, 1.0);
#endif
vWP = wp4.xyz;`,
        );
      // leaves, trunks and rocks between the camera and your animal melt away
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
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
      tree: { geo: treeGeo(0x3f7f3a, 0x6b4a2e, 'round'), mat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }) },
      pine: { geo: treeGeo(0x2f6b45, 0x5b3f29, 'pine'), mat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }) },
      fruit: { geo: treeGeo(0x5c9a3c, 0x6b4a2e, 'fruit'), mat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), node: true },
      hive: { geo: treeGeo(0x3f7f3a, 0x6b4a2e, 'hive'), mat: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), node: true },
      bush: { geo: bushGeo, mat: new THREE.MeshLambertMaterial({ color: 0x4d8a3c, flatShading: true }) },
      berryBush: { geo: bushGeo, mat: new THREE.MeshLambertMaterial({ color: 0x3d7a34, flatShading: true }) },
      berry: { geo: berriesGeo, mat: new THREE.MeshLambertMaterial({ color: 0xd42a3c, flatShading: true, emissive: 0x330508 }), node: true },
      rock: { geo: rockGeo, mat: new THREE.MeshLambertMaterial({ color: 0x8c8a85, flatShading: true }), jitter: true },
      stone: { geo: rockGeo, mat: new THREE.MeshLambertMaterial({ color: 0x9a9890, flatShading: true }), jitter: true },
      herb: { geo: herbGeo, mat: new THREE.MeshLambertMaterial({ color: 0x7ec06a, flatShading: true, emissive: 0x0a1a0a }), node: true },
      reed: { geo: reedGeo, mat: new THREE.MeshLambertMaterial({ color: 0x9aa655, flatShading: true }), node: true },
      mud: { geo: mudGeo, mat: new THREE.MeshLambertMaterial({ color: 0x5a4330, flatShading: true }), node: true },
      tuft: { geo: tuftGeo, mat: new THREE.MeshLambertMaterial({ color: 0xb7c95a, flatShading: true }) },
    };
    for (const k of Object.values(kinds)) {
      this.ringMaterial(k.mat);
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

  private buildGulag() {
    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0x77736b, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x4b4944, flatShading: true });
    const arena = (cx: number, cz: number) => {
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(GULAG_R + 1, GULAG_R + 1.5, 1.2, 28), new THREE.MeshLambertMaterial({ color: 0xa79d85, flatShading: true }));
      floor.position.set(cx, -0.6, cz);
      g.add(floor);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const w = new THREE.Mesh(new THREE.BoxGeometry(6.5, 5 + (i % 3), 1.6), i % 2 ? stone : dark);
        w.position.set(cx + Math.cos(a) * (GULAG_R + 1.2), 2.2, cz + Math.sin(a) * (GULAG_R + 1.2));
        w.rotation.y = -a + Math.PI / 2;
        g.add(w);
      }
      for (const [dx, dz] of [[-10, -9], [11, 8], [0, 14], [-4, 6]] as const) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 3.4, 7), stone);
        p.position.set(cx + dx, 1.7, cz + dz);
        g.add(p);
      }
    };
    for (let s = 0; s < 4; s++) arena(GULAG_X, -120 + s * 80);
    // the holding pen: sand and a fence
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(21, 21.5, 1.2, 24), new THREE.MeshLambertMaterial({ color: 0xc9b98a, flatShading: true }));
    pen.position.set(GULAG_X - 70, -0.6, 0);
    g.add(pen);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.6, 0.4), dark);
      post.position.set(GULAG_X - 70 + Math.cos(a) * 20.5, 1.3, Math.sin(a) * 20.5);
      g.add(post);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 32), new THREE.MeshLambertMaterial({ color: 0x6d6a60 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GULAG_X - 30, -1.3, -20);
    g.add(ground);
    this.scene.add(g);
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
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    const friend = v.team === mine;
    g.font = 'bold 22px "Courier New", monospace';
    g.textAlign = 'center';
    g.lineWidth = 5;
    g.strokeStyle = '#0b0b1a';
    const label = `${v.name}${v.role === 2 ? ' ☠' : ''}`;
    g.strokeText(label, 128, 22);
    g.fillStyle = (v.flags & FL.hunted) !== 0 ? '#ffd23f' : friend ? '#9bf08a' : '#ffffff';
    g.fillText(label, 128, 22);
    // level and health
    g.fillStyle = '#0b0b1a';
    g.fillRect(34, 32, 188, 14);
    g.fillStyle = friend ? '#58c23a' : '#e5483a';
    g.fillRect(36, 34, Math.max(0, (184 * v.hp) / 100), 10);
    g.font = 'bold 16px "Courier New", monospace';
    const sub = v.role === 2 ? `Tier ${v.tier}` : `Lv ${v.level}`;
    g.strokeText(sub, 128, 60);
    g.fillStyle = '#cfe3ff';
    g.fillText(sub, 128, 60);
    g.font = '20px sans-serif';
    if ((v.flags & FL.hunted) !== 0) g.fillText('🎯', 238, 22);
    if (v.speaking) g.fillText('🔊', 18, 24);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  private buildFighterRig(role: number, animal: string, swarm: string | undefined, tier: number): Rig {
    return role === 2 ? makeLeaderRig(swarm ?? 'rat', tier) : makePlayerRig(animal);
  }

  /** Create or refresh the models for the roster. */
  setRoster(list: { id: string; name: string; animal: string; team: number; role: number; swarm?: string; tier?: number }[], selfId: string) {
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
      const tier = r.tier ?? 1;
      if (v && (v.role !== r.role || v.swarm !== r.swarm || v.tier !== tier)) {
        this.scene.remove(v.group, v.shadow);
        v = undefined;
      }
      if (!v) {
        const rig = this.buildFighterRig(r.role, r.animal, r.swarm, tier);
        const group = new THREE.Group();
        group.add(rig.root);
        const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: undefined, transparent: true, depthWrite: false, depthTest: false }));
        plate.scale.set(2.8, 0.7, 1);
        plate.renderOrder = 20;
        group.add(plate);
        const shadow = this.makeShadow(rig.radius * 1.1);
        const old = this.fighters.get(r.id);
        v = {
          id: r.id, name: r.name, animal: r.animal, team: r.team, role: r.role, swarm: r.swarm, tier, rig, group, plate, plateKey: '', shadow,
          x: old?.x ?? 0, z: old?.z ?? 0, tx: old?.tx ?? 0, tz: old?.tz ?? 0, yaw: old?.yaw ?? 0, tyaw: old?.tyaw ?? 0, hp: 100, level: old?.level ?? 1, flags: 0, speed: 0,
          seen: old?.seen ?? 0, attack: 0, hurt: 0, self: r.id === selfId, swim: false, lastX: old?.x ?? 0, lastZ: old?.z ?? 0, speedS: 0, speaking: false, cue: null, guard: false, guardStart: -9, jy: 0, vy: 0, shield: this.makeShield(),
        };
        group.add(v.shield);
        plate.position.y = rig.height + 0.3;
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

  /** Mark on the ground where a move is about to land, fading in as the wind-up runs out. */
  telegraph(x: number, z: number, yaw: number, tg: Telegraph, wind: number, hostile: boolean, heavy: boolean) {
    const g = new THREE.Group();
    const mats: THREE.MeshBasicMaterial[] = [];
    const mk = (geo: THREE.BufferGeometry, op: number) => {
      const mat = new THREE.MeshBasicMaterial({ color: hostile ? (heavy ? 0xff3a1a : 0xff6a3a) : 0xffe9a8, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      mats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 3;
      return m;
    };
    if (tg.shape === 'arc') {
      const a = (tg.arc * Math.PI) / 180;
      g.add(mk(new THREE.RingGeometry(0.1, tg.r, 28, 1, -a / 2, a), 0.34));
      g.add(mk(new THREE.RingGeometry(tg.r - 0.18, tg.r, 28, 1, -a / 2, a), 0.7));
    } else if (tg.shape === 'circle') {
      g.add(mk(new THREE.CircleGeometry(tg.r, 32), 0.28));
      g.add(mk(new THREE.RingGeometry(tg.r - 0.22, tg.r, 40), 0.7));
    } else {
      const bar = mk(new THREE.PlaneGeometry(tg.r, tg.width), 0.32);
      bar.position.x = tg.r / 2;
      g.add(bar);
    }
    g.position.set(x, this.groundY(x, z) + 0.12, z);
    g.rotation.y = yaw - Math.PI / 2;
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

  fighter(id: string) {
    return this.fighters.get(id);
  }
  allFighters() {
    return this.fighters.values();
  }

  /** Server says where the other fighters are. */
  applyFighters(list: [string, number, number, number, number, number, number, number][], now: number) {
    for (const [id, x, z, yaw, hp, lvl, flags, jy] of list) {
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

  applyMobs(list: [number, number, number, number, number, number, number][], now: number) {
    for (const [id, def, x, z, yaw, hp, flags] of list) {
      let v = this.mobs.get(id);
      if (!v) {
        const defId = def === this.mobIds.length ? 'warden' : this.mobIds[def];
        const rig = makeMobRig(defId);
        const group = new THREE.Group();
        group.add(rig.root);
        const big = defId.startsWith('alpha') || defId === 'warden' || defId === 'wildpig' || defId === 'heron' || defId === 'pike';
        const shadow = big || defId === 'fox' || defId === 'goat' || defId === 'rabbit' || defId === 'duck' ? this.makeShadow(Math.max(0.3, rig.radius)) : null;
        v = {
          id, def, rig, group, shadow, x, z, tx: x, tz: z, yaw, tyaw: yaw, seen: now, speedS: 0, lastX: x, lastZ: z, attack: 0, hurt: 0, flags,
          flee: false, aquatic: ['minnow', 'perch', 'pike', 'swarm_fish'].includes(defId), flies: ['sparrow', 'swarm_bird', 'swarm_fish'].includes(defId), hp: 100, barHp: 100, big, cue: null, warnUntil: 0,
        };
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
    g.fillStyle = '#0b0b1a';
    g.fillRect(0, 0, 64, 8);
    g.fillStyle = '#e5483a';
    g.fillRect(1, 1, Math.max(0, 62 * pct / 100), 6);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  }

  private dropMesh(kind: string): THREE.Group {
    const g = new THREE.Group();
    const m = (c: number) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: c, emissiveIntensity: 0.25 });
    switch (kind) {
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

  applyDrops(list: [number, string, number, number, number][], now: number) {
    for (const [id, kind, x, z] of list) {
      let d = this.drops.get(id);
      if (!d) {
        const g = this.dropMesh(kind);
        this.scene.add(g);
        d = { g, kind, seen: now, y0: 0 };
        this.drops.set(id, d);
      }
      d.g.position.set(x, this.groundY(x, z) + 0.45, z);
      d.y0 = d.g.position.y;
      d.seen = now;
    }
  }

  groundY(x: number, z: number): number {
    if (x > GULAG_X - 400) return 0;
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

  floater(x: number, y: number, z: number, text: string, color: string, size = 1) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.font = 'bold 34px "Courier New", monospace';
    g.textAlign = 'center';
    g.lineWidth = 6;
    g.strokeStyle = '#0b0b1a';
    g.strokeText(text, 64, 36);
    g.fillStyle = color;
    g.fillText(text, 64, 36);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    s.scale.set(1.8 * size, 0.68 * size, 1);
    s.position.set(x, y, z);
    s.renderOrder = 30;
    this.scene.add(s);
    this.floaters.push({ s, vy: 2.2, life: 0, max: 0.9 });
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
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0xe8b830, emissive: 0x553300 }));
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
      const visible = v.self || now - v.seen < 0.7;
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
      const aquaticBody = v.role === 2 && v.swarm === 'shoal';
      const bird = v.role === 2 && v.swarm === 'bird';
      const depth = Math.max(0, WATER_Y - this.terrain.heightAt(v.x, v.z));
      v.swim = v.x < GULAG_X - 400 && depth > 0.4;
      const y = ground - (v.swim ? Math.min(0.5, depth * 0.3) : 0) + (aquaticBody ? 1.1 : 0) + (bird ? 1.6 : 0);
      const prevJy = v.jy;
      v.group.position.set(v.x, y + v.jy, v.z);
      v.group.rotation.y = v.yaw;
      v.shadow.position.set(v.x, ground + 0.06, v.z);
      v.shadow.scale.setScalar(Math.max(0.45, 1 - v.jy * 0.25));
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
      const st: RigState = { speed: v.speedS, attack: v.attack, hurt: v.hurt, stun: (v.flags & FL.stun) !== 0, flee: false, swim: v.swim, t: now, pose, guard: guarding, air: v.jy, vy: v.vy, warn, counter: (v.flags & FL.counter) !== 0 };
      v.rig.update(dt, st);
      v.rig.setTint((v.flags & FL.marked) !== 0 ? 0xffd23f : (v.flags & FL.hunted) !== 0 ? 0xff7a1a : null);
      // hide models in bushes/underwater from far away is the server's job; here just the plate
      const key = `${v.hp}|${v.level}|${v.flags & 1}|${v.role}|${v.tier}|${mineTeam}`;
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
      if (now - v.seen > 0.6) {
        this.scene.remove(v.group);
        if (v.shadow) this.scene.remove(v.shadow);
        this.mobs.delete(id);
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
      v.rig.update(dt, { speed: v.speedS, attack: v.attack, hurt: v.hurt, stun: (v.flags & 32) !== 0, flee: v.flee, swim: false, t: now, pose: mpose, warn: mwarn });
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
        this.scene.remove(d.g);
        this.drops.delete(id);
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
    const under = this.camera.position.y < WATER_Y && this.camera.position.x < GULAG_X - 400;
    if (under) {
      this.fog.color.setHex(0x2a6f86);
      this.fog.near = 2;
      this.fog.far = 30;
      (this.scene.background as THREE.Color).setHex(0x2a6f86);
    } else if (this.gulagLook) {
      this.fog.color.setHex(0x8a8f96);
      this.fog.near = 40;
      this.fog.far = 220;
      (this.scene.background as THREE.Color).setHex(0x8a8f96);
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
