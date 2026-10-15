import { Net } from './net';
import { DEFAULT_FOV, EYE_HEIGHT, World } from './world';
import { Voice } from './voice';
import { getSupabase } from './supabase';
import type { ServerMsg } from '../../shared/protocol';
import { MAX_PLAYERS } from '../../shared/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('scene');
const world = new World(canvas);
const net = new Net();
// Dev server only (stripped from production builds): lets automated checks pose the scene.
if (import.meta.env.DEV) (window as unknown as { __world?: World }).__world = world;
let voice: Voice | null = null;
let joined = false;
let typing = false;
let myId = '';
let lastDmPeer = ''; // who last whispered to us, for /r
const names = new Map<string, string>(); // other players: id -> name

// ---------- HUD ----------
function updateHud() {
  const others = names.size;
  const linked = voice?.connectedCount() ?? 0;
  $('players').textContent = `Players ${others + 1}/${MAX_PLAYERS} · Voice links ${linked}/${others}`;
  const mic = $('mic');
  mic.classList.toggle('off', !voice?.hasMic || voice.muted);
  if (!voice?.hasMic) mic.textContent = '🎤 No mic — listening only';
  else if (voice.muted) mic.textContent = '🔇 Muted (M to unmute)';
  else mic.textContent = '🎤 Live (M to mute)';
}
setInterval(() => joined && updateHud(), 500);

function updatePaused() {
  $('paused').hidden = !joined || typing || menuOpen || document.pointerLockElement === canvas;
}
// Losing the mouse (Esc, alt-tab) opens settings so the mouse can be used. Opening chat also
// releases it, but that sets `typing` first so the menu stays closed.
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) openMenu();
  updatePaused();
});
canvas.addEventListener('click', () => joined && !typing && world.lock());

// ---------- settings menu ----------
const settings = $('settings');
const sensInput = $<HTMLInputElement>('sens');
const micBtn = $<HTMLButtonElement>('mic-btn');
let menuOpen = false;
let menuOpenedAt = 0;

function setSensitivity(v: number, save: boolean) {
  world.lookSensitivity = v;
  $('sens-val').textContent = `${v.toFixed(1)}×`;
  if (!save) return;
  try {
    localStorage.setItem('sensitivity', String(v));
  } catch {
    /* storage unavailable */
  }
}

function refreshMenu() {
  if (!voice?.hasMic) {
    micBtn.textContent = '🎤 No microphone detected';
    micBtn.disabled = true;
  } else {
    micBtn.textContent = voice.muted ? '🔇 Unmute microphone' : '🎤 Mute microphone';
    micBtn.disabled = false;
  }
}

function openMenu() {
  if (menuOpen || !joined || typing) return;
  menuOpen = true;
  menuOpenedAt = performance.now();
  world.inputEnabled = false;
  world.clearKeys();
  settings.hidden = false;
  refreshMenu();
  renderPlayerList();
  syncAudioControls();
  void refreshDevices();
  refreshRanges();
  updatePaused();
}

function closeMenu(relock: boolean) {
  if (!menuOpen) return;
  menuOpen = false;
  setTesting(false);
  settings.hidden = true;
  world.inputEnabled = true;
  if (relock) world.lock();
  updatePaused();
}

try {
  const saved = Number(localStorage.getItem('sensitivity'));
  if (saved >= 0.3 && saved <= 2.5) sensInput.value = String(saved);
} catch {
  /* storage unavailable */
}
setSensitivity(Number(sensInput.value), false);
sensInput.addEventListener('input', () => setSensitivity(Number(sensInput.value), true));
$('sens-reset').addEventListener('click', () => {
  sensInput.value = '1';
  setSensitivity(1, true);
});

// Field of view
const fovInput = $<HTMLInputElement>('fov');
function setFov(v: number, save: boolean) {
  world.setFov(v);
  $('fov-val').textContent = `${Math.round(v)}°`;
  if (!save) return;
  try {
    localStorage.setItem('fov', String(v));
  } catch {
    /* storage unavailable */
  }
}
try {
  const saved = Number(localStorage.getItem('fov'));
  fovInput.value = String(saved >= 60 && saved <= 110 ? saved : DEFAULT_FOV);
} catch {
  fovInput.value = String(DEFAULT_FOV);
}
setFov(Number(fovInput.value), false);
fovInput.addEventListener('input', () => setFov(Number(fovInput.value), true));

