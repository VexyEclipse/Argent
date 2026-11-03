/** A pausable one-shot timer that resumes mid-period, like the plugin's SlideTimer. */
export class Countdown {
  private timer: number | null = null;
  private startedAt = 0;
  private remaining = 0;

  constructor(private readonly onFire: () => void) {}

  /** Arm for a full period without starting it. */
  reset(ms: number) {
    this.clear();
    this.remaining = ms;
  }

  resume() {
    if (this.timer !== null || this.remaining <= 0) return;
    this.startedAt = Date.now();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.remaining = 0;
      this.onFire();
    }, this.remaining);
  }

  pause() {
    if (this.timer === null) return;
    this.clear();
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
  }

  stop() {
    this.clear();
    this.remaining = 0;
  }

  get running() {
    return this.timer !== null;
  }

  private clear() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
