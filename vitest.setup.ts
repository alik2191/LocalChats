/**
 * Надійний in-memory localStorage для тестів: реалізації localStorage у
 * jsdom/happy-dom у цьому середовищі не працюють (методи відсутні).
 */
class MemStorage implements Storage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(String(k), String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemStorage(),
  configurable: true,
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: globalThis.localStorage,
    configurable: true,
  });
}