// Per-player volume: what *you* hear from each player, remembered by their username.
const VOL_KEY = 'voiceVolumes';
let savedVolumes: Record<string, number> = {};
try {
  const raw = JSON.parse(localStorage.getItem(VOL_KEY) ?? '{}');
  if (raw && typeof raw === 'object') savedVolumes = raw;
} catch {
  /* storage unavailable or corrupt */
}
const volumes = new Map<string, number>(); // player id -> volume multiplier

function applySavedVolume(id: string, name: string) {
  const v = savedVolumes[name];
  const vol = typeof v === 'number' && v >= 0 && v <= 2 ? v : 1;
  volumes.set(id, vol);
  voice?.setPeerVolume(id, vol);
}

function setPlayerVolume(id: string, v: number) {
  v = Math.max(0, Math.min(2, v));
  volumes.set(id, v);
  voice?.setPeerVolume(id, v);
  const name = names.get(id);
  if (!name) return;
  if (Math.abs(v - 1) < 0.005) delete savedVolumes[name];
  else savedVolumes[name] = Math.round(v * 100) / 100;
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify(savedVolumes));
  } catch {
    /* storage unavailable */
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const playersList = $('players-list');

function renderPlayerList() {
  playersList.replaceChildren();
  $('players-note').hidden = names.size === 0;
  for (const [id, name] of names) {
    const row = document.createElement('div');
    row.className = 'pl-row';
    const label = document.createElement('span');
    label.textContent = name; // textContent only: names are other players' input
    const val = document.createElement('span');
    val.className = 'pl-val';
    val.textContent = pct(volumes.get(id) ?? 1);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '200';
    slider.step = '5';
    slider.value = String(Math.round((volumes.get(id) ?? 1) * 100));
    slider.setAttribute('aria-label', `Volume for ${name}`);
    slider.addEventListener('input', () => {
      setPlayerVolume(id, Number(slider.value) / 100);
      val.textContent = pct(volumes.get(id) ?? 1);
    });
    row.append(label, val, slider);
    playersList.append(row);
  }
  refreshRanges();
}

// While looking at a player (and not in a menu), the scroll wheel adjusts their volume.
const targetBox = $('target');
let lookId: string | null = null;

let targetShown = '';
function showTarget() {
  if (!lookId) {
    if (targetShown !== '') {
      targetBox.hidden = true;
      targetShown = '';
    }
    return;
  }
  const label = `${names.get(lookId) ?? 'Player'} · 🔊 ${pct(volumes.get(lookId) ?? 1)} `;
  if (label === targetShown) return; // called every frame; only touch the DOM when the text changes
  targetShown = label;
  targetBox.hidden = false;
  targetBox.replaceChildren(
    document.createTextNode(label),
    Object.assign(document.createElement('small'), { textContent: '(scroll to adjust)' }),
  );
}

window.addEventListener(
  'wheel',
  (e) => {
    if (!lookId || typing || menuOpen) return;
    e.preventDefault();
    setPlayerVolume(lookId, (volumes.get(lookId) ?? 1) - e.deltaY * 0.0005);
    showTarget();
  },
  { passive: false },
);

// ---- Audio: devices, volumes and a mic test ----
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  },
};
function savedVolume(key: string): number {
  const raw = store.get(key);
  const v = raw === null ? NaN : Number(raw);
  return v >= 0 && v <= 2 ? v : 1;
}

const inDevice = $<HTMLSelectElement>('in-device');
const outDevice = $<HTMLSelectElement>('out-device');
const inVol = $<HTMLInputElement>('in-vol');
const outVol = $<HTMLInputElement>('out-vol');
const meterFill = $('meter-fill');
const testBtn = $<HTMLButtonElement>('test-btn');
let testing = false;

/** Apply remembered volumes and output device once the voice engine exists. */
function applyAudioPrefs() {
  if (!voice) return;
  voice.setInputVolume(savedVolume('inVol'));
  voice.setOutputVolume(savedVolume('outVol'));
  const out = store.get('audioOut');
  if (out) void voice.setOutputDevice(out);
}

