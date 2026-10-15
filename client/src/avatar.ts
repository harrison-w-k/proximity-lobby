import * as THREE from 'three';
import type { PlayerState } from '../../shared/protocol';

export function hueFor(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

function makeNameSprite(name: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,12,90,0.8)';
  g.fillRect(4, 8, 248, 48);
  g.strokeStyle = '#e8ecff';
  g.lineWidth = 3;
  g.strokeRect(5.5, 9.5, 245, 45);
  g.fillStyle = '#fff';
  g.font = '700 26px "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.1;
  return sprite;
}

// ---- shared geometry for the clay-mannequin body (never disposed per avatar) ----
// Chunky, rounded, faceless limbs: big round head, thick capsules, ball joints.
const SEG = 12;
const headGeo = new THREE.SphereGeometry(0.21, SEG, 10);
const neckGeo = new THREE.CylinderGeometry(0.07, 0.085, 0.14, 8);
const torsoGeo = new THREE.CapsuleGeometry(0.19, 0.28, 4, SEG);
const pelvisGeo = new THREE.SphereGeometry(0.19, SEG, 8);
const thighGeo = new THREE.CapsuleGeometry(0.108, 0.28, 4, 10);
const shinGeo = new THREE.CapsuleGeometry(0.092, 0.28, 4, 10);
const footGeo = new THREE.SphereGeometry(0.09, 10, 8);
const upperArmGeo = new THREE.CapsuleGeometry(0.085, 0.18, 4, 10);
const foreArmGeo = new THREE.CapsuleGeometry(0.078, 0.18, 4, 10);
const ballGeo = new THREE.SphereGeometry(1, 10, 8);

const HIP_Y = 0.88;
const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

interface Arm {
  shoulder: THREE.Group;
  elbow: THREE.Group;
}
interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

/**
 * A remote player: a white clay mannequin (tinted a soft pastel per player) with a small
 * skeleton. Position and facing are smoothed, and the walk cycle is driven by how fast the
 * body is actually moving, so it blends smoothly between idle, walk and sprint.
 */
export class Avatar {
  readonly group = new THREE.Group();

  private mat: THREE.MeshLambertMaterial;
  private rig = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private arms: [Arm, Arm];
  private legs: [Leg, Leg];
  private nameTag: THREE.Sprite;

  private tx: number;
  private tz: number;
  private try_: number;

  private speed = 0; // smoothed ground speed (m/s)
  private walk = 0; // 0 idle .. 1 walking
  private sprint = 0; // 0 walk .. 1 full sprint
  private gaitDir = 1; // -1 when backpedalling
  private phase = 0;
  private talk = 0;
  private talkTarget = 0;
  private clock = Math.random() * 100;

