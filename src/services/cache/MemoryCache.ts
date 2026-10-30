import NodeCache from 'node-cache';
import { ICache } from './ICache';

/**
 * Implementacao em memoria do cache, usando node-cache. E o padrao da aplicacao
 * quando nenhuma REDIS_URL e configurada.
 *
 * Para proteger contra estouro de memoria (Heap Out of Memory do Node.js) em ambientes
 * de alto volume, adota o limite `maxKeys: 5000` (evicting automatico de chaves antigas).
 */
export class MemoryCache implements ICache {
  readonly storageType = 'memory' as const;
  private readonly store: NodeCache;

  constructor(maxKeys = 5000) {
    this.store = new NodeCache({ useClones: false, maxKeys });
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