function syncAudioControls() {
  inVol.value = String(Math.round(savedVolume('inVol') * 100));
  outVol.value = String(Math.round(savedVolume('outVol') * 100));
  $('in-vol-val').textContent = pct(savedVolume('inVol'));
  $('out-vol-val').textContent = pct(savedVolume('outVol'));
}

async function refreshDevices() {
  if (!voice) return;
  const { inputs, outputs } = await voice.listDevices();
  const fill = (sel: HTMLSelectElement, devs: MediaDeviceInfo[], current: string, fallback: string) => {
    sel.replaceChildren();
    devs.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `${fallback} ${i + 1}`; // labels are empty until the mic is allowed
      sel.append(opt);
    });
    if (current && devs.some((d) => d.deviceId === current)) sel.value = current;
    sel.disabled = devs.length === 0;
  };
  fill(inDevice, inputs, voice.currentInputId, 'Microphone');
  fill(outDevice, outputs, voice.currentOutputId || 'default', 'Speakers');
  outDevice.disabled = !voice.canChooseOutput || outputs.length === 0;
  $('out-note').hidden = voice.canChooseOutput;
}

function setTesting(on: boolean) {
  testing = on;
  voice?.setMonitor(on);
  testBtn.textContent = on ? 'Stop testing' : 'Test microphone';
  testBtn.classList.toggle('active', on);
}

inVol.addEventListener('input', () => {
  const v = Number(inVol.value) / 100;
  voice?.setInputVolume(v);
  $('in-vol-val').textContent = pct(v);
  store.set('inVol', String(v));
});
outVol.addEventListener('input', () => {
  const v = Number(outVol.value) / 100;
  voice?.setOutputVolume(v);
  $('out-vol-val').textContent = pct(v);
  store.set('outVol', String(v));
});
inDevice.addEventListener('change', async () => {
  if (!voice) return;
  if (await voice.setInputDevice(inDevice.value)) store.set('audioIn', inDevice.value);
  else void refreshDevices(); // that device failed; show what is actually in use
  refreshMenu();
  updateHud();
});
outDevice.addEventListener('change', async () => {
  if (!voice) return;
  if (await voice.setOutputDevice(outDevice.value)) store.set('audioOut', outDevice.value);
  else void refreshDevices();
});
testBtn.addEventListener('click', () => setTesting(!testing));
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (menuOpen) void refreshDevices();
});
setInterval(() => {
  if (menuOpen && voice) meterFill.style.width = `${Math.round(voice.inputLevel() * 100)}%`;
}, 50);
syncAudioControls();

// Settings tabs
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
function showTab(name: string) {
  if (name !== 'audio') setTesting(false); // never leave "hear myself" running unseen
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll<HTMLElement>('.pane').forEach((p) => (p.hidden = p.dataset.pane !== name));
}
tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab ?? 'gameplay')));

// Paint each slider's filled portion (the CSS reads --p).
function fillRange(el: HTMLInputElement) {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  el.style.setProperty('--p', `${((Number(el.value) - min) / (max - min)) * 100}%`);
}
function refreshRanges() {
  document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(fillRange);
}
document.addEventListener('input', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') fillRange(e.target);
});

$('resume-btn').addEventListener('click', () => closeMenu(true));
micBtn.addEventListener('click', () => {
  if (!voice?.hasMic) return;
  voice.setMuted(!voice.muted);
  refreshMenu();
  updateHud();
});
$('leave-btn').addEventListener('click', () => {
  leaving = true;
  location.reload();
});

