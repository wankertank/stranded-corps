/**
 * A uniform grid of buckets for things with a position and a radius (rocks, building footprints),
 * so collision and ray tests only look at what is nearby instead of the whole map.
 */
export class Buckets<T extends object> {
  private map = new Map<number, T[]>();
  private stamp = 0;
  private seen = new WeakMap<T, number>();
  constructor(readonly cell = 16) {}
  private key(i: number, j: number) { return i * 8192 + j; }
  insert(item: T, x: number, z: number, r: number): void {
    const c = this.cell;
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
      const k = this.key(i, j); let b = this.map.get(k); if (!b) this.map.set(k, b = []); b.push(item);
    }
  }
  /** Calls `fn` once for each item whose cells overlap the box; stop early by returning true. */
  query(x0: number, z0: number, x1: number, z1: number, fn: (item: T) => boolean | void): boolean {
    const c = this.cell, s = ++this.stamp;
    for (let i = Math.floor(Math.min(x0, x1) / c); i <= Math.floor(Math.max(x0, x1) / c); i++) for (let j = Math.floor(Math.min(z0, z1) / c); j <= Math.floor(Math.max(z0, z1) / c); j++) {
      const b = this.map.get(this.key(i, j)); if (!b) continue;
      for (const it of b) { if (this.seen.get(it) === s) continue; this.seen.set(it, s); if (fn(it)) return true; }
    }
    return false;
  }
  clear(): void { this.map.clear(); }
}
