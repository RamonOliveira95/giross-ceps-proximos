import { env } from '../config/env';
import { haversineDistanceMeters } from '../utils/geo';
import { singleFlight } from '../utils/singleFlight';
import { CACHE_PREFIXES, getCache } from './cache';
import { geocodeCep } from './geocodingService';
import { fetchPostcodePointsAround, PostcodePoint } from './overpassService';
import { CepProximo, GeoPoint, NearbyResult } from '../types';

const POSTCODE_PATTERN = /^(\d{5})-?(\d{3})$/;

// A tag addr:postcode e texto livre: '01310-100', '01310100' ou varios valores separados por ';'.
export function parsePostcodes(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((value) => POSTCODE_PATTERN.exec(value.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `${match[1]}${match[2]}`);
}

// Distancia ate o objeto OSM mais proximo de cada CEP. O "around" do Overpass usa a
// geometria e aqui medimos ate o ponto central, entao o raio e reaplicado.
export function rankNearbyCeps(
  origin: GeoPoint,
  originCep: string,
  points: PostcodePoint[],
  radiusMeters: number,
): CepProximo[] {
  const nearestMeters = new Map<string, number>();

  for (const point of points) {
    const distance = haversineDistanceMeters(origin.lat, origin.lng, point.lat, point.lng);
    if (distance > radiusMeters) continue;

    for (const cep of parsePostcodes(point.postcode)) {
      if (cep === originCep) continue;
      const current = nearestMeters.get(cep);
      if (current === undefined || distance < current) nearestMeters.set(cep, distance);
    }
  }

  return Array.from(nearestMeters, ([cep, meters]) => ({
    cep,
    distancia_km: Math.round((meters / 1000) * 100) / 100,
    meters,
  }))
    .sort((a, b) => a.meters - b.meters || a.cep.localeCompare(b.cep))
    .map(({ cep, distancia_km }) => ({ cep, distancia_km }));
}

async function findNearbyUncached(cep: string): Promise<NearbyResult> {
  const cache = getCache();
  const cacheKey = `${CACHE_PREFIXES.nearby}${cep}`;

  const cached = await cache.get<NearbyResult>(cacheKey);
  if (cached) return cached;

  const origem = await geocodeCep(cep);
  const points = await fetchPostcodePointsAround(origem.lat, origem.lng, env.nearbySearchRadiusMeters);
  const result: NearbyResult = {
    origem,
    proximos: rankNearbyCeps(origem, cep, points, env.nearbySearchRadiusMeters),
  };

  await cache.set(cacheKey, result, env.nearbyCacheTtlSeconds);
  return result;
}

export function findNearbyCeps(cep: string): Promise<NearbyResult> {
  return singleFlight(`nearby:${cep}`, () => findNearbyUncached(cep));
}