// Ctrl is sprint, and Ctrl+W closes the tab: ask first so one slip doesn't drop you from the lobby.
let leaving = false;
window.addEventListener('beforeunload', (e) => {
  if (joined && !leaving && $('dead').hidden) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- chat ----------
const chatBox = $('chat');
const chatLog = $('chat-log');
const chatInput = $<HTMLInputElement>('chat-input');

function addChat(name: string, text: string, kind = '') {
  const line = document.createElement('div');
  line.className = kind ? `line ${kind}` : 'line';
  const who = document.createElement('b');
  who.textContent = `${name}: `;
  line.append(who, document.createTextNode(text)); // textContent only: no HTML injection
  chatLog.append(line);
  while (chatLog.children.length > 50) chatLog.firstElementChild!.remove();
  setTimeout(() => line.classList.add('old'), 12_000);
}

function openChat() {
  closeMenu(false);
  typing = true;
  world.inputEnabled = false;
  world.clearKeys();
  chatBox.classList.add('open');
  chatInput.hidden = false;
  chatInput.value = '';
  chatInput.focus();
  document.exitPointerLock();
  updatePaused();
}

const DM_USAGE = 'Private message: /msg @name your message   (reply with /r your message)';

/** Plain text goes to everyone; /msg @name text, /w and /r are private. */
function submitChat(text: string) {
  if (!text.startsWith('/')) {
    net.send({ t: 'chat', text });
    return;
  }
  const cmd = /^\/(msg|w|whisper|r|reply)\b\s*(.*)$/i.exec(text);
  if (!cmd) {
    addChat('•', `Unknown command. ${DM_USAGE}`);
    return;
  }
  const rest = cmd[2].trim();
  if (/^(r|reply)$/i.test(cmd[1])) {
    if (!lastDmPeer || !names.has(lastDmPeer)) addChat('•', 'Nobody has messaged you yet, or they left.');
    else if (!rest) addChat('•', 'Type a message after /r.');
    else net.send({ t: 'dm', to: lastDmPeer, text: rest });
    return;
  }
  // Names can contain spaces, so match the longest player name the text starts with.
  const target = rest.replace(/^@/, '');
  const lower = target.toLowerCase();
  let best = '';
  for (const [id, name] of names) {
    const n = name.toLowerCase();
    if ((lower === n || lower.startsWith(`${n} `)) && (!best || name.length > (names.get(best)?.length ?? 0))) best = id;
  }
  if (!best) {
    addChat('•', `No player like that is here. ${DM_USAGE}`);
    return;
  }
  const body = target.slice((names.get(best) ?? '').length).trim();
  if (!body) addChat('•', `Type a message after @${names.get(best)}.`);
  else net.send({ t: 'dm', to: best, text: body });
}

function closeChat(send: boolean) {
  const text = chatInput.value.trim();
  if (send && text) submitChat(text);
  typing = false;
  chatBox.classList.remove('open');
  chatInput.hidden = true;
  chatInput.blur();
  world.inputEnabled = true;
  world.lock();
  updatePaused();
}

window.addEventListener('keydown', (e) => {
  if (!joined) return;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    e.preventDefault();
    typing ? closeChat(true) : openChat();
  } else if (e.code === 'Escape' && typing) {
    closeChat(false);
  } else if (e.code === 'Escape' && menuOpen) {
    // Ignore the Esc that opened the menu, in case the browser also delivers it as a keydown.
    if (performance.now() - menuOpenedAt > 250) closeMenu(true);
  } else if (e.code === 'KeyM' && !typing && voice) {
    voice.setMuted(!voice.muted);
    refreshMenu();
    updateHud();
  } else if (e.code === 'KeyT' && !typing && !menuOpen && !e.ctrlKey && !e.metaKey && !e.repeat) {
    world.cycleView();
  }
});

// ---------- per-frame sync ----------
let lastSent = 0;
let sx = NaN;
let sz = NaN;
let sry = NaN;
let sy = NaN;
let scrouch = false;
const fwd = { x: 0, y: 0, z: 0 };

world.onSentHome = () => addChat('•', 'You drifted too far out. Back to the island!');

world.onFrame = () => {
  if (!joined) return;
  const now = performance.now();

  if (now - lastSent > 66) {
    lastSent = now;
    const { x, z } = world.pos;
    const changed =
      Math.abs(x - sx) > 1e-3 ||
      Math.abs(z - sz) > 1e-3 ||
      Math.abs(world.yaw - sry) > 1e-3 ||
      Math.abs(world.feetY - sy) > 1e-3 ||
      world.crouching !== scrouch;
    if (changed) {
      sx = x;
      sz = z;
      sry = world.yaw;
      sy = world.feetY;
      scrouch = world.crouching;
      net.send({ t: 'pos', x, z, ry: world.yaw, y: sy, crouch: scrouch });
    }
  }

  if (voice) {
    // Hear in the direction *you* face, not where the camera is (the front view looks back at you).
    const cp = Math.cos(world.pitch);
    fwd.x = -Math.sin(world.yaw) * cp;
    fwd.y = Math.sin(world.pitch);
    fwd.z = -Math.cos(world.yaw) * cp;
    voice.updateListener(world.pos.x, world.pos.y, world.pos.z, fwd.x, fwd.y, fwd.z);
    for (const [id, a] of world.avatars) voice.setPeerPosition(id, a.group.position.x, a.group.position.y + EYE_HEIGHT, a.group.position.z);
    voice.tick(now);
    for (const id of world.avatars.keys()) world.setSpeaking(id, voice.speaking.has(id));
    $('mic').classList.toggle('speaking', voice.speaking.has('me'));
  }

  // Who is under the crosshair (for the volume prompt)? Only while actually playing.
  const playing = !menuOpen && !typing && document.pointerLockElement === canvas;
  const id = playing ? world.playerUnderCrosshair(20) : null;
  if (id !== lookId || id) {
    lookId = id;
    showTarget();
  }
};

// ---------- networking ----------
net.onClose = () => {
  if (joined) $('dead').hidden = false;
};

net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'welcome':
      joined = true;
      myId = m.id;
      world.orbit = false;
      world.setSelfId(m.id);
      world.teleport(m.spawn.x, m.spawn.z);
      voice?.setIce(m.iceServers as RTCIceServer[]);
      for (const p of m.players) {
        names.set(p.id, p.name);
        applySavedVolume(p.id, p.name);
        world.addPlayer(p);
        void voice?.connect(p.id); // we're the newcomer, so we make the offers
      }
      $('join').hidden = true;
      $('hud').hidden = false;
      $('chat').hidden = false;
      $('crosshair').hidden = false;
      updateHud();
      world.lock();
      updatePaused();
      break;
    case 'full':
      $('status').textContent = 'The lobby is full (20/20). Try again soon.';
      ($('join-btn') as HTMLButtonElement).disabled = false;
      break;
    case 'denied':
      $('status').textContent = m.reason;
      ($('join-btn') as HTMLButtonElement).disabled = false;
      break;
    case 'joined':
      names.set(m.player.id, m.player.name);
      applySavedVolume(m.player.id, m.player.name);
      world.addPlayer(m.player);
      addChat('•', `${m.player.name} joined`);
      updateHud();
      if (menuOpen) {
        renderPlayerList();
        refreshRanges();
      }
      break;
    case 'left':
      addChat('•', `${names.get(m.id) ?? 'Someone'} left`);
      names.delete(m.id);
      volumes.delete(m.id);
      world.removePlayer(m.id);
      voice?.removePeer(m.id);
      updateHud();
      if (menuOpen) renderPlayerList();
      break;
    case 'state':
      for (const [id, x, z, ry, y, crouch] of m.p) world.applyState(id, x, z, ry, y ?? 0, crouch === 1);
      break;
    case 'chat':
      addChat(m.name, m.text);
      break;
    case 'dm': {
      const mine = m.fromId === myId;
      if (!mine) lastDmPeer = m.fromId;
      addChat(mine ? `You → ${m.to}` : `${m.from} → you`, m.text, 'dm');
      break;
    }
    case 'notice':
      addChat('•', m.text);
      break;
    case 'signal':
      void voice?.handleSignal(m.from, m.data);
      break;
  }
};

