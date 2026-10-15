import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export class Net {
  private ws?: WebSocket;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (this.ws) {
      this.ws.onclose = null; // a retry replaces the old socket; don't report it as a disconnect
      this.ws.close();
    }
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch (err) {
        console.warn('bad server message', err);
      }
    };
    ws.onclose = () => this.onClose();
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('connection failed'));
    });
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
