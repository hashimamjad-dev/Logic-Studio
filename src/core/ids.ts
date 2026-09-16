/**
 * Deterministic id generation.
 *
 * Project files must be diff-friendly and reproducible, so ids are short readable
 * sequences (`U1`, `W7`, `BB1`) allocated from a counter that lives with the circuit
 * rather than random uuids. Loading a project restores the counters so that ids
 * created afterwards never collide with ids already in the file.
 */

export type IdPrefix = 'BB' | 'U' | 'W' | 'J' | 'N' | 'T';

export class IdGenerator {
  private counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}${n}`;
  }

  /** Make sure future ids never collide with an id that already exists. */
  observe(id: string): void {
    const match = /^([A-Za-z]+)(\d+)$/.exec(id);
    if (!match) return;
    const [, prefix, digits] = match;
    const value = Number(digits);
    if (!Number.isFinite(value)) return;
    if (value > (this.counters.get(prefix) ?? 0)) this.counters.set(prefix, value);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  restore(snapshot: Record<string, number> | undefined): void {
    this.counters.clear();
    if (!snapshot) return;
    for (const [key, value] of Object.entries(snapshot)) {
      if (typeof value === 'number' && Number.isFinite(value)) this.counters.set(key, value);
    }
  }

  reset(): void {
    this.counters.clear();
  }
}