// ---------- join ----------
/** "Jane.Doe+games@x.edu" -> "jane.doe" (the part before the @, lowercased and sanitised). */
export function usernameFromEmail(email: string): string {
  const local = email.split('@')[0].split('+')[0];
  return local.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 16);
}

// With Supabase configured, players log in with email + password (the same accounts as NBFC),
// with email confirmation, forgot-password and a new-password form. The server verifies the
// login token and uses the account's username. Without Supabase, the old email-only join is used.
const supabase = getSupabase();
type Mode = 'legacy' | 'login' | 'signup' | 'confirm' | 'recovery' | 'in';
let mode: Mode = supabase ? 'login' : 'legacy';
let profileName = ''; // set while signed in
let confirmEmail = ''; // the address a confirmation code was sent to

const joinBtn = $<HTMLButtonElement>('join-btn');
const usernameInput = $<HTMLInputElement>('auth-username');
const emailInput = $<HTMLInputElement>('email');
const pwInput = $<HTMLInputElement>('auth-password');
const pw2Input = $<HTMLInputElement>('auth-password2');
const codeInput = $<HTMLInputElement>('auth-code');
const resendBtn = $<HTMLButtonElement>('resend-btn');
const forgotBtn = $<HTMLButtonElement>('forgot-btn');
const toggleBtn = $<HTMLButtonElement>('toggle-btn');
const signoutBtn = $<HTMLButtonElement>('signout-btn');
const status = $('status');

