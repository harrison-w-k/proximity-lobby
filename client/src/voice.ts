import { VOICE_MAX, VOICE_REF } from '../../shared/protocol';

interface Peer {
  pc: RTCPeerConnection;
  pending: RTCIceCandidateInit[];
  nodes: AudioNode[];
  panner?: PannerNode;
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

  private local: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private lastLocalLoud = 0;
  private peers = new Map<string, Peer>();
  private ice: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  private buf = new Uint8Array(512);

  constructor(private signal: (to: string, data: unknown) => void) {
    const l = this.ctx.listener;
    l.upX.value = 0;
    l.upY.value = 1;
    l.upZ.value = 0;
  }

  get hasMic() {
    return this.local !== null;
  }

  setIce(servers: RTCIceServer[]) {
    if (servers.length) this.ice = servers;
  }

  /** Must be called from a user gesture (join click). Returns false if there's no mic. */
  async init(): Promise<boolean> {
    await this.ctx.resume().catch(() => {});
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      return false;
    }
    this.localAnalyser = this.ctx.createAnalyser();
    this.localAnalyser.fftSize = 512;
    this.ctx.createMediaStreamSource(this.local).connect(this.localAnalyser);
    return true;
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !m));
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
    if (this.localAnalyser && !this.muted && level(this.localAnalyser) > SPEAK_THRESHOLD) this.lastLocalLoud = now;
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
    pc.ontrack = (e) => this.attach(peer, e.streams[0] ?? new MediaStream([e.track]));

    if (this.local) this.local.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    return peer;
  }

  private attach(peer: Peer, stream: MediaStream) {
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
    panner.refDistance = VOICE_REF;
    panner.maxDistance = VOICE_MAX;
    panner.rolloffFactor = 1;
    panner.positionX.value = 1e5; // silent until the first position update
    src.connect(analyser);
    src.connect(panner);
    panner.connect(this.ctx.destination);
    peer.nodes = [src, analyser, panner];
    peer.panner = panner;
    peer.analyser = analyser;
  }
}
