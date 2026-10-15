import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export class Net {
  private ws!: WebSocket;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch (err) {
        console.warn('bad server message', err);
      }
    };
    this.ws.onclose = () => this.onClose();
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('connection failed'));
    });
  }

  send(m: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
