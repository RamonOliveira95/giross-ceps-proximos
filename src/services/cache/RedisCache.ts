import Redis from 'ioredis';
import { ICache } from './ICache';

const KEY_NAMESPACE = 'giross:';

// Namespace "giross:" para que clear() nunca apague chaves de outras aplicacoes.
// Falhas em get/set viram "cache miss": o cache e uma otimizacao e nao deve derrubar a API.
export class RedisCache implements ICache {
  constructor(private readonly client: Redis) {}

  static fromUrl(redisUrl: string): RedisCache {
    // Sem fila offline e com timeout curto: Redis fora do ar vira "cache miss" imediato
    // em vez de segurar as requisicoes enquanto o ioredis tenta reconectar.
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
