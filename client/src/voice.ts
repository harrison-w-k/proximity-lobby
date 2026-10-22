import { VOICE_MAX, VOICE_REF } from '../../shared/protocol';

interface Peer {
  filter?: BiquadFilterNode; // muffles the voice behind rocks and underwater
  gate?: GainNode; // closed when the speaker is on another channel
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  nodes: AudioNode[];
  panner?: PannerNode;
  gain?: GainNode; // per-player volume, set by the listener
  analyser?: AnalyserNode;
  el?: HTMLAudioElement;
  lastLoud: number;
}

const SPEAK_THRESHOLD = 0.02;
const SPEAK_HOLD_MS = 250;

/**
 * Peer-to-peer mesh voice (fine for <= 20 players). Each remote voice is routed through a
 * Web Audio PannerNode whose position follows that player's avatar, with a linear distance
 * falloff from VOICE_REF (full volume) to VOICE_MAX (silent) plus HRTF stereo panning.
 */
export class Voice {
  readonly ctx = new AudioContext();
  readonly speaking = new Set<string>(); // peer ids, plus 'me'
  muted = false;

  // Send path: mic -> inputGain -> sendDest. Peers always get sendDest's track, so changing the
  // microphone or its volume never needs a renegotiation. Receive path: peer -> gain -> master -> speakers.
  private rawMic: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private inputGain = this.ctx.createGain();
  private sendDest = this.ctx.createMediaStreamDestination();
  private meter = this.ctx.createAnalyser();
  private monitor = this.ctx.createGain(); // "hear myself" for the mic test; 0 = off
  private master = this.ctx.createGain();
  private meterBuf = new Uint8Array(1024);
  currentInputId = '';
  currentOutputId = '';
  private lastLocalLoud = 0;
  private peers = new Map<string, Peer>();
  private volumes = new Map<string, number>(); // peer id -> volume multiplier (1 = normal)
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  private buf = new Uint8Array(512);
  private refDist = VOICE_REF;
  private maxDist = VOICE_MAX;

