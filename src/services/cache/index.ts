import { env } from '../../config/env';
import { ICache } from './ICache';
import { MemoryCache } from './MemoryCache';
import { RedisCache } from './RedisCache';

let cacheInstance: ICache | undefined;

export function getCache(): ICache {
  if (!cacheInstance) {
    cacheInstance = env.redisUrl ? RedisCache.fromUrl(env.redisUrl) : new MemoryCache();
  }
  return cacheInstance;
}

export const CACHE_PREFIXES = {
  geocode: 'geocode:',
  nearby: 'nearby:',
  notFound: 'notfound:',
} as const;

export async function invalidateCep(cep: string): Promise<void> {
  const cache = getCache();
  await Promise.all(Object.values(CACHE_PREFIXES).map((prefix) => cache.del(`${prefix}${cep}`)));
}
