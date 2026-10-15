import * as THREE from 'three';
import type { Box, Disc } from './collision';

/**
 * The lobby map: a night-time California waterfront plaza and a small public aquarium.
 * Everything is generated in code (no image files). It is an original, low-res "retro 3D"
 * scene inspired by Pacific-coast ocean-education centres; it is a fan tribute and not
 * affiliated with any real aquarium.
 *
 * Coordinates: x east, z south (+z is toward the harbor), y up. The aquarium occupies
 * x in [-30, 30], z in [-45, 5]; the plaza and harbor railing are at z > 5.
 */

export interface Aquarium {
  update(t: number, dt: number): void;
  boxes: Box[];
  discs: Disc[];
}

type Anim = (t: number, dt: number) => void;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20240607);
const rr = (a: number, b: number) => a + (b - a) * rand();
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

// ---------------------------------------------------------------- textures

interface TexOpts {
  nearest?: boolean; // crisp pixels at every distance (murals, screens)
  repeat?: [number, number];
  aniso?: number;
}

function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  o: TexOpts = {},
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  if (o.nearest) tex.minFilter = THREE.NearestFilter;
  if (o.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(o.repeat[0], o.repeat[1]);
  }
  tex.anisotropy = o.aniso ?? 1;
  return tex;
}

function checkerTexture(a: string, b: string, repeat: [number, number], aniso: number) {
  return canvasTexture(
    64,
    64,
    (g) => {
      g.fillStyle = a;
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = b;
      g.fillRect(0, 0, 32, 32);
      g.fillRect(32, 32, 32, 32);
      // faint grout so the tiles read at low resolution
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(31, 0, 2, 64);
      g.fillRect(0, 31, 64, 2);
    },
    { repeat, aniso },
  );
}

function tileWallTexture(aniso: number) {
  return canvasTexture(
    64,
    64,
    (g) => {
      g.fillStyle = '#c4dde6';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#7ea3b3';
      for (let i = 0; i < 64; i += 16) {
        g.fillRect(i, 0, 1, 64);
        g.fillRect(0, i, 64, 1);
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 1; i < 64; i += 16) g.fillRect(i, 1, 14, 2);
    },
    { repeat: [1, 1], aniso },
  );
}

function concreteTexture() {
  return canvasTexture(
    64,
    64,
    (g) => {
      g.fillStyle = '#5b6578';
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${rr(0.03, 0.12)})`;
        g.fillRect(rr(0, 64), rr(0, 64), 2, 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 31, 64, 1);
      g.fillRect(31, 0, 1, 31);
      g.fillRect(15, 32, 1, 32);
      g.fillRect(47, 32, 1, 32);
    },
    { repeat: [1, 1] },
  );
}

function sandTexture() {
  return canvasTexture(
    64,
    64,
    (g) => {
      g.fillStyle = '#d6c48f';
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 380; i++) {
        g.fillStyle = `rgba(${rand() < 0.5 ? '255,245,200' : '120,95,50'},${rr(0.08, 0.3)})`;
        g.fillRect(rr(0, 64), rr(0, 64), 2, 1);
      }
      g.strokeStyle = 'rgba(255,255,255,0.18)'; // ripples
      for (let y = 6; y < 64; y += 12) {
        g.beginPath();
        for (let x = 0; x <= 64; x += 4) g.lineTo(x, y + Math.sin(x * 0.4 + y) * 2);
        g.stroke();
      }
    },
    { repeat: [1, 1] },
  );
}

function gradientTexture(top: string, bottom: string) {
  return canvasTexture(
    2,
    64,
    (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, top);
      gr.addColorStop(1, bottom);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
    { nearest: true },
  );
}

function skyTexture() {
  const t = canvasTexture(
    4,
    256,
    (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#040824'); // zenith
      gr.addColorStop(0.45, '#0e2a66');
      gr.addColorStop(0.7, '#1c6a9a'); // horizon glow
      gr.addColorStop(1, '#0a1d44');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
    { nearest: true },
  );
  t.magFilter = THREE.LinearFilter;
  return t;
}

function glowTexture(color = '255,255,255') {
  return canvasTexture(
    64,
    64,
    (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${color},1)`);
      gr.addColorStop(0.25, `rgba(${color},0.5)`);
      gr.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
    },
    {},
  );
}

function floorGlowTexture(color: string) {
  return canvasTexture(
    64,
    8,
    (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
    {},
  );
}

function waterSurfaceTexture() {
  return canvasTexture(
    128,
    128,
    (g) => {
      g.fillStyle = '#0c2e63';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 90; i++) {
        g.fillStyle = `rgba(${pick(['120,200,255', '255,255,255', '60,140,220'])},${rr(0.1, 0.4)})`;
        g.fillRect(rr(0, 128), rr(0, 128), rr(3, 14), 2);
      }
    },
    { repeat: [60, 30] },
  );
}

function kelpTexture() {
  return canvasTexture(
    32,
    128,
    (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#4a7a22';
      g.fillRect(15, 0, 2, h); // stalk
      for (let y = 8; y < h; y += 14) {
        const side = (y / 14) % 2 === 0 ? -1 : 1;
        g.fillStyle = y % 28 === 8 ? '#7aa82e' : '#5f9a2a';
        g.beginPath();
        g.ellipse(16 + side * 7, y, 8, 4, side * 0.5, 0, Math.PI * 2);
        g.fill();
      }
    },
    { nearest: true },
  );
}

