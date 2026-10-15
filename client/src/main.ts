import { Net } from './net';
import { EYE_HEIGHT, World } from './world';
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
  $('paused').hidden = !joined || typing || document.pointerLockElement === canvas;
}
document.addEventListener('pointerlockchange', updatePaused);
canvas.addEventListener('click', () => joined && !typing && world.lock());

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
  } else if (e.code === 'KeyM' && !typing && voice) {
    voice.setMuted(!voice.muted);
    updateHud();
  }
});

// ---------- per-frame sync ----------
let lastSent = 0;
let sx = NaN;
let sz = NaN;
let sry = NaN;
const fwd = { x: 0, y: 0, z: 0 };

world.onFrame = () => {
  if (!joined) return;
  const now = performance.now();

  if (now - lastSent > 66) {
    lastSent = now;
    const { x, z } = world.pos;
    if (Math.abs(x - sx) > 1e-3 || Math.abs(z - sz) > 1e-3 || Math.abs(world.yaw - sry) > 1e-3) {
      sx = x;
      sz = z;
      sry = world.yaw;
      net.send({ t: 'pos', x, z, ry: world.yaw });
    }
  }

  if (voice) {
    const e = world.camera.matrixWorld.elements; // third column = camera +Z, so forward = -Z
    fwd.x = -e[8];
    fwd.y = -e[9];
    fwd.z = -e[10];
    voice.updateListener(world.pos.x, world.pos.y, world.pos.z, fwd.x, fwd.y, fwd.z);
    for (const [id, a] of world.avatars) voice.setPeerPosition(id, a.group.position.x, EYE_HEIGHT, a.group.position.z);
    voice.tick(now);
    for (const id of world.avatars.keys()) world.setSpeaking(id, voice.speaking.has(id));
    $('mic').classList.toggle('speaking', voice.speaking.has('me'));
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
      world.teleport(m.spawn.x, m.spawn.z);
      voice?.setIce(m.iceServers as RTCIceServer[]);
      for (const p of m.players) {
        names.set(p.id, p.name);
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
      world.addPlayer(m.player);
      addChat('•', `${m.player.name} joined`);
      updateHud();
      break;
    case 'left':
      addChat('•', `${names.get(m.id) ?? 'Someone'} left`);
      names.delete(m.id);
      world.removePlayer(m.id);
      voice?.removePeer(m.id);
      updateHud();
      break;
    case 'state':
      for (const [id, x, z, ry] of m.p) world.applyState(id, x, z, ry);
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
