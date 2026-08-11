export class ReconnectManager {
  constructor({
    baseMs = 1000,
    maxMs = 30000,
    onReconnect,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.onReconnect = onReconnect;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.attempt = 0;
    this.running = false;
    this.timer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }

  reset() {
    this.attempt = 0;
  }

  nextDelay() {
    const exponential = Math.min(
      this.maxMs,
      this.baseMs * 2 ** Math.max(0, this.attempt - 1),
    );
    const jitter = Math.random() * Math.min(200, exponential * 0.2);
    return Math.max(1, Math.round(exponential + jitter));
  }

  schedule(delay) {
    if (!this.running) return;
    this.timer = this.setTimeoutFn(async () => {
      this.timer = null;
      if (!this.running) return;
      this.attempt += 1;
      try {
        await this.onReconnect?.();
      } catch {
        // Keep retrying; the next schedule is based on current attempt.
      }
      if (this.running) this.schedule(this.nextDelay());
    }, delay);
  }
}
