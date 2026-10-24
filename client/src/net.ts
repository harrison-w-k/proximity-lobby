import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export class Net {
  private ws?: WebSocket;
  onMessage: (m: ServerMsg) => void = () => {};
  /** Traffic counters, for the F3 network readout. */
  bytesIn = 0;
  msgsIn = 0;
  rtt = 0; // smoothed round-trip time (ms), measured through the same socket the game uses
  private pinger?: ReturnType<typeof setInterval>;
  onClose: () => void = () => {};

  connect(room: 'br' | 'sandbox' = 'br'): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (this.ws) {
      this.ws.onclose = null; // a retry replaces the old socket; don't report it as a disconnect
      this.ws.close();
    }
    const ws = new WebSocket(`${proto}://${location.host}/ws${room === 'sandbox' ? '?room=sandbox' : ''}`);
    this.ws = ws;
    ws.onmessage = (e) => {
      try {
        this.bytesIn += typeof e.data === 'string' ? e.data.length : 0;
        this.msgsIn++;
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.t === 'pong') {
          const sample = performance.now() - m.n;
          this.rtt = this.rtt ? this.rtt * 0.7 + sample * 0.3 : sample;
          return;
        }
        this.onMessage(m);
      } catch (err) {
        console.warn('bad server message', err);
      }
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      this.onClose();
    };
    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        clearInterval(this.pinger);
        this.pinger = setInterval(() => this.send({ t: 'ping', n: performance.now() }), 2000);
        resolve();
      };
      ws.onerror = () => reject(new Error('connection failed'));
    });
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