try {
  emailInput.value = localStorage.getItem('email') ?? '';
} catch {
  /* storage unavailable */
}

function setStatus(text: string, ok = false) {
  status.textContent = text;
  status.classList.toggle('ok', ok);
}

const NOTES: Record<Mode, string> = {
  legacy: 'Your username is the part of your email before the @, and other players will see it. Your email itself is never sent to the server.',
  login: 'Log in with your account. It is the same email and password as NBFC.',
  signup: 'Create an account. It also works on NBFC. Other players will see your username.',
  confirm: 'We emailed you a confirmation. Tap the link in it, or type the code here.',
  recovery: 'Choose a new password for your account.',
  in: '',
};

const TITLES: Record<Mode, string> = {
  legacy: 'Join the lobby',
  login: 'Welcome back',
  signup: 'Create account',
  confirm: 'Check your email',
  recovery: 'New password',
  in: 'Ready to play',
};

/** Show only the fields that belong to the current step. */
function render() {
  const show = (el: HTMLElement, on: boolean) => (el.hidden = !on);
  const need = (el: HTMLInputElement, on: boolean) => {
    show(el, on);
    el.required = on;
  };
  need(usernameInput, mode === 'signup');
  need(emailInput, mode === 'legacy' || mode === 'login' || mode === 'signup');
  need(pwInput, mode === 'login' || mode === 'signup' || mode === 'recovery');
  need(pw2Input, mode === 'recovery');
  need(codeInput, mode === 'confirm');
  pwInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  pwInput.placeholder = mode === 'recovery' ? 'New password' : 'Password';
  show(forgotBtn, mode === 'login');
  show(resendBtn, mode === 'confirm');
  show(signoutBtn, mode === 'in');
  show(toggleBtn, mode === 'login' || mode === 'signup' || mode === 'confirm');
  toggleBtn.textContent =
    mode === 'login' ? 'Need an account? Sign up' : mode === 'signup' ? 'Already have an account? Log in' : 'Back to log in';
  joinBtn.textContent =
    { legacy: 'Join', login: 'Log in', signup: 'Sign up', confirm: 'Confirm email', recovery: 'Save new password', in: 'Join' }[mode];
  $('join-note').textContent = NOTES[mode];
  $('card-title').textContent = TITLES[mode];
  show($('join-note'), mode !== 'in');
  show($('who'), mode === 'in');
  if (mode === 'in') $('who').textContent = `Signed in. You will appear as “${profileName}”.`;
  joinBtn.disabled = false;
}

function go(next: Mode, message = '', ok = false) {
  mode = next;
  render();
  setStatus(message, ok);
}

const friendly = (message: string) =>
  /rate limit|only request this after/i.test(message)
    ? 'An email was sent very recently. Please wait a minute and try again.'
    : message;

async function showSignedIn(userId: string) {
  const { data, error } = await supabase!.from('profiles').select('username').eq('id', userId).maybeSingle();
  if (error || !data?.username) {
    await supabase!.auth.signOut();
    go('login', 'Signed in, but your account has no username yet. Please sign up again or contact the admin.');
    return;
  }
  profileName = data.username;
  go('in');
}

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    // Defer: calling supabase inside this callback can deadlock.
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') go('recovery');
      else if (session && mode !== 'recovery' && mode !== 'in') void showSignedIn(session.user.id);
      else if (!session && (mode === 'in' || mode === 'recovery')) go('login');
    }, 0);
  });
}

