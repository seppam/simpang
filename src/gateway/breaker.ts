// Circuit breaker per provider: after N failures in a row, stop sending traffic to that
// provider for a cool-down period, so we fail over instantly instead of waiting for timeouts.
//   closed  -> requests flow; failures are counted
//   open    -> provider skipped until the cool-down ends
//   half-open (implicit) -> after cool-down one request is let through; success closes it again
export class CircuitBreaker {
  private failures = new Map<string, number>();
  private openUntil = new Map<string, number>();
  private threshold: number;
  private coolDownMs: number;
  private now: () => number;

  constructor(options: { threshold?: number; coolDownMs?: number; now?: () => number } = {}) {
    this.threshold = options.threshold ?? 3;
    this.coolDownMs = options.coolDownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  isOpen(provider: string): boolean {
    return (this.openUntil.get(provider) ?? 0) > this.now();
  }

  success(provider: string): void {
    this.failures.delete(provider);
    this.openUntil.delete(provider);
  }

  failure(provider: string): void {
    const count = (this.failures.get(provider) ?? 0) + 1;
    this.failures.set(provider, count);
    if (count >= this.threshold) this.openUntil.set(provider, this.now() + this.coolDownMs);
  }

  snapshot(): Record<string, { failures: number; open: boolean }> {
    const names = new Set([...this.failures.keys(), ...this.openUntil.keys()]);
    return Object.fromEntries([...names].map((n) => [n, { failures: this.failures.get(n) ?? 0, open: this.isOpen(n) }]));
  }
}
