// Procedural low-res textures: 64x64 canvases drawn pixel by pixel with seeded noise, sampled with
// nearest-neighbour filtering so every texel stays a hard square. Gritty and handmade-looking, in
// the spirit of late-90s 3D, with no image files to load.
import * as THREE from 'three';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE = 64;

function surface(): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const px = (g: CanvasRenderingContext2D, x: number, y: number, color: string, w = 1, h = 1) => {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};

/** Sprinkle single pixels in the given colours. */
function speckle(g: CanvasRenderingContext2D, r: () => number, colors: string[], count: number, w = 1, h = 1) {
  for (let i = 0; i < count; i++) {
    px(g, r() * SIZE, r() * SIZE, colors[Math.floor(r() * colors.length)], w, h);
  }
}

// ---------------------------------------------------------------- ground
/** Two grass tones in a 2x2 checker, each cell with tufts, dirt and sun-bleached specks. */
export function grassTile(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(101);
  const cells: [number, number, string][] = [
    [0, 0, '#79b852'],
    [32, 0, '#5f9a41'],
    [0, 32, '#5f9a41'],
    [32, 32, '#79b852'],
  ];
  for (const [x, y, col] of cells) {
    g.fillStyle = col;
    g.fillRect(x, y, 32, 32);
    for (let i = 0; i < 70; i++) {
      const dark = r() < 0.5;
      px(g, x + r() * 32, y + r() * 32, dark ? 'rgba(30,70,20,0.45)' : 'rgba(200,240,150,0.4)');
    }
    for (let i = 0; i < 9; i++) {
      // little "v" tufts
      const tx = x + 2 + r() * 28;
      const ty = y + 3 + r() * 26;
      px(g, tx, ty, '#3f7a2c');
      px(g, tx - 1, ty - 1, '#3f7a2c');
      px(g, tx + 1, ty - 1, '#3f7a2c');
    }
    px(g, x + r() * 30, y + r() * 30, '#8a6b3f', 2, 1); // a patch of dirt
  }
  g.fillStyle = 'rgba(0,0,0,0.18)'; // seams between the big tiles
  g.fillRect(0, 0, 64, 1);
  g.fillRect(0, 0, 1, 64);
  g.fillRect(31, 0, 1, 64);
  g.fillRect(0, 31, 64, 1);
  return finish(c);
}

export function sand(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(202);
  g.fillStyle = '#e6d39a';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#cdb877', '#f2e6b4', '#b9a465', '#d9c688'], 380);
  for (let y = 6; y < SIZE; y += 14) {
    // faint ripples
    for (let x = 0; x < SIZE; x++) px(g, x, y + Math.round(Math.sin((x / SIZE) * 6.28 + y) * 1.5), 'rgba(160,130,70,0.35)');
  }
  return finish(c);
}

// ---------------------------------------------------------------- obstacles
/** Poured concrete in panels, with stains, hairline cracks and corner bolts. */
export function concrete(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(303);
  g.fillStyle = '#9097a2';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#868d98', '#9ea5b0', '#7d848f', '#a6adb7'], 520);
  for (let i = 0; i < 4; i++) {
    // damp stains
    const sx = r() * 56;
    const sy = r() * 56;
    g.fillStyle = 'rgba(60,66,76,0.22)';
    g.fillRect(sx, sy, 6 + r() * 10, 4 + r() * 12);
  }
  g.fillStyle = '#5b616c'; // panel seams
  g.fillRect(0, 0, SIZE, 1);
  g.fillRect(0, 0, 1, SIZE);
  g.fillRect(0, 31, SIZE, 1);
  g.fillRect(31, 0, 1, SIZE);
  for (const [bx, by] of [[3, 3], [28, 3], [3, 28], [28, 28], [35, 3], [60, 3], [35, 28], [60, 28], [3, 35], [28, 35], [3, 60], [28, 60], [35, 35], [60, 35], [35, 60], [60, 60]]) {
    px(g, bx, by, '#c4cad3', 2, 2);
    px(g, bx + 1, by + 1, '#4c525c');
  }
  let cx = 12 + r() * 20;
  for (let y = 4; y < 28; y++) {
    cx += (r() - 0.5) * 2;
    px(g, cx, y, '#4e5560');
  }
  return finish(c);
}