  constructor(private signal: (to: string, data: unknown) => void) {
    const l = this.ctx.listener;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;

    this.meter.fftSize = 1024;
    this.monitor.gain.value = 0;
    this.inputGain.connect(this.sendDest);
    this.inputGain.connect(this.meter);
    this.inputGain.connect(this.monitor);
    this.monitor.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  get hasMic() {
    return this.rawMic !== null;
  }

  /** Output device switching needs AudioContext.setSinkId (Chromium browsers). */
  get canChooseOutput() {
    return typeof (this.ctx as unknown as { setSinkId?: unknown }).setSinkId === 'function';
  }

  setIce(servers: RTCIceServer[]) {
    if (servers.length) this.ice = servers;
  }

  /** Must be called from a user gesture (join click). Returns false if there's no mic. */
  async init(preferredInput?: string): Promise<boolean> {
    await this.ctx.resume().catch(() => {});
    return this.openMic(preferredInput);
  }

  /** (Re)open the microphone, optionally a specific device. Keeps the old one if the new one fails. */
  private async openMic(deviceId?: string): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { ideal: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      return false;
    }
    this.micSource?.disconnect();
    this.rawMic?.getTracks().forEach((t) => t.stop());
    this.rawMic = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.inputGain);
    this.currentInputId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? '';
    return true;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.sendDest.stream.getAudioTracks().forEach((t) => (t.enabled = !m));
  }

  async setInputDevice(id: string): Promise<boolean> {
    return this.openMic(id);
  }

  async setOutputDevice(id: string): Promise<boolean> {
    if (!this.canChooseOutput) return false;
    try {
      await (this.ctx as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(id === 'default' ? '' : id);
      this.currentOutputId = id;
      return true;
    } catch {
      return false;
    }
  }

  /** What you send, as a multiplier (1 = unchanged). */
  setInputVolume(v: number) {
    this.inputGain.gain.value = v;
  }

  /** Everything you hear, as a multiplier (1 = unchanged). */
  setOutputVolume(v: number) {
    this.master.gain.value = v;
  }

  /** Mic test: play your own (post-volume) voice back to you. Use headphones. */
  setMonitor(on: boolean) {
    this.monitor.gain.value = on ? 1 : 0;
  }

  /** Current microphone level after the input volume, 0..1 (perceptual). Cheap enough to call often. */
  inputLevel(): number {
    this.meter.getByteTimeDomainData(this.meterBuf);
    let sum = 0;
    for (const v of this.meterBuf) sum += ((v - 128) / 128) ** 2;
    const rms = Math.sqrt(sum / this.meterBuf.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-4));
    return Math.min(1, Math.max(0, (db + 60) / 60));
  }

  async listDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }> {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return {
        inputs: all.filter((d) => d.kind === 'audioinput'),
        outputs: all.filter((d) => d.kind === 'audiooutput'),
      };
    } catch {
      return { inputs: [], outputs: [] };
    }
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }

  /** Start a connection to an existing player (we are the offerer). */
  async connect(id: string) {
    if (this.peers.has(id)) return;
    const peer = this.createPeer(id);
    try {
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.signal(id, { sdp: peer.pc.localDescription });
    } catch (e) {
      console.warn('offer failed', e);
    }
  }

  async handleSignal(from: string, data: any) {
    try {
      if (data?.sdp) {
        const desc = data.sdp as RTCSessionDescriptionInit;
        if (desc.type === 'offer') {
          this.removePeer(from);
          const peer = this.createPeer(from); // created synchronously so early ICE gets queued
          await peer.pc.setRemoteDescription(desc);
          await this.flush(peer);
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          this.signal(from, { sdp: peer.pc.localDescription });
        } else {
          const peer = this.peers.get(from);
          if (!peer) return;
          await peer.pc.setRemoteDescription(desc);
          await this.flush(peer);
        }
      } else if (data?.candidate) {
        const peer = this.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pending.push(data.candidate);
      }
    } catch (e) {
      console.warn('signal error', e);
    }
  }

  removePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.nodes.forEach((n) => n.disconnect());
    if (p.el) p.el.srcObject = null;
    this.peers.delete(id);
    this.speaking.delete(id);
  }

  updateListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    const l = this.ctx.listener;
    l.positionX.value = x;
    l.positionY.value = y;
    l.positionZ.value = z;
    l.forwardX.value = fx;
    l.forwardY.value = fy;
    l.forwardZ.value = fz;
  }

  /** Listener-side volume for one player: 0 = silent, 1 = normal, 2 = double. Applies to future connections too. */
  setPeerVolume(id: string, v: number) {
    this.volumes.set(id, v);
    const g = this.peers.get(id)?.gain;
    if (g) g.gain.value = v;
  }

  /** Default hearing range for everyone: full volume within `ref` metres, silent beyond `max`. */
  setRange(ref: number, max: number) {
    this.refDist = ref;
    this.maxDist = max;
    for (const p of this.peers.values()) {
      if (!p.panner) continue;
      p.panner.refDistance = ref;
      p.panner.maxDistance = max;
    }
  }

  /** Range for one speaker (whispering, a leader's short voice). */
  setPeerRange(id: string, ref: number, max: number) {
    const p = this.peers.get(id)?.panner;
    if (!p) return;
    if (p.refDistance !== ref) p.refDistance = ref;
    if (p.maxDistance !== max) p.maxDistance = max;
  }

  /** 0 = clear, 1 = heavily muffled (behind a rock, or underwater). */
  setPeerMuffle(id: string, amount: number) {
    const f = this.peers.get(id)?.filter;
    if (!f) return;
    const target = 22000 * Math.pow(0.02, amount);
    if (Math.abs(f.frequency.value - target) > 50) f.frequency.setTargetAtTime(target, this.ctx.currentTime, 0.05);
  }

  /** Close the channel to one speaker (the Gulag is its own channel). */
  setPeerGate(id: string, open: boolean) {
    const g = this.peers.get(id)?.gate;
    if (!g) return;
    const v = open ? 1 : 0;
    if (g.gain.value !== v) g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
  }

  setPeerPosition(id: string, x: number, y: number, z: number) {
    const p = this.peers.get(id)?.panner;
    if (!p) return;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
  }

  /** Refresh the `speaking` set from analyser levels. Call once per frame. */
  tick(now: number) {
    const level = (a: AnalyserNode) => {
      a.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (const v of this.buf) sum += ((v - 128) / 128) ** 2;
      return Math.sqrt(sum / this.buf.length);
    };
    if (this.hasMic && !this.muted && level(this.meter) > SPEAK_THRESHOLD) this.lastLocalLoud = now;
    this.setSpeaking('me', now - this.lastLocalLoud < SPEAK_HOLD_MS);
    for (const [id, p] of this.peers) {
      if (p.analyser && level(p.analyser) > SPEAK_THRESHOLD) p.lastLoud = now;
      this.setSpeaking(id, now - p.lastLoud < SPEAK_HOLD_MS);
    }
  }

  private setSpeaking(id: string, on: boolean) {
    if (on) this.speaking.add(id);
    else this.speaking.delete(id);
  }

  private async flush(peer: Peer) {
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c);
  }

  private createPeer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { pc, pending: [], nodes: [], lastLoud: 0 };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(id, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => this.attach(peer, id, e.streams[0] ?? new MediaStream([e.track]));

    // Always send the gain-stage output: silent until a microphone is connected.
    this.sendDest.stream.getTracks().forEach((t) => pc.addTrack(t, this.sendDest.stream));
    return peer;
  }

  private attach(peer: Peer, id: string, stream: MediaStream) {
    // Chrome only delivers remote WebRTC audio to Web Audio if the stream is also attached to a media element.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    peer.el = el;

    const src = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'linear';
    panner.refDistance = this.refDist;
    panner.maxDistance = this.maxDist;
    panner.rolloffFactor = 1;
    panner.positionX.value = 1e5; // silent until the first position update
    const gain = this.ctx.createGain();
    gain.gain.value = this.volumes.get(id) ?? 1;
    src.connect(analyser); // analyser taps the raw voice, so the speaking glow ignores your volume setting
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 22000;
    const gate = this.ctx.createGain();
    src.connect(panner);
    panner.connect(filter);
    filter.connect(gain);
    gain.connect(gate);
    gate.connect(this.master);
    peer.nodes = [src, analyser, panner, filter, gain, gate];
    peer.filter = filter;
    peer.gate = gate;
    peer.panner = panner;
    peer.gain = gain;
    peer.analyser = analyser;
  }
}
