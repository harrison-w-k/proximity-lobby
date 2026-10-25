// The renderer and the frame loop. The match (Arena) draws into it; between matches it just stays blank.
import * as THREE from 'three';

export const DEFAULT_RENDER_HEIGHT = 480;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  /** Mouse-look sensitivity multiplier. */
  lookSensitivity = 1;
  /** Whoever is playing: called every frame with the time since the last one, then asked to draw. */
  external?: { update(dt: number): void; render(renderer: THREE.WebGLRenderer): void };
  private renderHeight = DEFAULT_RENDER_HEIGHT;
  private last = performance.now();
  private reported = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    window.addEventListener('resize', this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  /** Capture the mouse (needs a click or key press from the player). */
  lock() {
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => {});
    } catch {
      /* needs a user gesture; the "click to resume" prompt covers it */
    }
  }

  /** Internal resolution (pixels tall). The picture is scaled to the window with hard pixels; 1080+ is native. */
  setRenderHeight(h: number) {
    this.renderHeight = h;
    this.resize();
  }

  private resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = this.renderHeight >= 1080 ? 1 : Math.min(1, this.renderHeight / Math.max(1, h));
    this.renderer.setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)), false);
  };

  // three.js only schedules the next frame after this returns, so an exception here would freeze the game for good:
  // each stage is isolated, and each distinct error is logged once.
  private tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const ext = this.external;
    if (!ext) return;
    this.safe('update', () => ext.update(dt));
    this.safe('render', () => ext.render(this.renderer));
  };

  private safe(stage: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      const key = `${stage}: ${e instanceof Error ? e.message : String(e)}`;
      if (this.reported.has(key)) return;
      this.reported.add(key);
      console.error('[game] frame error (game kept running)', key, e);
    }
  }
}