function drawMural(g: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const r = mulberry32(seed);
  const R = (a: number, b: number) => a + (b - a) * r();
  const P = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#14316e');
  bg.addColorStop(0.5, '#1c7f93');
  bg.addColorStop(1, '#5a2a8c');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.lineJoin = 'round';

  // wave bands
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = P(['#35e0d0', '#ffd23f', '#ff5d9a', '#9a7bff']);
    g.lineWidth = 3;
    g.beginPath();
    const y0 = R(0, h);
    for (let x = 0; x <= w; x += 4) g.lineTo(x, y0 + Math.sin(x * 0.12 + i) * 5);
    g.stroke();
  }
  // coral blobs
  for (let i = 0; i < 12; i++) {
    const cx = R(0, w);
    const cy = R(h * 0.35, h);
    const col = P(['#ff4d3d', '#ff8a1f', '#ffd23f', '#ff4f9a', '#7be05a']);
    g.fillStyle = col;
    g.strokeStyle = '#05050f';
    g.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(cx + R(-12, 12), cy + R(-10, 10), R(6, 13), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#fff3b0';
    for (let k = 0; k < 5; k++) g.fillRect(cx + R(-12, 12), cy + R(-10, 10), 2, 2);
  }
  // bold outlined fish
  for (let i = 0; i < 4; i++) {
    const fx = R(20, w - 20);
    const fy = R(10, h - 20);
    const s = R(0.8, 1.5);
    const col = P(['#ff7a1a', '#ffd23f', '#35e0d0', '#ff5d9a']);
    g.save();
    g.translate(fx, fy);
    g.scale(r() < 0.5 ? s : -s, s);
    g.fillStyle = col;
    g.strokeStyle = '#05050f';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(0, 0, 18, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(-16, 0);
    g.lineTo(-30, -9);
    g.lineTo(-30, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fillRect(-4, -8, 4, 16); // stripe
    g.fillStyle = '#05050f';
    g.fillRect(9, -3, 3, 3); // eye
    g.restore();
  }
  // paint drips
  for (let i = 0; i < 26; i++) {
    const x = R(0, w);
    const y = R(h * 0.2, h * 0.8);
    const len = R(6, 26);
    g.strokeStyle = P(['#ff4d3d', '#ffd23f', '#35e0d0', '#ff5d9a', '#ffffff']);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y + len);
    g.stroke();
    g.fillStyle = g.strokeStyle;
    g.fillRect(x - 1, y + len, 3, 3);
  }
}

function drawSign(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#06123a';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#4de3ff';
  g.lineWidth = 8;
  g.strokeRect(10, 10, w - 20, h - 20);
  g.strokeStyle = '#ff6fb5';
  g.lineWidth = 3;
  g.strokeRect(22, 22, w - 44, h - 44);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 104px Impact, "Arial Black", sans-serif';
  g.lineWidth = 10;
  g.strokeStyle = '#0a4a8a';
  g.strokeText('PACIFIC HARBOR', w / 2, h * 0.36);
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#7ff0ff');
  gr.addColorStop(0.5, '#ffffff');
  gr.addColorStop(1, '#ffa8e0');
  g.fillStyle = gr;
  g.fillText('PACIFIC HARBOR', w / 2, h * 0.36);
  g.font = '900 78px Impact, "Arial Black", sans-serif';
  g.strokeText('AQUARIUM', w / 2, h * 0.67);
  g.fillText('AQUARIUM', w / 2, h * 0.67);
  g.font = 'bold 26px "Courier New", monospace';
  g.fillStyle = '#9fdcff';
  g.fillText('OCEAN EDUCATION ON THE CALIFORNIA WATERFRONT', w / 2, h * 0.88);
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
}

interface Fact {
  title: string;
  latin: string;
  body: string;
  color: string; // little fish icon colour
}

function screenTexture(f: Fact) {
  return canvasTexture(
    256,
    128,
    (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2a2cd8');
      gr.addColorStop(1, '#0a0c78');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.strokeRect(2, 2, w - 4, h - 4);
      // fish icon
      g.fillStyle = f.color;
      g.beginPath();
      g.ellipse(36, 64, 26, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(12, 64);
      g.lineTo(-2, 52);
      g.lineTo(-2, 76);
      g.closePath();
      g.fill();
      g.fillStyle = '#05050f';
      g.fillRect(48, 58, 4, 4);
      g.textBaseline = 'top';
      g.fillStyle = '#ffffff';
      g.font = 'bold 17px "Courier New", monospace';
      g.fillText(f.title, 76, 10);
      g.fillStyle = '#a8c8ff';
      g.font = 'italic 11px "Courier New", monospace';
      g.fillText(f.latin, 76, 32);
      g.fillStyle = '#ffffff';
      g.font = '11px "Courier New", monospace';
      wrapText(g, f.body, 76, 50, 172, 13);
    },
    { nearest: true },
  );
}

// ------------------------------------------------------------------ models

const bodyGeo = new THREE.SphereGeometry(0.5, 6, 4);
const tailGeo = new THREE.ConeGeometry(0.3, 0.6, 4).rotateZ(Math.PI / 2).translate(-0.3, 0, 0);
const finGeo = new THREE.ConeGeometry(0.12, 0.3, 3);
const fishMats = new Map<number, THREE.MeshLambertMaterial>();

function fishMat(color: number) {
  let m = fishMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.45 });
    fishMats.set(color, m);
  }
  return m;
}

interface Fish {
  g: THREE.Group;
  tail: THREE.Group;
}

/** A tiny low-poly fish whose body points along local +x. */
function makeFish(color: number, len: number, dorsal = false): Fish {
  const g = new THREE.Group();
  const mat = fishMat(color);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.scale.set(len, len * 0.42, len * 0.22);
  g.add(body);
  const tail = new THREE.Group();
  tail.position.x = -len * 0.42;
  const tm = new THREE.Mesh(tailGeo, mat);
  tm.scale.set(len * 0.6, len * 0.6, len * 0.2);
  tail.add(tm);
  g.add(tail);
  if (dorsal) {
    const fin = new THREE.Mesh(finGeo, mat);
    fin.scale.setScalar(len * 1.6);
    fin.position.set(0, len * 0.22, 0);
    g.add(fin);
  }
  return { g, tail };
}

// -------------------------------------------------------------------- build

