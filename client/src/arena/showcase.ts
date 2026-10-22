// The stage on the animal select screen: a live 3D model that rises into the spotlight and
// then shows off its moves (walk, a three-hit combo, its two signature skills, a guard, a jump).
import * as THREE from 'three';
import { ANIMAL_BY_ID } from '../../../shared/arena/animals';
import { COMBO } from '../../../shared/arena/combat';
import { STRIKE_TIME, poseFor, type Cue } from './anim';
import { makePlayerRig, type Rig, type RigState } from './models';

const SKILL_WIND: Record<string, number> = { cone: 0.22, dash: 0.18, aoe: 0.3, proj: 0.16, grab: 0.2 };

type Step = { name: string; len: number; cue?: (a: string, now: number) => Cue | null; speed?: number; guard?: boolean; air?: boolean };

export class Showcase {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1.35, 0.05, 80);
  private rig: Rig | null = null;
  private animal = '';
  private floor: THREE.Mesh;
  private ring: THREE.Mesh;
  private dust: THREE.Points;
  private dustV: Float32Array;
  private raf = 0;
  private last = 0;
  private t = 0;
  private enter = 1;
  private cue: Cue | null = null;
  private stepAt = 0;
  private stepIdx = 0;
  private steps: Step[] = [];
  private radius = 1;
  private center = new THREE.Vector3();
  private dragYaw = 0;
  private dragging = false;
  private lastDrag = -9;
  private moved = 0;
  private rim!: THREE.DirectionalLight;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x7a6a4a, 1.15));
    const key = new THREE.DirectionalLight(0xfff0d0, 1.9);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    this.rim = new THREE.DirectionalLight(0x9fd8ff, 1.1);
    this.rim.position.set(-4, 3, -3);
    this.scene.add(this.rim);
    // drag to turn the animal around; a click makes it perform
    const c = this.canvas;
    c.style.cursor = 'grab';
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.moved = 0;
      c.setPointerCapture(e.pointerId);
      c.style.cursor = 'grabbing';
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragYaw += e.movementX * 0.012;
      this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      this.lastDrag = performance.now() / 1000;
    });
    const up = () => {
      if (!this.dragging) return;
      this.dragging = false;
      c.style.cursor = 'grab';
      if (this.moved < 5) this.perform();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    // a soft pool of light on the ground
    const glow = document.createElement('canvas');
    glow.width = glow.height = 128;
    const g = glow.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,240,190,0.95)');
    grad.addColorStop(0.55, 'rgba(255,200,110,0.35)');
    grad.addColorStop(1, 'rgba(255,200,110,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glow), transparent: true, depthWrite: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0.01;
    this.scene.add(this.floor);

    // the shockwave when an animal steps into focus
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.scene.add(this.ring);

    // floating motes in the light
    const n = 60;
    const pos = new Float32Array(n * 3);
    this.dustV = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 4;
      pos[i * 3 + 1] = Math.random() * 3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4;
      this.dustV[i] = 0.1 + Math.random() * 0.25;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff2c0, size: 0.04, transparent: true, opacity: 0.7, depthWrite: false }));
    this.scene.add(this.dust);
  }

  /** Tint the rim light and shockwave with the animal's class colour. */
  setAccent(hex: number) {
    this.rim.color.setHex(hex);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(hex);
  }

  /** Play the next move in the reel right now (clicking the animal). */
  perform() {
    if (!this.rig || this.enter < 1) return;
    this.stepAt = 0; // the next frame starts the next step
  }

  /** Bring an animal up into focus. */
  setAnimal(id: string) {
    if (id === this.animal) return;
    this.animal = id;
    if (this.rig) this.scene.remove(this.rig.root);
    this.rig = makePlayerRig(id);
    this.scene.add(this.rig.root);
    const box = new THREE.Box3().setFromObject(this.rig.root);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    this.radius = sph.radius;
    this.center.copy(sph.center);
    const dist = (sph.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.08;
    this.camera.position.set(0, sph.center.y + dist * 0.16, dist);
    this.camera.lookAt(0, sph.center.y, 0);
    this.floor.scale.setScalar(sph.radius * 1.7);
    this.dust.scale.setScalar(Math.max(0.6, sph.radius * 0.8));
    this.enter = 0; // rise from the floor
    this.t = 0;
    this.buildSteps();
    this.stepIdx = 0;
    this.stepAt = 0;
    this.cue = null;
  }

  private cueFor(animal: string, kind: 'swing' | 'skill', combo: number, skillIdx: number, now: number): Cue | null {
    const def = ANIMAL_BY_ID.get(animal);
    if (!def) return null;
    if (kind === 'swing') {
      const c = COMBO[combo];
      return { kind: 'swing', animal, combo, heavy: combo === 2, skill: '', fx: '', start: now, wind: c.wind * 1.6, strike: STRIKE_TIME * 1.4, rec: c.rec * 1.4 };
    }
    const sk = def.sig[skillIdx];
    const fx = sk.fx;
    if (!fx) return null;
    const instant = fx.k === 'buff' || fx.k === 'heal' || fx.k === 'submerge';
    const wind = (SKILL_WIND[fx.k] ?? 0) * 1.6;
    return { kind: instant ? 'flex' : 'skill', animal, combo: -1, heavy: fx.k === 'grab' || fx.k === 'aoe', skill: sk.id, fx: fx.k, start: now, wind, strike: STRIKE_TIME * 1.4, rec: 0.5 };
  }

  private buildSteps() {
    const a = this.animal;
    this.steps = [
      { name: 'walk', len: 2.2, speed: 4.5 },
      { name: 'swing0', len: 0.95, cue: (an, n) => this.cueFor(an, 'swing', 0, 0, n) },
      { name: 'swing1', len: 0.95, cue: (an, n) => this.cueFor(an, 'swing', 1, 0, n) },
      { name: 'swing2', len: 1.5, cue: (an, n) => this.cueFor(an, 'swing', 2, 0, n) },
      { name: 'idle', len: 0.7 },
      { name: 'skill0', len: 1.7, cue: (an, n) => this.cueFor(an, 'skill', 0, 0, n) },
      { name: 'skill1', len: 1.7, cue: (an, n) => this.cueFor(an, 'skill', 0, 1, n) },
      { name: 'guard', len: 1.4, guard: true },
      { name: 'jump', len: 1.0, air: true },
      { name: 'idle', len: 1.2 },
    ];
    void a;
  }

  start() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt, now / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize() {
    const w = Math.max(2, this.canvas.clientWidth);
    const h = Math.max(2, this.canvas.clientHeight);
    const k = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(k);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(dt: number, now: number) {
    const rig = this.rig;
    if (!rig) return;
    this.t += dt;
    // rising into focus: up from below the floor with a little overshoot, then a shockwave of light
    if (this.enter < 1) {
      this.enter = Math.min(1, this.enter + dt / 0.65);
      const e = this.enter;
      const back = 1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2); // easeOutBack
      rig.root.position.y = -this.radius * 1.6 * (1 - back);
      rig.root.scale.setScalar(0.65 + 0.35 * Math.min(1, back));
      const ringMat = this.ring.material as THREE.MeshBasicMaterial;
      ringMat.opacity = Math.max(0, 0.8 * (1 - e));
      this.ring.scale.setScalar(this.radius * (0.4 + e * 3.2));
    } else {
      rig.root.position.y = 0;
      rig.root.scale.setScalar(1);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    // the floor glow breathes
    (this.floor.material as THREE.MeshBasicMaterial).opacity = 0.75 + Math.sin(this.t * 1.6) * 0.15;
    // slow turntable, easing around to show off the front for each move
    // after you let go the animal drifts back to its slow turn
    const idle = this.dragging || now - this.lastDrag < 2.5;
    rig.root.rotation.y = 2.5 + this.dragYaw + (idle ? 0 : Math.sin(this.t * 0.45) * 0.75 + this.t * 0.08);
    if (!idle && Math.abs(this.dragYaw) > 0.001) this.dragYaw *= 1 - Math.min(1, dt * 1.2);
    // motes drift upward
    const p = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + this.dustV[i] * dt;
      if (y > 3) y = 0;
      p.setY(i, y);
    }
    p.needsUpdate = true;

    // the demo reel
    if (this.enter >= 1) {
      if (this.t > this.stepAt) {
        const s = this.steps[this.stepIdx % this.steps.length];
        this.stepAt = this.t + s.len;
        this.stepIdx++;
        this.cue = s.cue ? s.cue(this.animal, now) : null;
      }
    }
    const cur = this.steps[(this.stepIdx - 1 + this.steps.length) % this.steps.length];
    const pose = this.cue ? poseFor(this.cue, now) : null;
    if (this.cue && !pose) this.cue = null;
    const phase = Math.max(0, this.stepAt - this.t);
    const air = cur?.air && this.enter >= 1 ? Math.max(0, Math.sin(Math.min(1, (1 - phase / cur.len)) * Math.PI) * 1.1) : 0;
    rig.root.position.y += air;
    const warn = this.cue && now - this.cue.start < this.cue.wind ? 0.6 : 0;
    const st: RigState = { speed: cur?.speed ?? 0, attack: 0, hurt: 0, stun: false, flee: false, swim: false, t: now, pose, guard: !!cur?.guard, air, vy: 0, warn };
    rig.update(dt, st);
    this.renderer.render(this.scene, this.camera);
  }
}
