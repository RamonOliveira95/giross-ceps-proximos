import dotenv from 'dotenv';

dotenv.config();

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toList(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export const env = {
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  geocodeCacheTtlSeconds: toInt(process.env.GEOCODE_CACHE_TTL_SECONDS, 7 * 86400),
  nearbyCacheTtlSeconds: toInt(process.env.NEARBY_CACHE_TTL_SECONDS, 86400),
  notFoundCacheTtlSeconds: toInt(process.env.NOT_FOUND_CACHE_TTL_SECONDS, 600),

  nearbySearchRadiusMeters: toInt(process.env.NEARBY_SEARCH_RADIUS_METERS, 1000),

  nominatimMinIntervalMs: toInt(process.env.NOMINATIM_MIN_INTERVAL_MS, 1100),
  overpassMinIntervalMs: toInt(process.env.OVERPASS_MIN_INTERVAL_MS, 1000),

  apiRateLimitPerMinute: toInt(process.env.API_RATE_LIMIT_PER_MINUTE, 60),

  // Necessario para o limite por IP enxergar o IP real do cliente atras de um proxy.
  trustProxyHops: Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10) || 0,

  adminToken: process.env.ADMIN_TOKEN || undefined,

  nominatimUserAgent:
    process.env.NOMINATIM_USER_AGENT ?? 'giross-ceps-proximos/1.0 (defina-um-contato-real@seudominio.com)',

  viaCepBaseUrl: process.env.VIACEP_BASE_URL ?? 'https://viacep.com.br/ws',
  brasilApiBaseUrl: process.env.BRASILAPI_BASE_URL ?? 'https://brasilapi.com.br/api',
  nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
  overpassUrls: toList(process.env.OVERPASS_URLS, [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://z.overpass-api.de/api/interpreter',
  ]),
  overpassTimeoutMs: toInt(process.env.OVERPASS_TIMEOUT_MS, 60000),
  overpassMaxRounds: toInt(process.env.OVERPASS_MAX_ROUNDS, 3),
  overpassBackoffMs: toInt(process.env.OVERPASS_BACKOFF_MS, 2000),
  overpassTotalBudgetMs: toInt(process.env.OVERPASS_TOTAL_BUDGET_MS, 150000),
  // O servidor publico oferece ~2 slots por IP.
  overpassMaxConcurrent: toInt(process.env.OVERPASS_MAX_CONCURRENT, 2),

  redisUrl: process.env.REDIS_URL || undefined,
};