export function buildAquarium(scene: THREE.Scene, maxAniso: number): Aquarium {
  const anims: Anim[] = [];
  const boxes: Box[] = [];
  const discs: Disc[] = [];

  const solid = (minX: number, maxX: number, minZ: number, maxZ: number) => boxes.push({ minX, maxX, minZ, maxZ });
  const lambert = (color: number, emissive = 0x000000, ei = 1) =>
    new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: ei });

  // --------------------------------------------------------- sky and light
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(380, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const starPos = new Float32Array(1400 * 3);
  for (let i = 0; i < 1400; i++) {
    const a = rr(0, Math.PI * 2);
    const e = Math.asin(rr(0.08, 1)); // keep stars above the horizon
    starPos[i * 3] = 350 * Math.cos(e) * Math.cos(a);
    starPos[i * 3 + 1] = 350 * Math.sin(e);
    starPos[i * 3 + 2] = 350 * Math.cos(e) * Math.sin(a);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false })));

  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('255,245,210'), fog: false, depthWrite: false, transparent: true }),
  );
  moon.position.set(140, 130, 230);
  moon.scale.set(70, 70, 1);
  scene.add(moon);

  scene.add(new THREE.HemisphereLight(0x8fb6ff, 0x2b3a5c, 1.25));
  const moonLight = new THREE.DirectionalLight(0x86a8ff, 0.8);
  moonLight.position.set(30, 70, 60);
  scene.add(moonLight);

  const hallLights: [number, number][] = [
    [-12, -10],
    [12, -10],
    [-12, -32],
    [12, -32],
  ];
  for (const [x, z] of hallLights) {
    const l = new THREE.PointLight(0xc4ecff, 14, 38, 1.3);
    l.position.set(x, 5.8, z);
    scene.add(l);
  }

  // ------------------------------------------------------ ground and water
  const plazaTex = checkerTexture('#7a6552', '#66533f', [60, 40], maxAniso);
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(240, 158), lambert(0xffffff));
  (plaza.material as THREE.MeshLambertMaterial).map = plazaTex;
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0, -41);
  scene.add(plaza);

  const hallTex = checkerTexture('#d2e9f7', '#7fb6de', [15, 12.5], maxAniso);
  const hallFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 50),
    new THREE.MeshLambertMaterial({
      map: hallTex,
      emissive: 0x3c6a98,
      emissiveIntensity: 0.3,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(0, 0.03, -20);
  scene.add(hallFloor);

  const waterTex = waterSurfaceTexture();
  const harbor = new THREE.Mesh(new THREE.PlaneGeometry(800, 400), new THREE.MeshBasicMaterial({ map: waterTex }));
  harbor.rotation.x = -Math.PI / 2;
  harbor.position.set(0, -0.6, 238);
  scene.add(harbor);
  anims.push((t) => {
    waterTex.offset.set((t * 0.004) % 1, (t * 0.002) % 1);
  });

  // harbor curb + railing (the playable edge)
  const curb = new THREE.Mesh(new THREE.BoxGeometry(110, 1, 1), lambert(0x3a4156));
  curb.position.set(0, -0.5, 38);
  scene.add(curb);
  const railMat = lambert(0x9aa7c0, 0x2a3350, 0.6);
  for (let x = -48; x <= 48; x += 4) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.15, 6), railMat);
    post.position.set(x, 0.58, 37);
    scene.add(post);
  }
  for (const y of [1.1, 0.6]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(100, 0.08, 0.08), railMat);
    rail.position.set(0, y, 37);
    scene.add(rail);
  }
  solid(-60, 60, 36.7, 37.4);

  // boats drifting in the harbor
  for (let i = 0; i < 3; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 2.4), lambert(pick([0xe8e8f0, 0x4a6fd0, 0xd04a4a])));
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 1.8), lambert(0xf2f2ff));
    cabin.position.set(-0.6, 1.1, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 5), lambert(0xcccccc));
    mast.position.set(1.4, 3, 0);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('255,220,140'), transparent: true, depthWrite: false }));
    lamp.position.set(1.4, 5.5, 0);
    lamp.scale.set(3, 3, 1);
    boat.add(hull, cabin, mast, lamp);
    const bx = -70 + i * 70 + rr(-10, 10);
    const bz = 70 + i * 28;
    const ph = rr(0, 6);
    boat.position.set(bx, -0.1, bz);
    boat.rotation.y = rr(-0.3, 0.3);
    scene.add(boat);
    anims.push((t) => {
      boat.position.y = -0.1 + Math.sin(t * 0.7 + ph) * 0.12;
      boat.rotation.z = Math.sin(t * 0.5 + ph) * 0.03;
      boat.position.x = bx + Math.sin(t * 0.05 + ph) * 6;
    });
  }

  // ------------------------------------------------------ building shell
  const tileTex = tileWallTexture(maxAniso);
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  const concrete = concreteTexture();
  concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping;

  /** A one-sided plane whose texture repeats every `tile` metres. */
  const wall = (
    w: number,
    h: number,
    tex: THREE.Texture,
    tile: number,
    pos: [number, number, number],
    rotY: number,
    opts: { rotX?: number; double?: boolean; emissive?: number } = {},
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        map: tex,
        side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: 0.6,
      }),
    );
    m.position.set(...pos);
    m.rotation.set(opts.rotX ?? 0, rotY, 0);
    scene.add(m);
    return m;
  };

  const H = 7; // wall height
  // interior tile walls
  wall(50, H, tileTex, 4, [-29.7, H / 2, -20], Math.PI / 2, { emissive: 0x2a4a68 }); // west
  wall(50, H, tileTex, 4, [29.7, H / 2, -20], -Math.PI / 2, { emissive: 0x2a4a68 }); // east
  wall(60, H, tileTex, 4, [0, H / 2, -44.7], 0, { emissive: 0x2a4a68 }); // back
  // exterior concrete
  wall(50.6, 7.4, concrete, 6, [-30.3, 3.7, -20], -Math.PI / 2);
  wall(50.6, 7.4, concrete, 6, [30.3, 3.7, -20], Math.PI / 2);
  wall(61, 7.4, concrete, 6, [0, 3.7, -45.3], Math.PI);
  // roof + ceiling
  wall(61, 51, concrete, 6, [0, 7.4, -20], 0, { rotX: -Math.PI / 2 });
  const ceilMat = new THREE.MeshLambertMaterial({ color: 0x1e2838, emissive: 0x0c1220 });
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(60, 50), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, -20);
  scene.add(ceiling);
  // teal stripe band on the interior walls
  const bandMat = new THREE.MeshLambertMaterial({ color: 0x1f8fa6, emissive: 0x0e4a58 });
  for (const [w, pos, ry] of [
    [50, [-29.65, 1.2, -20], Math.PI / 2],
    [50, [29.65, 1.2, -20], -Math.PI / 2],
    [60, [0, 1.2, -44.65], 0],
  ] as [number, [number, number, number], number][]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.7), bandMat);
    band.position.set(...pos);
    band.rotation.y = ry;
    scene.add(band);
  }

  // perimeter colliders
  solid(-30.6, -29.5, -45.6, 5.6);
  solid(29.5, 30.6, -45.6, 5.6);
  solid(-30.6, 30.6, -45.6, -44.5);

  // fluorescent strips
  const stripGeo = new THREE.BoxGeometry(0.35, 0.12, 6);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  for (const x of [-12, 0, 12]) {
    for (let z = -2; z > -44; z -= 9) {
      const s = new THREE.Mesh(stripGeo, stripMat);
      s.position.set(x, H - 0.15, z);
      scene.add(s);
    }
  }

  // ---------------------------------------------------- front facade + arch
  const muralTex = canvasTexture(256, 128, (g, w, h) => drawMural(g, w, h, 7), { nearest: true });
  const muralTex2 = canvasTexture(256, 128, (g, w, h) => drawMural(g, w, h, 99), { nearest: true });
  const muralMat = new THREE.MeshLambertMaterial({ map: muralTex, emissive: 0x303030 });

  const glassTex = canvasTexture(
    128,
    128,
    (g, w, h) => {
      g.fillStyle = 'rgba(70,170,255,0.16)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(210,225,240,0.9)';
      g.lineWidth = 3;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.beginPath();
      g.moveTo(w / 2, 0);
      g.lineTo(w / 2, h);
      g.stroke();
    },
    { repeat: [1, 1], nearest: true },
  );
  const addGlass = (x0: number, x1: number) => {
    const w = x1 - x0;
    const geo = new THREE.PlaneGeometry(w, 6);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 4, uv.getY(i) * 2);
    glassTex.wrapS = glassTex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: glassTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    m.position.set((x0 + x1) / 2, 4, 5.3);
    m.renderOrder = 5;
    scene.add(m);
  };
  addGlass(-30, -6);
  addGlass(6, 30);
  for (const [x0, x1] of [
    [-30, -6],
    [6, 30],
  ]) {
    const kick = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1, 0.6), lambert(0x2a3350));
    kick.position.set((x0 + x1) / 2, 0.5, 5.3);
    scene.add(kick);
  }
  // mural arch pillars + lintel
  for (const x of [-5, 5]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(2, H, 1.4), muralMat);
    pillar.position.set(x, H / 2, 5.3);
    scene.add(pillar);
  }
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1.6, 1.4),
    new THREE.MeshLambertMaterial({ map: muralTex2, emissive: 0x303030 }),
  );
  lintel.position.set(0, H - 0.8, 5.3);
  scene.add(lintel);
  solid(-30.6, -3.9, 4.5, 6.1);
  solid(3.9, 30.6, 4.5, 6.1);

  // signboard block + glowing sign
  const signBlock = new THREE.Mesh(new THREE.BoxGeometry(34, 4.4, 1.4), lambert(0x222b4a, 0x0a1230));
  signBlock.position.set(0, H + 2.2, 5.3);
  scene.add(signBlock);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 5),
    new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 320, drawSign, { nearest: true }), toneMapped: false }),
  );
  sign.position.set(0, H + 2.3, 6.05);
  scene.add(sign);
  const signGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture('80,200,255'), transparent: true, depthWrite: false, opacity: 0.55 }),
  );
  signGlow.position.set(0, H + 2.3, 6.4);
  signGlow.scale.set(30, 12, 1);
  scene.add(signGlow);
  anims.push((t) => {
    signGlow.material.opacity = 0.5 + Math.sin(t * 2.2) * 0.06;
  });

  // door-gap light spilling onto the plaza
  const spill = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({
      map: glowTexture('120,200,255'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.5,
    }),
  );
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(0, 0.05, 11);
  scene.add(spill);

  // ------------------------------------------------------------- screens
  const frameMat = lambert(0x0b0e18);
  const addScreen = (fact: Fact, pos: [number, number, number], rotY: number, w = 3.4, h = 1.7) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.12), frameMat);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: screenTexture(fact), toneMapped: false }),
    );
    face.position.z = 0.07;
    g.add(frame, face);
    g.position.set(...pos);
    g.rotation.y = rotY;
    scene.add(g);
  };

  const FACTS = {
    welcome: {
      title: 'WELCOME!',
      latin: 'Pacific Harbor Aquarium',
      body: 'Ocean education on the California waterfront. Walk close to someone to talk. Walk away and their voice fades out.',
      color: '#ffd23f',
    },
    leopard: {
      title: 'Leopard shark',
      latin: 'Triakis semifasciata',
      body: 'Common in California bays and estuaries. Spotted saddles on its back. It eats clams, worms, crabs and fish eggs.',
      color: '#c9b38a',
    },
    horn: {
      title: 'Horn shark',
      latin: 'Heterodontus francisci',
      body: 'A Southern California shark. Mothers wedge spiral egg cases into rocky crevices to keep them safe.',
      color: '#9a8c70',
    },
    batray: {
      title: 'Bat ray',
      latin: 'Myliobatis californica',
      body: 'Glides by flapping its wing-like fins. Hunts shellfish buried in sandy bays.',
      color: '#7a8aa6',
    },
    kelp: {
      title: 'Giant kelp',
      latin: 'Macrocystis pyrifera',
      body: 'One of the fastest-growing organisms on Earth: up to two feet a day. Its forests shelter hundreds of species.',
      color: '#7aa82e',
    },
    garibaldi: {
      title: 'Garibaldi',
      latin: 'Hypsypops rubicundus',
      body: "California's official marine fish. Males guard a tidy algae nest until the eggs hatch.",
      color: '#ff7a1a',
    },
    bass: {
      title: 'Kelp bass',
      latin: 'Paralabrax clathratus',
      body: 'Ambushes small fish among the kelp stalks. A favorite of Southern California anglers.',
      color: '#9a8a55',
    },
    jelly: {
      title: 'Moon jelly',
      latin: 'Aurelia aurita',
      body: 'About 95 percent water, with no brain and no heart. It pulses its bell to drift along.',
      color: '#c8b8ff',
    },
    nettle: {
      title: 'Pacific sea nettle',
      latin: 'Chrysaora fuscescens',
      body: 'Long ruffled arms trail behind its bell. Drifts along the California coast.',
      color: '#ff8a5c',
    },
    sardine: {
      title: 'Pacific sardine',
      latin: 'Sardinops sagax',
      body: 'Swims in huge schools that move as one, which confuses hungry predators.',
      color: '#b9d4f2',
    },
    touch: {
      title: 'Touch pool',
      latin: 'Gentle hands only',
      body: 'Two fingers, soft touch. Keep your sleeves dry. The rays are watching you right back.',
      color: '#7a8aa6',
    },
  } satisfies Record<string, Fact>;

  // kiosk on the plaza facing the spawn area
  {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), frameMat);
    post.position.set(7.5, 0.8, 12);
    scene.add(post);
    addScreen(FACTS.welcome, [7.5, 2.3, 12], 0, 3.4, 1.7);
    solid(7, 8, 11.6, 12.4);
  }

  // -------------------------------------------------------------- tanks
  interface TankCfg {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    y0: number;
    y1: number;
    face: '+x' | '-x' | '+z'; // which side visitors stand on
    top: string;
    bottom: string;
    glow: string;
    sand?: boolean;
  }

  const cabinetMat = new THREE.MeshLambertMaterial({ color: 0x1d6f84, emissive: 0x0a2e38 });
  const darkMat = lambert(0x10141f);
  const canopyMat = new THREE.MeshBasicMaterial({ color: 0xcfeaff });

  const addTank = (c: TankCfg) => {
    const w = c.x1 - c.x0;
    const d = c.z1 - c.z0;
    const h = c.y1 - c.y0;
    const cx = (c.x0 + c.x1) / 2;
    const cz = (c.z0 + c.z1) / 2;

    const water = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ map: gradientTexture(c.top, c.bottom), side: THREE.BackSide }),
    );
    water.position.set(cx, c.y0 + h / 2, cz);
    scene.add(water);

    if (c.sand !== false) {
      const sandTex = sandTexture();
      sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
      sandTex.repeat.set(w / 3, d / 3);
      const sand = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshBasicMaterial({ map: sandTex, color: 0xa9c4d8 }),
      );
      sand.rotation.x = -Math.PI / 2;
      sand.position.set(cx, c.y0 + 0.08, cz);
      scene.add(sand);
      // rocks
      const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a7486, emissive: 0x14222c, flatShading: true });
      for (let i = 0; i < Math.round((w * d) / 12); i++) {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), rockMat);
        rock.scale.set(rr(0.4, 1.3), rr(0.3, 0.9), rr(0.4, 1.2));
        rock.position.set(rr(c.x0 + 0.8, c.x1 - 0.8), c.y0 + 0.1, rr(c.z0 + 0.8, c.z1 - 0.8));
        rock.rotation.y = rr(0, 6);
        scene.add(rock);
      }
    }

    // cabinet below, housing above, end caps and a lit canopy
    const cab = new THREE.Mesh(new THREE.BoxGeometry(w, c.y0, d), cabinetMat);
    cab.position.set(cx, c.y0 / 2, cz);
    scene.add(cab);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(w, H - c.y1, d), darkMat);
    housing.position.set(cx, (H + c.y1) / 2, cz);
    scene.add(housing);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 0.1, d - 0.2), canopyMat);
    canopy.position.set(cx, c.y1 - 0.05, cz);
    scene.add(canopy);
    const capH = c.y1 - c.y0 + 0.4;
    if (c.face === '+z') {
      for (const x of [c.x0 - 0.15, c.x1 + 0.15]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, capH, d), darkMat);
        cap.position.set(x, c.y0 + capH / 2 - 0.2, cz);
        scene.add(cap);
      }
    } else {
      for (const z of [c.z0 - 0.15, c.z1 + 0.15]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w, capH, 0.3), darkMat);
        cap.position.set(cx, c.y0 + capH / 2 - 0.2, z);
        scene.add(cap);
      }
    }

    // viewing ledge (also the collider that keeps people off the glass)
    const ledgeT = 0.9;
    let lx0 = c.x0;
    let lx1 = c.x1;
    let lz0 = c.z0;
    let lz1 = c.z1;
    if (c.face === '+x') {
      lx0 = c.x1;
      lx1 = c.x1 + ledgeT;
    } else if (c.face === '-x') {
      lx1 = c.x0;
      lx0 = c.x0 - ledgeT;
    } else {
      lz0 = c.z1;
      lz1 = c.z1 + ledgeT;
    }
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(lx1 - lx0, 1.0, lz1 - lz0), new THREE.MeshLambertMaterial({ color: 0x1f8fa6, emissive: 0x0e4a58 }));
    ledge.position.set((lx0 + lx1) / 2, 0.5, (lz0 + lz1) / 2);
    scene.add(ledge);
    solid(Math.min(c.x0, lx0), Math.max(c.x1, lx1), Math.min(c.z0, lz0), Math.max(c.z1, lz1));

    // light pooled on the floor in front
    const glowLen = c.face === '+z' ? w : d;
    const gl = new THREE.Mesh(
      new THREE.PlaneGeometry(7, glowLen),
      new THREE.MeshBasicMaterial({
        map: floorGlowTexture(c.glow),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.5,
      }),
    );
    gl.geometry.rotateX(-Math.PI / 2);
    // geometry is 7 (x) by glowLen (z); for +z faces we need the long side along x
    if (c.face === '+z') gl.geometry.rotateY(Math.PI / 2);
    gl.geometry.translate(3.5, 0, 0);
    if (c.face === '+x') gl.position.set(c.x1 + ledgeT - 0.1, 0.06, cz);
    if (c.face === '-x') {
      gl.rotation.y = Math.PI;
      gl.position.set(c.x0 - ledgeT + 0.1, 0.06, cz);
    }
    if (c.face === '+z') {
      gl.geometry.rotateY(-Math.PI / 2);
      gl.geometry.rotateY(-Math.PI / 2);
      gl.position.set(cx, 0.06, c.z1 + ledgeT - 0.1);
    }
    scene.add(gl);
    return { cx, cz };
  };

  // --- fish helpers ---
  const addFish = (f: Fish) => {
    scene.add(f.g);
    return f;
  };

  const swimLine = (
    f: Fish,
    o: { axis: 'x' | 'z'; min: number; max: number; lane: [number, number]; y: [number, number]; speed: number },
  ) => {
    let p = rr(o.min, o.max);
    let dir = rand() < 0.5 ? 1 : -1;
    const lane = rr(o.lane[0], o.lane[1]);
    const yc = rr(o.y[0], o.y[1]);
    const amp = rr(0.1, 0.45);
    const ph = rr(0, 6.28);
    const sp = o.speed * rr(0.7, 1.3);
    anims.push((t, dt) => {
      p += dir * sp * dt;
      if (p > o.max) {
        p = o.max;
        dir = -1;
      } else if (p < o.min) {
        p = o.min;
        dir = 1;
      }
      const drift = Math.sin(t * 0.4 + ph) * 0.5;
      const y = yc + Math.sin(t * 0.6 + ph) * amp;
      if (o.axis === 'x') {
        f.g.position.set(p, y, lane + drift);
        f.g.rotation.y = dir > 0 ? 0 : Math.PI;
      } else {
        f.g.position.set(lane + drift, y, p);
        f.g.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      f.tail.rotation.y = Math.sin(t * (4 + sp * 2.5) + ph) * 0.55;
    });
  };

  const orbit = (f: Fish, cx: number, cz: number, r: number, y: [number, number], w: number) => {
    let a = rr(0, 6.28);
    const yc = rr(y[0], y[1]);
    const ph = rr(0, 6.28);
    anims.push((t, dt) => {
      a += w * dt;
      f.g.position.set(cx + Math.cos(a) * r, yc + Math.sin(t * 0.5 + ph) * 0.35, cz + Math.sin(a) * r);
      f.g.rotation.y = -Math.atan2(Math.cos(a) * Math.sign(w), -Math.sin(a) * Math.sign(w));
      f.tail.rotation.y = Math.sin(t * 7 + ph) * 0.5;
    });
  };

  const rayShape = new THREE.Shape();
  rayShape.moveTo(0.9, 0);
  rayShape.lineTo(0.1, 0.75);
  rayShape.lineTo(-0.7, 0.1);
  rayShape.lineTo(-0.7, -0.1);
  rayShape.lineTo(0.1, -0.75);
  rayShape.closePath();
  const rayGeo = new THREE.ShapeGeometry(rayShape).rotateX(-Math.PI / 2);
  const makeRay = (color: number, s: number): Fish => {
    const g = new THREE.Group();
    const wings = new THREE.Mesh(
      rayGeo,
      new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.4, side: THREE.DoubleSide }),
    );
    wings.scale.setScalar(s);
    g.add(wings);
    const tail = new THREE.Group();
    const tl = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * s, 0.04 * s, 1.1 * s, 4).rotateZ(Math.PI / 2), fishMat(color));
    tl.position.x = -1.2 * s;
    tail.add(tl);
    tail.position.x = -0.1 * s;
    g.add(tail);
    anims.push((t) => {
      wings.scale.z = s * (1 + Math.sin(t * 2.5 + s * 5) * 0.18);
      wings.rotation.z = Math.sin(t * 2.5 + s * 5) * 0.08;
    });
    return { g, tail };
  };

  const kelpTex = kelpTexture();
  const kelpMats = [0xffffff, 0xd8ffb0, 0xb8e890].map(
    (c) => new THREE.MeshBasicMaterial({ map: kelpTex, color: c, alphaTest: 0.5, side: THREE.DoubleSide }),
  );
  const addKelp = (x: number, y: number, z: number, h: number) => {
    const geo = new THREE.PlaneGeometry(0.9, h).translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, pick(kelpMats));
    m.rotation.order = 'YXZ';
    m.rotation.y = rr(0, Math.PI);
    m.position.set(x, y, z);
    scene.add(m);
    const ph = rr(0, 6.28);
    const sw = rr(0.06, 0.12);
    anims.push((t) => {
      m.rotation.z = Math.sin(t * 0.8 + ph) * sw;
      m.rotation.x = Math.cos(t * 0.6 + ph) * sw * 0.7;
    });
  };

  const jellyBellGeo = new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const tentGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 3).translate(0, -0.5, 0);
  const addJelly = (
    r: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number },
    color: number,
    size: number,
  ) => {
    const g = new THREE.Group();
    const bell = new THREE.Mesh(
      jellyBellGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
    );
    bell.scale.setScalar(size);
    g.add(bell);
    const tentMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const tents: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(tentGeo, tentMat);
      const a = (i / 6) * Math.PI * 2;
      t.position.set(Math.cos(a) * size * 0.3, 0, Math.sin(a) * size * 0.3);
      t.scale.set(1, size * rr(1.2, 2.2), 1);
      g.add(t);
      tents.push(t);
    }
    scene.add(g);
    let x = rr(r.x0, r.x1);
    let z = rr(r.z0, r.z1);
    const yc = rr(r.y0 + 1, r.y1 - 1);
    let vx = rr(-0.25, 0.25);
    let vz = rr(-0.25, 0.25);
    const ph = rr(0, 6.28);
    anims.push((t, dt) => {
      x += vx * dt;
      z += vz * dt;
      if (x < r.x0 || x > r.x1) vx = -vx;
      if (z < r.z0 || z > r.z1) vz = -vz;
      const pulse = Math.sin(t * 1.6 + ph);
      g.position.set(x, yc + pulse * 0.5, z);
      bell.scale.set(size * (1 - pulse * 0.08), size * (1 + pulse * 0.14), size * (1 - pulse * 0.08));
      tents.forEach((tm, i) => (tm.rotation.z = Math.sin(t * 1.2 + i + ph) * 0.15));
    });
  };

  // ---- WEST WALL: Shark Lagoon ----
  const SH = { x0: -29.6, x1: -22, z0: -38, z1: -8, y0: 0.9, y1: 5 };
  addTank({ ...SH, face: '+x', top: '#3aa0e6', bottom: '#0b3f86', glow: 'rgba(90,190,255,0.55)' });
  {
    const reg = { x0: SH.x0 + 0.8, x1: SH.x1 - 0.8, z0: SH.z0 + 1, z1: SH.z1 - 1 };
    for (let i = 0; i < 3; i++)
      swimLine(addFish(makeFish(0xc9b38a, 1.9, true)), { axis: 'z', min: reg.z0, max: reg.z1, lane: [-28, -23.5], y: [2.2, 4], speed: 1.3 });
    for (let i = 0; i < 2; i++)
      swimLine(addFish(makeFish(0x9a8c70, 1.2, true)), { axis: 'z', min: reg.z0, max: reg.z1, lane: [-28, -23.5], y: [1.4, 2.4], speed: 0.9 });
    for (let i = 0; i < 4; i++)
      swimLine(addFish(makeRay(i % 2 ? 0x7a8aa6 : 0x8a7a9a, rr(0.9, 1.4))), {
        axis: 'z', min: reg.z0, max: reg.z1, lane: [-28, -23.5], y: [1.3, 2], speed: 1.1,
      });
    for (let i = 0; i < 14; i++)
      swimLine(addFish(makeFish(0xb9d4f2, 0.45)), { axis: 'z', min: reg.z0, max: reg.z1, lane: [-28.5, -23], y: [1.5, 4.4], speed: 2.4 });
    for (let i = 0; i < 4; i++)
      swimLine(addFish(makeFish(0x7d6b4a, 1.1)), { axis: 'z', min: reg.z0, max: reg.z1, lane: [-28, -23.5], y: [1.8, 3.6], speed: 0.8 });
    for (let i = 0; i < 5; i++) addKelp(rr(SH.x0 + 1, SH.x1 - 1), SH.y0 + 0.05, rr(SH.z0 + 1, SH.z1 - 1), rr(1.4, 2.4));
  }
  addScreen(FACTS.leopard, [-21.9, 6, -14], Math.PI / 2);
  addScreen(FACTS.horn, [-21.9, 6, -23], Math.PI / 2);
  addScreen(FACTS.batray, [-21.9, 6, -32], Math.PI / 2);

  // ---- EAST WALL: Jelly Gallery ----
  const JG = { x0: 22, x1: 29.6, z0: -38, z1: -8, y0: 0.9, y1: 5 };
  addTank({ ...JG, face: '-x', top: '#5b3bb8', bottom: '#0b0a46', glow: 'rgba(170,110,255,0.55)', sand: false });
  {
    const reg = { x0: JG.x0 + 1, x1: JG.x1 - 1, z0: JG.z0 + 1.5, z1: JG.z1 - 1.5, y0: JG.y0, y1: JG.y1 };
    const colors = [0xff7ad0, 0x7af0ff, 0xc8a0ff, 0xffb27a];
    for (let i = 0; i < 14; i++) addJelly(reg, pick(colors), rr(0.5, 1.1));
  }
  addScreen(FACTS.jelly, [21.9, 6, -14], -Math.PI / 2);
  addScreen(FACTS.nettle, [21.9, 6, -23], -Math.PI / 2);
  addScreen(FACTS.touch, [21.9, 6, -32], -Math.PI / 2);

  // ---- BACK WALL: Kelp Forest ----
  const KF = { x0: -29.6, x1: 29.6, z0: -44.6, z1: -38.5, y0: 0.9, y1: 5 };
  addTank({ ...KF, face: '+z', top: '#46c0a0', bottom: '#0a4a6a', glow: 'rgba(90,230,190,0.5)' });
  {
    for (let i = 0; i < 52; i++) addKelp(rr(KF.x0 + 1, KF.x1 - 1), KF.y0 + 0.05, rr(KF.z0 + 1, KF.z1 - 1), rr(3, 4));
    const reg = { min: KF.x0 + 1, max: KF.x1 - 1 };
    for (let i = 0; i < 10; i++)
      swimLine(addFish(makeFish(0xff7a1a, 0.6)), { axis: 'x', ...reg, lane: [-43.5, -39.5], y: [1.6, 3.4], speed: 1.2 });
    for (let i = 0; i < 6; i++)
      swimLine(addFish(makeFish(0x9a8a55, 1.0)), { axis: 'x', ...reg, lane: [-43.5, -39.5], y: [1.8, 4], speed: 1.0 });
    for (let i = 0; i < 18; i++)
      swimLine(addFish(makeFish(0xb9d4f2, 0.38)), { axis: 'x', ...reg, lane: [-43.8, -39.2], y: [1.5, 4.5], speed: 2.6 });
  }
  addScreen(FACTS.kelp, [-14, 6, -38.4], 0);
  addScreen(FACTS.garibaldi, [0, 6, -38.4], 0);
  addScreen(FACTS.bass, [14, 6, -38.4], 0);

  // ---- CENTRE: open-ocean column ----
  {
    const cx = 0;
    const cz = -22;
    const R = 4;
    const ch = 6.4;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.4, 0.9, 20), cabinetMat);
    base.position.set(cx, 0.45, cz);
    scene.add(base);
    const topRing = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.6, 20), darkMat);
    topRing.position.set(cx, H - 0.3, cz);
    scene.add(topRing);
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, ch, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x2f8ae0, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    );
    inner.position.set(cx, 0.9 + ch / 2, cz);
    inner.renderOrder = 4;
    scene.add(inner);
    const floorDisc = new THREE.Mesh(
      new THREE.CircleGeometry(R, 20),
      new THREE.MeshBasicMaterial({ map: sandTexture(), color: 0xa9c4d8 }),
    );
    floorDisc.rotation.x = -Math.PI / 2;
    floorDisc.position.set(cx, 1.0, cz);
    scene.add(floorDisc);
    discs.push({ x: cx, z: cz, r: R + 0.5 });

    for (let i = 0; i < 38; i++) {
      const dirn = i % 7 === 0 ? -1 : 1;
      orbit(addFish(makeFish(0xb9d4f2, 0.4)), cx, cz, rr(1.2, R - 0.7), [1.6, 6], dirn * rr(0.5, 0.9));
    }
    for (let i = 0; i < 3; i++) orbit(addFish(makeFish(0x7d8fa8, 1.5, true)), cx, cz, rr(2, 3), [2, 5.5], rr(0.3, 0.45));

    // bubble column
    const N = 70;
    const bp = new Float32Array(N * 3);
    const seeds: [number, number, number][] = [];
    for (let i = 0; i < N; i++) seeds.push([rr(-0.8, 0.8), rr(0, ch), rr(-0.8, 0.8)]);
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    scene.add(new THREE.Points(bgeo, new THREE.PointsMaterial({ color: 0xdff6ff, size: 3, sizeAttenuation: false })));
    anims.push((t) => {
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        bp[i * 3] = cx + s[0] + Math.sin(t + i) * 0.15;
        bp[i * 3 + 1] = 1 + ((s[1] + t * 0.9) % ch);
        bp[i * 3 + 2] = cz + s[2];
      }
      bgeo.attributes.position.needsUpdate = true;
    });
  }

  // ---- touch pool near the entrance ----
  {
    const px = -14;
    const pz = -3;
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.7, 0.95, 18, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x1f8fa6, emissive: 0x0e4a58, side: THREE.DoubleSide }),
    );
    rim.position.set(px, 0.475, pz);
    scene.add(rim);
    const top = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.18, 4, 18), lambert(0xe2eef5));
    top.rotation.x = Math.PI / 2;
    top.position.set(px, 0.95, pz);
    scene.add(top);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.6, 18), new THREE.MeshBasicMaterial({ map: sandTexture(), color: 0x90b0c8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(px, 0.15, pz);
    scene.add(floor);
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(2.55, 18),
      new THREE.MeshBasicMaterial({ color: 0x3aa8f0, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.set(px, 0.78, pz);
    surface.renderOrder = 4;
    scene.add(surface);
    for (let i = 0; i < 3; i++) orbit(addFish(makeRay(0x8a98b8, 0.45)), px, pz, rr(0.6, 1.7), [0.35, 0.5], rr(0.4, 0.7) * (i % 2 ? 1 : -1));
    discs.push({ x: px, z: pz, r: 2.9 });
    addScreen(FACTS.touch, [px, 2.4, pz - 2.9], 0, 2.6, 1.3);
    // ...held up by a little post behind it
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 0.25), frameMat);
    stand.position.set(px, 1.2, pz - 3.05);
    scene.add(stand);
    solid(px - 0.2, px + 0.2, pz - 3.2, pz - 2.9);
  }

  // ---- murals on the entry walls ----
  for (const [x, ry, tex] of [
    [-29.55, Math.PI / 2, muralTex],
    [29.55, -Math.PI / 2, muralTex2],
  ] as [number, number, THREE.Texture][]) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 5.2),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    );
    m.position.set(x, 3.3, -2);
    m.rotation.y = ry;
    scene.add(m);
  }

  // ------------------------------------------------------- plaza dressing
  // palms along the waterfront
  const trunkMat = lambert(0x6b4b34);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2f9a52, emissive: 0x0d3a1c, side: THREE.DoubleSide });
  const frondGeo = new THREE.ConeGeometry(0.45, 3.6, 3).rotateZ(Math.PI / 2).translate(1.8, 0, 0);
  const addPalm = (x: number, z: number) => {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 7, 6), trunkMat);
    trunk.position.y = 3.5;
    trunk.rotation.z = rr(-0.08, 0.08);
    g.add(trunk);
    for (let i = 0; i < 8; i++) {
      const f = new THREE.Mesh(frondGeo, frondMat);
      f.position.y = 7;
      f.rotation.y = (i / 8) * Math.PI * 2;
      f.rotation.z = -0.35;
      g.add(f);
    }
    g.position.set(x, 0, z);
    scene.add(g);
    solid(x - 0.5, x + 0.5, z - 0.5, z + 0.5);
    const ph = rr(0, 6);
    anims.push((t) => {
      g.rotation.z = Math.sin(t * 0.6 + ph) * 0.012;
    });
  };
  for (const [x, z] of [
    [-22, 30],
    [22, 30],
    [-14, 17],
    [14, 17],
    [-36, 14],
    [36, 14],
    [-40, 32],
    [40, 32],
  ])
    addPalm(x, z);

  // lamp posts
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe08a });
  const lampGlow = glowTexture('255,210,120');
  const addLamp = (x: number, z: number, light: boolean) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 6, 6), lambert(0x4a3b2e));
    pole.position.set(x, 3, z);
    scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), lambert(0x4a3b2e));
    arm.position.set(x, 6, z);
    scene.add(arm);
    for (const s of [-0.8, 0.8]) {
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), lampMat);
      head.position.set(x + s, 5.85, z);
      scene.add(head);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampGlow, transparent: true, depthWrite: false, opacity: 0.8 }));
      halo.position.set(x + s, 5.8, z);
      halo.scale.set(4.5, 4.5, 1);
      scene.add(halo);
    }
    if (light) {
      const pl = new THREE.PointLight(0xffc870, 30, 26, 1.3);
      pl.position.set(x, 5.5, z);
      scene.add(pl);
    }
    solid(x - 0.25, x + 0.25, z - 0.25, z + 0.25);
  };
  addLamp(-9, 31, true);
  addLamp(9, 31, true);
  addLamp(-18, 9, false);
  addLamp(18, 9, false);

  // waterfront plaque
  {
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.4),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(
          256,
          72,
          (g, w, h) => {
            g.fillStyle = '#2a2f40';
            g.fillRect(0, 0, w, h);
            g.strokeStyle = '#c9a85a';
            g.lineWidth = 3;
            g.strokeRect(3, 3, w - 6, h - 6);
            g.fillStyle = '#f2e3b2';
            g.textAlign = 'center';
            g.font = 'bold 18px "Courier New", monospace';
            g.fillText('SOUTHERN CALIFORNIA', w / 2, 28);
            g.fillText('WATERFRONT · EST. 2026', w / 2, 52);
          },
          { nearest: true },
        ),
      }),
    );
    plaque.position.set(-8, 1.5, 36.6);
    plaque.rotation.y = Math.PI;
    scene.add(plaque);
  }

  return {
    boxes,
    discs,
    update(t, dt) {
      for (const a of anims) a(t, dt);
    },
  };
}