/** A wooden crate: four planks, a dark frame, a diagonal brace and nail heads. */
export function crate(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(404);
  g.fillStyle = '#b5834a';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let p = 0; p < 4; p++) {
    const y = p * 16;
    g.fillStyle = p % 2 ? '#a8763f' : '#bd8c52';
    g.fillRect(0, y, SIZE, 16);
    g.fillStyle = '#6e4a26';
    g.fillRect(0, y, SIZE, 1); // gap between planks
    for (let i = 0; i < 26; i++) px(g, r() * SIZE, y + 2 + r() * 12, 'rgba(90,55,25,0.55)', 3 + Math.floor(r() * 5), 1); // grain
  }
  g.fillStyle = '#5a3a1c'; // frame
  g.fillRect(0, 0, SIZE, 5);
  g.fillRect(0, SIZE - 5, SIZE, 5);
  g.fillRect(0, 0, 5, SIZE);
  g.fillRect(SIZE - 5, 0, 5, SIZE);
  for (let i = 4; i < SIZE - 4; i++) {
    px(g, i, i, '#6a4522', 3, 3); // brace
  }
  for (const [nx, ny] of [[2, 2], [61, 2], [2, 61], [61, 61], [31, 2], [31, 61]]) px(g, nx, ny, '#d8d2c4', 2, 2);
  return finish(c);
}

/** Yellow-and-black warning stripes, scuffed. */
export function hazard(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(505);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      px(g, x, y, ((x + y) >> 3) % 2 === 0 ? '#f2c230' : '#23222a');
    }
  }
  speckle(g, r, ['rgba(0,0,0,0.25)', 'rgba(255,255,255,0.18)'], 260);
  return finish(c);
}

/** Painted orange sheet metal: scratches, rust blooms, rivets and panel lines. */
export function orangeMetal(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(606);
  g.fillStyle = '#e0782c';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#d36c22', '#ea8a40', '#c85f1a'], 300);
  for (let i = 0; i < 14; i++) px(g, r() * 56, r() * 62, 'rgba(255,220,170,0.5)', 4 + Math.floor(r() * 8), 1); // scratches
  for (let i = 0; i < 3; i++) {
    const rx = r() * 54;
    const ry = r() * 54;
    for (let k = 0; k < 30; k++) px(g, rx + r() * 10, ry + r() * 10, 'rgba(110,50,20,0.65)'); // rust
  }
  g.fillStyle = '#9d4d17';
  g.fillRect(0, 0, SIZE, 2);
  g.fillRect(0, 0, 2, SIZE);
  g.fillRect(0, 31, SIZE, 1);
  g.fillRect(31, 0, 1, SIZE);
  for (let i = 6; i < SIZE; i += 14) {
    px(g, i, 5, '#f3d7b0', 2, 2);
    px(g, i, 57, '#f3d7b0', 2, 2);
  }
  return finish(c);
}

/** Red and white barrier stripes (the slide-under beams). */
export function barrier(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(707);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      px(g, x, y, ((x + y) >> 4) % 2 === 0 ? '#d9362a' : '#ece9e2');
    }
  }
  speckle(g, r, ['rgba(0,0,0,0.2)', 'rgba(255,255,255,0.2)'], 200);
  return finish(c);
}

/** Green goal plating with white chevrons. */
export function goalPanel(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(808);
  g.fillStyle = '#4fae38';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#449c30', '#5cc044', '#3b8a29'], 280);
  for (let row = 0; row < 3; row++) {
    const y = 8 + row * 20;
    for (let i = 0; i < 12; i++) {
      px(g, 20 + i, y + i, '#f4f4ec', 3, 2);
      px(g, 20 + i, y + 22 - i - 12, '#f4f4ec', 3, 2);
    }
  }
  g.fillStyle = '#2f6d20';
  g.fillRect(0, 0, SIZE, 2);
  g.fillRect(0, 0, 2, SIZE);
  return finish(c);
}

/** Grey steel with vertical grooves and bolted bands. */
export function steel(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(909);
  g.fillStyle = '#a2abb8';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += 8) {
    g.fillStyle = 'rgba(60,70,85,0.45)';
    g.fillRect(x, 0, 1, SIZE);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(x + 1, 0, 1, SIZE);
  }
  for (const y of [4, 60]) {
    g.fillStyle = '#6c7584';
    g.fillRect(0, y - 3, SIZE, 6);
    for (let x = 4; x < SIZE; x += 12) px(g, x, y - 1, '#d6dbe3', 2, 2);
  }
  speckle(g, r, ['rgba(40,45,55,0.35)', 'rgba(255,255,255,0.3)'], 160);
  return finish(c);
}

// ---------------------------------------------------------------- nature
export function rock(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(1001);
  g.fillStyle = '#868fa0';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#757e8f', '#98a1b2', '#6a7383', '#a7b0c0'], 500);
  for (let i = 0; i < 5; i++) {
    let x = r() * SIZE;
    let y = r() * SIZE;
    for (let k = 0; k < 14; k++) {
      x += (r() - 0.3) * 3;
      y += (r() - 0.4) * 3;
      px(g, x, y, '#4a5160');
    }
  }
  return finish(c);
}