toggleBtn.addEventListener('click', () => go(mode === 'login' ? 'signup' : 'login'));
forgotBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    setStatus('Enter your email above, then tap Forgot password.');
    return;
  }
  const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
  if (error) setStatus(friendly(error.message));
  else setStatus('Check your email for a link to reset your password.', true);
});
resendBtn.addEventListener('click', async () => {
  const email = confirmEmail || emailInput.value.trim();
  if (!email) {
    setStatus('Enter your email first.');
    return;
  }
  const { error } = await supabase!.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: `${location.origin}/` },
  });
  if (error) setStatus(friendly(error.message));
  else setStatus('Sent again. Check your inbox (and spam).', true);
});
signoutBtn.addEventListener('click', () => void supabase!.auth.signOut());

async function enterLobby(name: string, token?: string) {
  joinBtn.disabled = true;
  setStatus('Requesting microphone…');

  // One Voice (AudioContext + mic) per page: browsers cap AudioContexts, and every failed or
  // repeated join used to leak another one.
  if (!voice) {
    voice = new Voice((to, data) => net.send({ t: 'signal', to, data }));
    await voice.init(store.get('audioIn') ?? undefined); // continues without a mic if denied
    applyAudioPrefs();
  }

  setStatus('Connecting…');
  try {
    await net.connect();
  } catch {
    setStatus('Could not reach the server.');
    joinBtn.disabled = false;
    return;
  }
  net.send({ t: 'join', name, token });
}

async function submit() {
  if (mode === 'legacy') {
    try {
      localStorage.setItem('email', emailInput.value);
    } catch {
      /* storage unavailable */
    }
    await enterLobby(usernameFromEmail(emailInput.value));
    return;
  }
  const sb = supabase!;
  const email = emailInput.value.trim();

  if (mode === 'in') {
    const { data } = await sb.auth.getSession(); // refreshes an expired token
    if (!data.session) {
      go('login', 'Your session expired. Please log in again.');
      return;
    }
    await enterLobby(profileName, data.session.access_token);
    return;
  }

  joinBtn.disabled = true;
  try {
    if (mode === 'login') {
      try {
        localStorage.setItem('email', email);
      } catch {
        /* storage unavailable */
      }
      const { error } = await sb.auth.signInWithPassword({ email, password: pwInput.value });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          confirmEmail = email;
          go('confirm', "Your email isn't confirmed yet. Tap the link in the email, enter its code, or resend it.");
        } else {
          setStatus(error.message);
        }
      }
      // success: onAuthStateChange moves us to the signed-in step
    } else if (mode === 'signup') {
      const username = usernameInput.value.trim();
      if (username.length < 3 || username.length > 16) {
        setStatus('Username must be 3 to 16 characters.');
        return;
      }
      if (pwInput.value.length < 6) {
        setStatus('Password must be 6+ characters.');
        return;
      }
      const { data, error } = await sb.auth.signUp({
        email,
        password: pwInput.value,
        options: { data: { username }, emailRedirectTo: `${location.origin}/` },
      });
      if (error) setStatus(friendly(error.message));
      else if (data.user && !data.session) {
        confirmEmail = email;
        go('confirm', 'Check your email: tap the link, or enter the code from it here.', true);
      }
    } else if (mode === 'confirm') {
      const code = codeInput.value.replace(/\s/g, '');
      if (!code) {
        setStatus('Enter the code from the email.');
        return;
      }
      const { error } = await sb.auth.verifyOtp({ email: confirmEmail || email, token: code, type: 'signup' });
      if (error) {
        setStatus(
          /expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Resend the email for a new one.' : error.message,
        );
      }
    } else if (mode === 'recovery') {
      if (pwInput.value.length < 6) {
        setStatus('Password must be 6+ characters.');
        return;
      }
      if (pwInput.value !== pw2Input.value) {
        setStatus("Passwords don't match.");
        return;
      }
      const { error } = await sb.auth.updateUser({ password: pwInput.value });
      if (error) setStatus(error.message);
      else {
        pwInput.value = pw2Input.value = '';
        const { data } = await sb.auth.getSession();
        if (data.session) {
          mode = 'login'; // lets showSignedIn proceed
          await showSignedIn(data.session.user.id);
          setStatus('Password updated.', true);
        } else go('login', 'Password updated. Please log in.', true);
      }
    }
  } finally {
    joinBtn.disabled = false;
  }
}

$<HTMLFormElement>('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void submit();
});
render();