  constructor(p: PlayerState) {
    const tint = new THREE.Color().setHSL(hueFor(p.id) / 360, 0.5, 0.84);
    this.mat = new THREE.MeshLambertMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.3 });
    const m = this.mat;
    const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    const ball = (parent: THREE.Object3D, r: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      const o = mesh(ballGeo, parent, x, y, z);
      o.scale.set(r * sx, r * sy, r * sz);
      return o;
    };
    const joint = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };

    this.rig.scale.setScalar(0.92);
    this.group.add(this.rig);
    this.hips.position.y = HIP_Y;
    this.rig.add(this.hips);

    // pelvis + torso (the spine group twists and leans on top of the pelvis)
    ball(this.hips, 0.2, 0, 0, 0, 1.1, 0.78, 0.9);
    this.hips.add(this.spine);
    mesh(torsoGeo, this.spine, 0, 0.34, 0).scale.set(1.12, 1, 0.82);
    mesh(neckGeo, this.spine, 0, 0.7, 0);
    this.spine.add(this.head);
    this.head.position.set(0, 0.74, 0);
    mesh(headGeo, this.head, 0, 0.17, 0).scale.set(1, 1.04, 1);

    // arms: shoulder -> elbow -> hand
    const makeArm = (side: 1 | -1): Arm => {
      const shoulder = joint(this.spine, side * 0.31, 0.57);
      ball(shoulder, 0.105);
      mesh(upperArmGeo, shoulder, 0, -0.14, 0);
      const elbow = joint(shoulder, 0, -0.28);
      ball(elbow, 0.088);
      mesh(foreArmGeo, elbow, 0, -0.13, 0);
      ball(elbow, 0.1, 0, -0.31, 0); // hand
      return { shoulder, elbow };
    };
    this.arms = [makeArm(1), makeArm(-1)];

    // legs: hip -> knee -> foot
    const makeLeg = (side: 1 | -1): Leg => {
      const hip = joint(this.hips, side * 0.12, -0.02);
      ball(hip, 0.118);
      mesh(thighGeo, hip, 0, -0.2, 0);
      const knee = joint(hip, 0, -0.4);
      ball(knee, 0.098);
      mesh(shinGeo, knee, 0, -0.2, 0);
      ball(knee, 0.105, 0, -0.4, -0.05, 1, 0.7, 1.6); // foot points forward (-z)
      return { hip, knee };
    };
    this.legs = [makeLeg(1), makeLeg(-1)];

    this.nameTag = makeNameSprite(p.name);
    this.group.add(this.nameTag);

    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = p.ry;
    this.tx = p.x;
    this.tz = p.z;
    this.try_ = p.ry;
    this.pose(0, 0);
  }

  setTarget(x: number, z: number, ry: number) {
    this.tx = x;
    this.tz = z;
    this.try_ = ry;
  }

  setSpeaking(on: boolean) {
    this.talkTarget = on ? 1 : 0;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const g = this.group;
    this.clock += dt;

    // smooth position + facing (network updates arrive ~15 times a second)
    const ox = g.position.x;
    const oz = g.position.z;
    const k = damp(15, dt);
    g.position.x += (this.tx - ox) * k;
    g.position.z += (this.tz - oz) * k;
    let d = this.try_ - g.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // shortest angle
    g.rotation.y += d * damp(12, dt);

    // how fast, and in which direction relative to where the body faces
    const vx = (g.position.x - ox) / dt;
    const vz = (g.position.z - oz) / dt;
    const sp = Math.hypot(vx, vz);
    this.speed += (sp - this.speed) * damp(10, dt);
    const fwd = vx * -Math.sin(g.rotation.y) + vz * -Math.cos(g.rotation.y);
    if (sp > 0.8) this.gaitDir += ((fwd >= -0.25 * sp ? 1 : -1) - this.gaitDir) * damp(10, dt);

    this.walk += (Math.min(1, this.speed / 1.6) - this.walk) * damp(9, dt);
    this.sprint += (Math.max(0, Math.min(1, (this.speed - 5.5) / 3)) - this.sprint) * damp(6, dt);
    this.talk += (this.talkTarget - this.talk) * damp(10, dt);

    this.phase += this.gaitDir * dt * Math.PI * 2 * (0.5 + this.speed * 0.27);
    this.pose(this.phase, this.clock);

    this.mat.emissiveIntensity = 0.3 + 0.75 * this.talk; // speaking glow
  }

  private pose(ph: number, t: number) {
    const w = this.walk;
    const s = this.sprint;
    const idle = 1 - w;
    const sinP = Math.sin(ph);
    const cosP = Math.cos(ph);

    // legs: swing, with the knee folding while the leg travels forward
    const swing = (0.5 + 0.28 * s) * w;
    const [lL, lR] = this.legs;
    lL.hip.rotation.x = sinP * swing;
    lR.hip.rotation.x = -sinP * swing;
    lL.knee.rotation.x = -(Math.max(0, cosP) * 0.95 + 0.06) * w;
    lR.knee.rotation.x = -(Math.max(0, -cosP) * 0.95 + 0.06) * w;

    // arms swing against the legs; elbows bend more when sprinting
    const aSwing = (0.55 + 0.3 * s) * w;
    const bend = 0.12 + (0.3 + 0.55 * s) * w;
    const [aL, aR] = this.arms;
    const breathe = Math.sin(t * 1.6) * 0.02 * idle;
    aL.shoulder.rotation.set(-sinP * aSwing + breathe, 0, 0.1 + 0.03 * s);
    aR.shoulder.rotation.set(sinP * aSwing - breathe, 0, -0.1 - 0.03 * s);
    aL.elbow.rotation.x = bend;
    aR.elbow.rotation.x = bend;

    // talking: a relaxed gesture with the right hand and a little nodding
    const tk = this.talk * (0.55 + 0.45 * idle);
    const beat = 0.5 + 0.5 * Math.sin(t * 3.1);
    aR.shoulder.rotation.x += 0.6 * tk * (0.6 + 0.4 * beat);
    aR.shoulder.rotation.z -= 0.22 * tk;
    aR.elbow.rotation.x += 0.9 * tk * (0.7 + 0.3 * Math.sin(t * 5.3));

    // torso twists against the hips and leans into the run; hips bob
    this.spine.rotation.set(-(0.04 + 0.2 * s) * w, sinP * 0.13 * w, 0);
    this.spine.scale.y = 1 + Math.sin(t * 1.6) * 0.012 * idle;
    this.hips.rotation.y = -sinP * 0.08 * w;
    this.hips.position.y = HIP_Y + Math.cos(2 * ph) * 0.03 * w - 0.02 * w;

    // head stays level-ish, with a gentle idle sway and talking nods
    this.head.rotation.set(
      -this.spine.rotation.x * 0.8 + Math.sin(t * 6.5) * 0.05 * this.talk,
      -this.spine.rotation.y * 0.6 + Math.sin(t * 0.5) * 0.08 * idle,
      Math.sin(t * 0.7) * 0.03 * idle,
    );
  }

  dispose() {
    this.mat.dispose();
    (this.nameTag.material as THREE.SpriteMaterial).map?.dispose();
    this.nameTag.material.dispose();
  }
}
