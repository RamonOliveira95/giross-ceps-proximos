import NodeCache from 'node-cache';
import { ICache } from './ICache';

export class MemoryCache implements ICache {
  private readonly store: NodeCache;

  constructor() {
    this.store = new NodeCache({ useClones: false });
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    this.store.del(key);
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.store.flushAll();
      return;
    }
    const matching = this.store.keys().filter((key) => key.startsWith(prefix));
    this.store.del(matching);
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = this.store.keys();
    return prefix ? all.filter((key) => key.startsWith(prefix)) : all;
  }
}
