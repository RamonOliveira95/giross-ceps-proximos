import type Redis from 'ioredis';
import { MemoryCache } from '../src/services/cache/MemoryCache';
import { RedisCache } from '../src/services/cache/RedisCache';

/** Fake minimo de ioredis, suficiente para exercitar o RedisCache sem um servidor real. */
class FakeRedis {
  readonly store = new Map<string, { value: string; ttl?: number }>();
  failing = false;

  private guard(): void {
    if (this.failing) throw new Error('Redis down');
  }

  async get(key: string) {
    this.guard();
    return this.store.get(key)?.value ?? null;
  }

  async set(key: string, value: string, _mode: string, ttl: number) {
    this.guard();
    this.store.set(key, { value, ttl });
    return 'OK';
  }

  async del(...keys: string[]) {
    this.guard();
    keys.forEach((key) => this.store.delete(key));
    return keys.length;
  }

  // Devolve 1 chave por pagina para exercitar o loop de cursor.
  async scan(cursor: string, _match: string, pattern: string) {
    this.guard();
    const prefix = pattern.replace(/\*$/, '');
    const keys = [...this.store.keys()].filter((key) => key.startsWith(prefix));
    const index = Number(cursor);
    const next = index + 1 < keys.length ? String(index + 1) : '0';
    return [next, keys[index] ? [keys[index]] : []] as [string, string[]];
  }
}

describe('MemoryCache', () => {
  it('guarda, le, remove e limpa por prefixo', async () => {
    const cache = new MemoryCache();
    await cache.set('geocode:1', { a: 1 }, 60);
    await cache.set('nearby:1', [1], 60);

    expect(await cache.get('geocode:1')).toEqual({ a: 1 });
    await cache.clear('geocode:');
    expect(await cache.get('geocode:1')).toBeUndefined();
    expect(await cache.get('nearby:1')).toEqual([1]);

    await cache.del('nearby:1');
    expect(await cache.keys()).toEqual([]);
  });

  it('expira entradas apos o TTL', async () => {
    jest.useFakeTimers();
    try {
      const cache = new MemoryCache();
      await cache.set('k', 'v', 1);
      expect(await cache.get('k')).toBe('v');
      jest.setSystemTime(Date.now() + 2500);
      expect(await cache.get('k')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RedisCache', () => {
  let fake: FakeRedis;
  let cache: RedisCache;

  beforeEach(() => {
    fake = new FakeRedis();
    cache = new RedisCache(fake as unknown as Redis);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('serializa valores em JSON, aplica namespace e TTL', async () => {
    await cache.set('geocode:1', { lat: 1 }, 123);

    expect(fake.store.get('giross:geocode:1')).toEqual({ value: '{"lat":1}', ttl: 123 });
    expect(await cache.get('geocode:1')).toEqual({ lat: 1 });
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('clear() remove apenas as chaves do namespace/prefixo, preservando chaves alheias', async () => {
    fake.store.set('outra-app:x', { value: '1' });
    await cache.set('geocode:1', 1, 60);
    await cache.set('geocode:2', 2, 60);
    await cache.set('nearby:1', 3, 60);

    await cache.clear('geocode:');
    expect(await cache.keys()).toEqual(['nearby:1']);

    await cache.clear();
    expect(await cache.keys()).toEqual([]);
    expect(fake.store.has('outra-app:x')).toBe(true);
  });

  it('trata falha do Redis em get/set como cache miss, sem lancar', async () => {
    fake.failing = true;
    await expect(cache.get('k')).resolves.toBeUndefined();
    await expect(cache.set('k', 1, 10)).resolves.toBeUndefined();
  });

  it('lanca ExternalServiceError em del/clear quando o Redis falha', async () => {
    fake.failing = true;
    await expect(cache.del('k')).rejects.toThrow('Redis');
    await expect(cache.clear()).rejects.toThrow('Redis');
  });
});