export function bark(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(1102);
  g.fillStyle = '#8f6c42';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += 4) {
    g.fillStyle = r() < 0.5 ? '#7c5a33' : '#a07c50';
    g.fillRect(x, 0, 2 + Math.floor(r() * 2), SIZE);
  }
  for (let y = 4; y < SIZE; y += 10) {
    g.fillStyle = '#5d4122'; // growth rings
    g.fillRect(0, y, SIZE, 1);
  }
  speckle(g, r, ['rgba(40,25,10,0.5)'], 120);
  return finish(c);
}

export function leaf(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(1203);
  g.fillStyle = '#3aa24f';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#2f8c42', '#4cba62', '#278039'], 420);
  g.fillStyle = '#8fdc8c'; // midrib
  g.fillRect(31, 0, 2, SIZE);
  for (let y = 4; y < SIZE; y += 7) {
    for (let i = 0; i < 12; i++) {
      px(g, 33 + i, y + (i >> 1), '#2a7a3a');
      px(g, 30 - i, y + (i >> 1), '#2a7a3a');
    }
  }
  return finish(c);
}

/** Small ripples, grey-scale so it multiplies cleanly against the per-facet water colours. */
export function waterGlints(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(1304);
  g.fillStyle = '#e6ecf4';
  g.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(r() * SIZE);
    const y = Math.floor(r() * SIZE);
    const len = 2 + Math.floor(r() * 7);
    px(g, x, y, r() < 0.55 ? '#ffffff' : '#c4d0e0', len, 1);
    if (x + len > SIZE) px(g, 0, y, '#ffffff', x + len - SIZE, 1); // wrap so it tiles
  }
  return finish(c);
}

// ---------------------------------------------------------------- the mecha chameleon
/** Pale scratched armour plating: tinted by the material colour, so each player gets their own paint job. */
export function armor(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(1405);
  g.fillStyle = '#dfe3ea';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#d0d5de', '#eceff4', '#c4cad5'], 360);
  g.fillStyle = '#9aa1ad'; // plate seams
  g.fillRect(0, 0, SIZE, 1);
  g.fillRect(0, 21, SIZE, 1);
  g.fillRect(0, 42, SIZE, 1);
  g.fillRect(31, 0, 1, 21);
  g.fillRect(15, 21, 1, 21);
  g.fillRect(47, 42, 1, 22);
  for (let i = 0; i < 10; i++) px(g, r() * 56, r() * 62, '#8c93a0', 3 + Math.floor(r() * 6), 1); // scratches
  for (const [bx, by] of [[3, 3], [58, 3], [3, 17], [58, 17], [28, 24], [28, 38], [3, 45], [58, 45], [3, 59], [58, 59]]) {
    px(g, bx, by, '#ffffff', 2, 2);
    px(g, bx + 1, by + 1, '#7a818d');
  }
  g.fillStyle = '#f2c230'; // a small hazard tab
  g.fillRect(40, 6, 14, 4);
  for (let i = 0; i < 14; i += 4) px(g, 40 + i, 6, '#23222a', 2, 4);
  return finish(c);
}

export function darkMetal(): THREE.CanvasTexture {
  const { c, g } = surface();
  const r = rng(1506);
  g.fillStyle = '#3c4352';
  g.fillRect(0, 0, SIZE, SIZE);
  speckle(g, r, ['#333a48', '#464e5f', '#2b313d'], 380);
  for (let i = 0; i < 12; i++) px(g, r() * 56, r() * 62, '#6f7a8f', 3 + Math.floor(r() * 7), 1);
  for (let y = 10; y < SIZE; y += 18) {
    g.fillStyle = '#242a35';
    g.fillRect(0, y, SIZE, 2);
  }
  return finish(c);
}

/** The default "face": a dark screen with two glowing pixel eyes. Replaced by the player's photo. */
export function screenFace(glow: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#07101c';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = glow;
  g.fillRect(6, 9, 6, 9); // eyes
  g.fillRect(20, 9, 6, 9);
  g.fillRect(10, 23, 12, 2); // mouth
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillRect(7, 10, 2, 3); // a glint in each eye
  g.fillRect(21, 10, 2, 3);
  g.fillStyle = 'rgba(0,0,0,0.25)'; // scanlines
  for (let y = 0; y < 32; y += 2) g.fillRect(0, y, 32, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A box whose texture coordinates follow its real size, so one texture repeat always covers
 * `tile` metres: big walls do not smear one 64-pixel texture across 4 m.
 */
export function worldBox(w: number, h: number, d: number, tile = 2): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // faces in order: +x, -x, +y, -y, +z, -z; four vertices each
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * (dims[face][0] / tile), uv.getY(i) * (dims[face][1] / tile));
    }
  }
  uv.needsUpdate = true;
  return geo;
}
