import type { World } from './world';

/** True on phones and tablets (a coarse pointer and no hover), or with ?touch in the address. */
export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (new URLSearchParams(location.search).has('touch') ||
    ((window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window) &&
      !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches));

export interface TouchHooks {
  openMenu(): void;
  openChat(): void;
  /** The throw button was let go: send the throw at the charged power. */
  releaseThrow(): void;
}

/**
 * On-screen controls: a joystick on the left (push far forward to sprint), drag anywhere on the
 * right to look, and buttons for jump, crouch / slide, grab, pick up / set down, throw (hold to
 * charge, let go to throw), chat and the menu. Everything feeds the same inputs as the keyboard.
 */
export function initTouch(world: World, hooks: TouchHooks) {
  world.touchMode = true;
  const root = document.createElement('div');
  root.id = 'touch';
  root.hidden = true;
  root.innerHTML = `
    <div id="t-stick"><div id="t-knob"></div></div>
    <div id="t-look"></div>
    <button id="t-menu" class="tb" aria-label="Menu">&#9776;</button>
    <button id="t-chat" class="tb" aria-label="Chat">&#128172;</button>
    <button id="t-view" class="tb" aria-label="Camera">&#128247;</button>
    <button id="t-jump" class="tb big" aria-label="Jump">JUMP</button>
    <button id="t-crouch" class="tb" aria-label="Crouch or slide">SLIDE</button>
    <button id="t-grab" class="tb" aria-label="Grab a ledge">GRAB</button>
    <button id="t-item" class="tb" aria-label="Pick up or set down">F</button>
    <button id="t-throw" class="tb" aria-label="Throw">R</button>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;

  // ---- joystick ----
  const stick = $('t-stick');
  const knob = $('t-knob');
  let stickId: number | null = null;
  let cx = 0;
  let cy = 0;
  const RADIUS = 56;
  const setStick = (x: number, y: number) => {
    let dx = x - cx;
    let dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    world.touchS = Math.abs(dx) / RADIUS < 0.15 ? 0 : dx / RADIUS;
    world.touchF = Math.abs(dy) / RADIUS < 0.15 ? 0 : -dy / RADIUS;
    world.touchSprint = world.touchF > 0.9; // push all the way forward to sprint
  };
  const endStick = () => {
    stickId = null;
    knob.style.transform = '';
    world.touchF = world.touchS = 0;
    world.touchSprint = false;
  };
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    setStick(e.clientX, e.clientY);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) setStick(e.clientX, e.clientY);
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) {
    stick.addEventListener(ev, (e) => {
      if (e.pointerId === stickId) endStick();
    });
  }

  // ---- look: drag on the right half ----
  const look = $('t-look');
  let lookId: number | null = null;
  let lx = 0;
  let ly = 0;
  look.addEventListener('pointerdown', (e) => {
    lookId = e.pointerId;
    look.setPointerCapture(e.pointerId);
    lx = e.clientX;
    ly = e.clientY;
    e.preventDefault();
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    world.look(e.clientX - lx, e.clientY - ly);
    lx = e.clientX;
    ly = e.clientY;
  });
  for (const ev of ['pointerup', 'pointercancel'] as const) {
    look.addEventListener(ev, (e) => {
      if (e.pointerId === lookId) lookId = null;
    });
  }

  // ---- buttons ----
  const hold = (id: string, code: string) => {
    const b = $(id);
    const on = (e: Event) => {
      world.setKey(code, true);
      b.classList.add('down');
      e.preventDefault();
    };
    const off = () => {
      world.setKey(code, false);
      b.classList.remove('down');
    };
    b.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, off);
  };
  hold('t-jump', 'Space');
  hold('t-crouch', 'KeyC');
  hold('t-grab', 'KeyE');

  const tap = (id: string, fn: () => void) => {
    $(id).addEventListener('pointerdown', (e) => {
      fn();
      e.preventDefault();
    });
  };
  tap('t-menu', hooks.openMenu);
  tap('t-chat', hooks.openChat);
  tap('t-view', () => world.cycleView());
  tap('t-item', () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' })));

  // throw: press to start aiming and charging, let go to throw
  const throwBtn = $('t-throw');
  throwBtn.addEventListener('pointerdown', (e) => {
    throwBtn.setPointerCapture(e.pointerId);
    throwBtn.classList.add('down');
    if (world.holding !== null && !world.aiming) world.startAim();
    if (world.aiming) world.charging = true;
    e.preventDefault();
  });
  const endThrow = () => {
    throwBtn.classList.remove('down');
    if (world.aiming && world.charging) hooks.releaseThrow();
  };
  throwBtn.addEventListener('pointerup', endThrow);
  throwBtn.addEventListener('pointercancel', () => {
    throwBtn.classList.remove('down');
    world.cancelAim();
  });

  // no browser gestures (scroll, zoom, long-press menu) on the game
  for (const ev of ['gesturestart', 'contextmenu'] as const) document.addEventListener(ev, (e) => e.preventDefault());

  return {
    show(on: boolean) {
      root.hidden = !on;
      if (!on) endStick();
    },
  };
}
