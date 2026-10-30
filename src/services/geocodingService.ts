import axios from 'axios';
import { env } from '../config/env';
import { CepNotFoundError, ExternalServiceError, GeolocationNotFoundError } from '../utils/errors';
import { RateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';
import { singleFlight } from '../utils/singleFlight';
import { CACHE_PREFIXES, getCache } from './cache';
import { fetchBrasilApiCep } from './brasilApiService';
import { fetchViaCep } from './viaCepService';
import { CepAddress, GeocodeResult, GeoPoint } from '../types';

const http = axios.create({
  timeout: 10000,
  headers: { 'User-Agent': env.nominatimUserAgent },
});

// O Nominatim publico permite no maximo 1 requisicao/segundo.
export const nominatimRateLimiter = new RateLimiter(env.nominatimMinIntervalMs);

interface NominatimSearchResult {
  lat: string;
  lon: string;
}

export function formatAddress(address: CepAddress): string {
  const place = [address.localidade, address.uf].filter(Boolean).join(' - ');
  return [address.logradouro, address.bairro, place].filter(Boolean).join(', ');
}

async function searchNominatim(params: Record<string, string | number>): Promise<GeoPoint | null> {
  const results = await nominatimRateLimiter.schedule(async () => {
    try {
      const response = await http.get<NominatimSearchResult[]>(`${env.nominatimBaseUrl}/search`, {
        params: { ...params, format: 'json', limit: 1, countrycodes: 'br' },
      });
      return response.data;
    } catch (error) {
      throw new ExternalServiceError('Nominatim', error);
    }
  });

  if (!Array.isArray(results)) {
    throw new ExternalServiceError('Nominatim (resposta invalida)');
  }

  const lat = Number(results[0]?.lat);
  const lng = Number(results[0]?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Coordenadas do CEP no OpenStreetMap:
 * 1. Pelo proprio CEP (postalcode): precisao exata da base addr:postcode.
 * 2. Pelo endereco completo com bairro (logradouro, bairro, cidade, UF): o bairro e
 *    essencial para ruas extensas que atravessam multiplos bairros com CEPs distintos.
 * 3. Fallback estruturado (street, city, state): caso o bairro nao esteja nomeado no OSM.
 */
async function geocodePoint(address: CepAddress, cep: string): Promise<GeoPoint> {
  const byPostcode = await searchNominatim({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}` });
  if (byPostcode) return byPostcode;

  const addressQuery = [address.logradouro, address.bairro, address.localidade, address.uf, 'Brasil']
    .filter(Boolean)
    .join(', ');
  const byAddress = await searchNominatim({ q: addressQuery });
  if (byAddress) return byAddress;

  if (address.logradouro && address.localidade) {
    const byStructured = await searchNominatim({
      street: address.logradouro,
      city: address.localidade,
      state: address.uf,
    });
    if (byStructured) return byStructured;
  }

  throw new GeolocationNotFoundError(cep);
}

async function resolveAddress(cep: string): Promise<CepAddress> {
  try {
    const address = await fetchBrasilApiCep(cep);
    if (address) return address;
  } catch (error) {
    if (!(error instanceof ExternalServiceError)) throw error;
    const cause = error.cause instanceof Error ? error.cause.message : 'sem detalhes';
    logger.warn(`[geocoding] BrasilAPI indisponivel para ${cep}, usando ViaCEP. Causa: ${cause}`);
  }
  return fetchViaCep(cep);
}

async function resolveGeocode(cep: string): Promise<GeocodeResult> {
  const address = await resolveAddress(cep);
  const point = await geocodePoint(address, cep);
  return { cep, ...point, enderecoFormatado: formatAddress(address) };
}

async function geocodeUncached(cep: string): Promise<GeocodeResult> {
  const cache = getCache();

  const cached = await cache.get<GeocodeResult>(`${CACHE_PREFIXES.geocode}${cep}`);
  if (cached) return cached;

  if (await cache.get<boolean>(`${CACHE_PREFIXES.notFound}${cep}`)) {
    throw new CepNotFoundError(cep);
  }

  let result: GeocodeResult;
  try {
    result = await resolveGeocode(cep);
  } catch (error) {
    // Cache negativo so para "CEP inexistente"; falhas (503) nunca sao cacheadas.
    if (error instanceof CepNotFoundError) {
      await cache.set(`${CACHE_PREFIXES.notFound}${cep}`, true, env.notFoundCacheTtlSeconds);
    }
    throw error;
  }

  await cache.set(`${CACHE_PREFIXES.geocode}${cep}`, result, env.geocodeCacheTtlSeconds);
  return result;
}

export function geocodeCep(cep: string): Promise<GeocodeResult> {
  return singleFlight(`geocode:${cep}`, () => geocodeUncached(cep));
}
