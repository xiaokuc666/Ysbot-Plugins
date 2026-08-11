export class StatusStore {
  constructor() {
    this.state = {
      connected: false,
      wsUrl: null,
      httpUrl: null,
      lastError: null,
      reconnects: 0,
      startedAt: new Date().toISOString(),
      uptime: 0,
      actionsSent: 0,
      actionsFailed: 0,
    };
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.state.uptime = Math.max(
      0,
      Math.round((Date.now() - new Date(this.state.startedAt).getTime()) / 1000),
    );
  }

  snapshot() {
    return { ...this.state };
  }
}
