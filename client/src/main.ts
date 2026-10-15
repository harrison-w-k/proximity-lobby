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
let voice: Voice | null = null;
let joined = false;
let typing = false;
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
  updatePaused();
}

function closeMenu(relock: boolean) {
  if (!menuOpen) return;
  menuOpen = false;
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
}

// While looking at a player (and not in a menu), the scroll wheel adjusts their volume.
const targetBox = $('target');
let lookId: string | null = null;

function showTarget() {
  if (!lookId) {
    targetBox.hidden = true;
    return;
  }
  targetBox.hidden = false;
  targetBox.replaceChildren(
    document.createTextNode(`${names.get(lookId) ?? 'Player'} · 🔊 ${pct(volumes.get(lookId) ?? 1)} `),
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

function addChat(name: string, text: string) {
  const line = document.createElement('div');
  line.className = 'line';
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

function closeChat(send: boolean) {
  const text = chatInput.value.trim();
  if (send && text) net.send({ t: 'chat', text });
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
    const e = world.camera.matrixWorld.elements; // third column = camera +Z, so forward = -Z
    fwd.x = -e[8];
    fwd.y = -e[9];
    fwd.z = -e[10];
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
      if (menuOpen) renderPlayerList();
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

// With Supabase configured the player signs in with an emailed magic link and joins under the
// username in their verified profile. Without it, the old unverified email flow is used.
const supabase = getSupabase();
const emailInput = $<HTMLInputElement>('email');
const joinBtn = $<HTMLButtonElement>('join-btn');
const signoutBtn = $<HTMLButtonElement>('signout-btn');
const status = $('status');
let profileName = ''; // set while signed in

try {
  emailInput.value = localStorage.getItem('email') ?? '';
} catch {
  /* storage unavailable */
}

function setStatus(text: string, ok = false) {
  status.textContent = text;
  status.classList.toggle('ok', ok);
}

async function showSignedIn(userId: string) {
  const { data, error } = await supabase!.from('profiles').select('username').eq('id', userId).maybeSingle();
  if (error || !data) {
    setStatus('Signed in, but your profile could not be loaded. Please reload.');
    return;
  }
  profileName = data.username;
  $('who').textContent = `Signed in. You will appear as “${profileName}”.`;
  $('who').hidden = false;
  $('join-note').hidden = true;
  emailInput.hidden = true;
  emailInput.required = false;
  signoutBtn.hidden = false;
  joinBtn.textContent = 'Join';
  joinBtn.disabled = false;
  setStatus('');
}

function showSignedOut() {
  profileName = '';
  $('who').hidden = true;
  $('join-note').hidden = false;
  $('join-note').textContent =
    'Sign in with your email to get a username other players will see. We send you a one-time link; no password needed.';
  emailInput.hidden = false;
  emailInput.required = true;
  signoutBtn.hidden = true;
  joinBtn.textContent = 'Email me a sign-in link';
  joinBtn.disabled = false;
}

if (supabase) {
  showSignedOut();
  supabase.auth.onAuthStateChange((_event, session) => {
    // Defer: calling supabase inside this callback can deadlock.
    setTimeout(() => (session ? void showSignedIn(session.user.id) : showSignedOut()), 0);
  });
  signoutBtn.addEventListener('click', () => void supabase.auth.signOut());
}

async function enterLobby(name: string, token?: string) {
  joinBtn.disabled = true;
  setStatus('Requesting microphone…');

  voice = new Voice((to, data) => net.send({ t: 'signal', to, data }));
  await voice.init(); // continues without a mic if denied

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

$<HTMLFormElement>('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!supabase) {
    try {
      localStorage.setItem('email', emailInput.value);
    } catch {
      /* storage unavailable */
    }
    await enterLobby(usernameFromEmail(emailInput.value));
    return;
  }

  if (!profileName) {
    joinBtn.disabled = true;
    const email = emailInput.value.trim();
    try {
      localStorage.setItem('email', email);
    } catch {
      /* storage unavailable */
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/` },
    });
    joinBtn.disabled = false;
    if (error) setStatus(`Could not send the link: ${error.message}`);
    else setStatus('Check your inbox and click the link. This page will update when you are signed in.', true);
    return;
  }

  const { data } = await supabase.auth.getSession(); // refreshes an expired token
  if (!data.session) {
    showSignedOut();
    setStatus('Your session expired. Please sign in again.');
    return;
  }
  await enterLobby(profileName, data.session.access_token);
});
