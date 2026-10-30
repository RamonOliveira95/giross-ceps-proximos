import axios from 'axios';
import { env } from '../config/env';
import { ExternalServiceError } from '../utils/errors';
import { logger } from '../utils/logger';
import { RateLimiter } from '../utils/rateLimiter';
import { GeoPoint } from '../types';

const http = axios.create({
  timeout: env.overpassTimeoutMs,
  headers: { 'User-Agent': env.nominatimUserAgent },
});

// Chamadas ao Overpass sao espacadas e limitadas em concorrencia para nao abusar da API publica.
export const overpassRateLimiter = new RateLimiter(env.overpassMinIntervalMs, env.overpassMaxConcurrent);

// Status que indicam sobrecarga/instabilidade temporaria do servidor (vale tentar de novo).
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// Nao vale iniciar uma tentativa com menos tempo que isso sobrando no orcamento.
const MIN_ATTEMPT_MS = 5000;

// Mirror que respondeu por ultimo: a proxima consulta comeca por ele (e nao por um que falhou).
let preferredMirror = 0;

export function resetOverpassMirrorPreference(): void {
  preferredMirror = 0;
}

export interface PostcodePoint extends GeoPoint {
  /** Valor bruto da tag addr:postcode do objeto OSM. */
  postcode: string;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

/**
 * Monta a query QL do Overpass alocando limite de memoria explicito (1 GB) e
 * restringindo a busca a nodes e ways. Evita "relations" pesadas que causam
 * erro de memoria no servidor Overpass ("Query run out of memory").
 */
export function buildPostcodeQuery(
  lat: number,
  lng: number,
  radiusMeters: number,
  timeoutMs: number = env.overpassTimeoutMs,
  maxsizeBytes = 1073741824,
): string {
  const serverTimeoutSeconds = Math.max(1, Math.floor(timeoutMs / 1000));
  return (
    `[out:json][timeout:${serverTimeoutSeconds}][maxsize:${maxsizeBytes}];` +
    `nwr(around:${radiusMeters},${lat},${lng})["addr:postcode"];` +
    'out center tags qt;'
  );
}

function parseElements(data: OverpassResponse | undefined): PostcodePoint[] {
  // O Overpass pode responder 200 com "remark" de erro (timeout/memoria) e resultado
  // parcial; isso NAO pode ser tratado como resposta valida.
  if (!data || typeof data !== 'object' || !Array.isArray(data.elements) || data.remark?.includes('runtime error')) {
    const remark = data?.remark ?? 'resposta invalida do Overpass';
    if (remark.toLowerCase().includes('memory')) {
      logger.warn(`[overpass] Limite de memoria excedido no servidor Overpass: ${remark}`);
    }
    throw new Error(remark);
  }

  const points: PostcodePoint[] = [];
  for (const element of data.elements) {
    const postcode = element.tags?.['addr:postcode'];
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (postcode && Number.isFinite(lat) && Number.isFinite(lng)) {
      points.push({ postcode, lat: lat as number, lng: lng as number });
    }
  }
  return points;
}

class BudgetExhaustedError extends Error {}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) return `HTTP ${error.response.status}`;
    return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ? 'timeout' : (error.code ?? error.message);
  }
  return error instanceof Error ? error.message : String(error);
}

function isRetryable(error: unknown): boolean {
  if (axios.isAxiosError(error) && error.response) return RETRYABLE_STATUS.has(error.response.status);
  // Timeout, falha de rede ou resposta parcial ("runtime error"): transitorios.
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Busca, em UMA unica consulta ao Overpass API (OpenStreetMap), todos os objetos
 * com tag addr:postcode dentro do raio informado, com suas coordenadas.
 *
 * O Overpass publico e lento (30-45 s numa regiao densa) e rejeita consultas quando
 * esta lotado (HTTP 502/504/429), entao: percorre os mirrors em ordem; se todos falharem,
 * espera (backoff exponencial com jitter) e faz outra rodada. Tudo limitado por um
 * orcamento total de tempo. So responde 503 quando o orcamento/rodadas se esgotam.
 */
export async function fetchPostcodePointsAround(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<PostcodePoint[]> {
  const urls = env.overpassUrls;
  const failures: string[] = [];
  // O orcamento so comeca a contar quando a 1a tentativa sai da fila do limiter.
  let deadline: number | undefined;

  try {
    for (let round = 0; round < env.overpassMaxRounds; round += 1) {
      let retryableFailure = false;

      for (let offset = 0; offset < urls.length; offset += 1) {
        const index = (preferredMirror + offset) % urls.length;
        const url = urls[index];
        const startedAt = Date.now();

        try {
          const response = await overpassRateLimiter.schedule(() => {
            deadline ??= Date.now() + env.overpassTotalBudgetMs;
            const timeoutMs = Math.min(env.overpassTimeoutMs, deadline - Date.now());
            if (timeoutMs < MIN_ATTEMPT_MS) throw new BudgetExhaustedError('orcamento de tempo esgotado');

            const body = new URLSearchParams({
              data: buildPostcodeQuery(lat, lng, radiusMeters, timeoutMs),
            }).toString();
            return http.post<OverpassResponse>(url, body, {
              timeout: timeoutMs,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });
          });

          const points = parseElements(response.data);
          preferredMirror = index;
          logger.info(
            `[overpass] ${url} OK em ${((Date.now() - startedAt) / 1000).toFixed(1)}s (${points.length} objetos)`,
          );
          return points;
        } catch (error) {
          if (error instanceof BudgetExhaustedError) throw error;
          const reason = `${new URL(url).host}: ${describeError(error)}`;
          failures.push(reason);
          retryableFailure ||= isRetryable(error);
          logger.warn(
            `[overpass] falha na rodada ${round + 1}/${env.overpassMaxRounds} - ${reason} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
          );
        }
      }

      if (!retryableFailure || round === env.overpassMaxRounds - 1) break;

      const delayMs = env.overpassBackoffMs * 2 ** round * (0.75 + Math.random() * 0.5);
      if (deadline !== undefined && deadline - Date.now() < delayMs + MIN_ATTEMPT_MS) break;
      await sleep(delayMs);
    }
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    failures.push(error.message);
  }

  throw new ExternalServiceError('Overpass API', new Error(failures.join(' | ')), 30);
}
