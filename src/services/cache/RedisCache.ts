import Redis from 'ioredis';
import { ICache } from './ICache';
import { ExternalServiceError } from '../../utils/errors';

const KEY_NAMESPACE = 'giross:';

/**
 * Implementacao do cache usando Redis (diferencial).
 *
 * - Leituras (get) e gravacoes (set) toleram falhas: um Redis fora do ar vira
 *   "cache miss" silencioso para nao derrubar as consultas normais da API.
 * - Exclusoes explicitas (del, clear): se o Redis estiver indisponivel, lanca
 *   ExternalServiceError (503) para nao fingir falsamente que o cache foi limpo.
 */
export class RedisCache implements ICache {
  readonly storageType = 'redis' as const;

  constructor(private readonly client: Redis) {}

  static fromUrl(redisUrl: string): RedisCache {
    const client = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: 1000 });
    client.on('error', (error) => {
      // eslint-disable-next-line no-console -- visibilidade de falhas do Redis
      console.warn(`[cache] Redis indisponivel: ${error.message}`);
    });
    return new RedisCache(client);
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.client.get(KEY_NAMESPACE + key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch (error) {
      this.warn('get', error);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(KEY_NAMESPACE + key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.warn('set', error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(KEY_NAMESPACE + key);
    } catch (error) {
      this.warn('del', error);
      throw new ExternalServiceError('Redis', error);
    }
  }

  async clear(prefix?: string): Promise<void> {
    try {
      const matching = await this.scanKeys(prefix);
      if (matching.length > 0) {
        await this.client.del(...matching);
      }
    } catch (error) {
      this.warn('clear', error);
      throw new ExternalServiceError('Redis', error);
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    try {
      const full = await this.scanKeys(prefix);
      return full.map((key) => key.slice(KEY_NAMESPACE.length));
    } catch (error) {
      this.warn('keys', error);
      return [];
    }
  }

  // SCAN (incremental) em vez de KEYS, que bloquearia o Redis em bases grandes.
  private async scanKeys(prefix?: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.client.scan(cursor, 'MATCH', `${KEY_NAMESPACE}${prefix ?? ''}*`, 'COUNT', 200);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  private warn(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line no-console -- visibilidade de falhas do Redis
    console.warn(`[cache] falha em Redis ${operation}: ${message}`);
  }
}
