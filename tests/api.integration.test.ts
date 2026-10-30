import nock from 'nock';

// Configuracao de ambiente ANTES de importar a aplicacao (env.ts le process.env no import).
process.env.NOMINATIM_MIN_INTERVAL_MS = '1';
process.env.OVERPASS_MIN_INTERVAL_MS = '1';
process.env.OVERPASS_URLS = 'http://overpass-a.test/api/interpreter,http://overpass-b.test/api/interpreter';
process.env.OVERPASS_MAX_ROUNDS = '2';
process.env.OVERPASS_BACKOFF_MS = '1';
process.env.API_RATE_LIMIT_PER_MINUTE = '1000';
process.env.ADMIN_TOKEN = 'segredo';
process.env.REDIS_URL = '';

/* eslint-disable @typescript-eslint/no-require-imports */
const request = require('supertest');
const { createApp } = require('../src/app');
const { getCache } = require('../src/services/cache');
const { resetOverpassMirrorPreference } = require('../src/services/overpassService');

const BRASILAPI = 'https://brasilapi.com.br';
const VIACEP = 'https://viacep.com.br';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS_A = 'http://overpass-a.test';
const OVERPASS_B = 'http://overpass-b.test';

const ORIGIN = { lat: -23.5617698, lng: -46.6553299 };
// 0,001 grau de latitude ~ 111,19 m.
const north = (meters: number) => ({ lat: ORIGIN.lat + meters / 111194.93, lon: ORIGIN.lng });

// A BrasilAPI devolve o centro da cidade como "coordenada do CEP"; a API deve ignora-la.
const CITY_CENTER = { latitude: '-23.5475', longitude: '-46.63611' };

function brasilAddressMock(cep: string) {
  return nock(BRASILAPI)
    .get(`/api/cep/v2/${cep}`)
    .reply(200, {
      cep,
      state: 'SP',
      city: 'São Paulo',
      neighborhood: 'Bela Vista',
      street: 'Avenida Paulista',
      location: { type: 'Point', coordinates: CITY_CENTER },
    });
}

const originPoint = [{ lat: String(ORIGIN.lat), lon: String(ORIGIN.lng) }];

/** Endereco na BrasilAPI + coordenadas do CEP (postalcode) no Nominatim. */
function mockBrasilApi(cep: string) {
  const brasil = brasilAddressMock(cep);
  nock(NOMINATIM)
    .get('/search')
    .query((q) => q.postalcode === `${cep.slice(0, 5)}-${cep.slice(5)}`)
    .reply(200, originPoint);
  return brasil;
}

const overpassBody = {
  elements: [
    { type: 'node', ...north(222.39), tags: { 'addr:postcode': '01310-200' } },
    { type: 'way', center: north(444.78), tags: { 'addr:postcode': '01311000' } },
    { type: 'node', ...north(800), tags: { 'addr:postcode': '01311-000' } }, // mesmo CEP, mais longe
    { type: 'node', ...north(100), tags: { 'addr:postcode': '01310-100' } }, // CEP de origem
    { type: 'node', ...north(1500), tags: { 'addr:postcode': '01312-000' } }, // fora do raio
    { type: 'node', ...north(300), tags: { 'addr:postcode': 'lixo' } },
    { type: 'node', ...north(900), tags: { 'addr:postcode': '01313-000;01314-000' } },
  ],
};

const EXPECTED = [
  { cep: '01310-200', distancia_km: 0.22 },
  { cep: '01311-000', distancia_km: 0.44 },
  { cep: '01313-000', distancia_km: 0.9 },
  { cep: '01314-000', distancia_km: 0.9 },
];

describe('API', () => {
  const app = createApp();

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1'); // supertest sobe o app em localhost
  });
  afterAll(() => nock.enableNetConnect());

  beforeEach(async () => {
    resetOverpassMirrorPreference();
    await getCache().clear();
  });

  afterEach(() => {
    expect(nock.pendingMocks()).toEqual([]);
    nock.cleanAll();
  });

  describe('GET /ceps-proximos/:cep', () => {
    it.each(['123', '0131010a', '01.310-100', '01310-100abc'])('retorna 400 para CEP invalido (%s)', async (cep) => {
      const response = await request(app).get(`/ceps-proximos/${cep}`);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('CEP_INVALIDO');
    });

    it('retorna os CEPs num raio de 1km com distancia real, sem a origem e ordenados', async () => {
      mockBrasilApi('01310100');
      let sentBody = '';
      nock(OVERPASS_A)
        .post('/api/interpreter', (body) => {
          sentBody = decodeURIComponent(String(body.data ?? ''));
          return true;
        })
        .reply(200, overpassBody);

      const response = await request(app).get('/ceps-proximos/01310-100');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        cep_origem: '01310-100',
        endereco_origem: 'Avenida Paulista, Bela Vista, São Paulo - SP',
        coordenadas_origem: { lat: ORIGIN.lat, lng: ORIGIN.lng },
        raio_km: 1,
        total_encontrados: 4,
        ceps_proximos: EXPECTED,
      });
      expect(sentBody).toContain(`around:1000,${ORIGIN.lat},${ORIGIN.lng}`);
      expect(sentBody).toContain('"addr:postcode"');
    });

    it('retorna lista vazia (200) quando nao ha CEPs mapeados no raio', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(200, { elements: [] });

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.total_encontrados).toBe(0);
      expect(response.body.ceps_proximos).toEqual([]);
    });

    it('retorna 404 quando o CEP nao existe (BrasilAPI 404 + ViaCEP erro) e cacheia o negativo', async () => {
      nock(BRASILAPI).get('/api/cep/v2/00000000').reply(404, { message: 'CEP nao encontrado' });
      nock(VIACEP).get('/ws/00000000/json/').reply(200, { erro: true });

      const first = await request(app).get('/ceps-proximos/00000000');
      expect(first.status).toBe(404);
      expect(first.body.error).toBe('CEP_NAO_ENCONTRADO');

      // Sem novos mocks: uma 2a chamada externa faria o nock falhar (-> 503).
      const second = await request(app).get('/ceps-proximos/00000000');
      expect(second.status).toBe(404);
    });

    it('retorna 503 quando BrasilAPI e ViaCEP estao indisponiveis, sem cachear a falha', async () => {
      nock(BRASILAPI).get('/api/cep/v2/01310100').replyWithError('network error');
      nock(VIACEP).get('/ws/01310100/json/').replyWithError('network error');

      const failed = await request(app).get('/ceps-proximos/01310100');
      expect(failed.status).toBe(503);
      expect(failed.body.error).toBe('SERVICO_EXTERNO_INDISPONIVEL');

      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);
      const recovered = await request(app).get('/ceps-proximos/01310100');
      expect(recovered.status).toBe(200);
    });

    it('cai para ViaCEP quando a BrasilAPI esta fora do ar', async () => {
      nock(BRASILAPI).get('/api/cep/v2/01310100').reply(500);
      nock(VIACEP)
        .get('/ws/01310100/json/')
        .reply(200, { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' });
      nock(NOMINATIM)
        .get('/search')
        .query((q) => q.postalcode === '01310-100')
        .reply(200, originPoint);
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.endereco_origem).toBe('Avenida Paulista, Bela Vista, São Paulo - SP');
      expect(response.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('geocodifica pelo endereco com bairro (q) quando o OSM nao conhece o CEP (postalcode)', async () => {
      brasilAddressMock('01310100');
      nock(NOMINATIM)
        .get('/search')
        .query((q) => q.postalcode === '01310-100')
        .reply(200, []);
      nock(NOMINATIM)
        .get('/search')
        .query((q) => String(q.q).includes('Avenida Paulista') && String(q.q).includes('Bela Vista'))
        .reply(200, originPoint);
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('faz fallback para busca estruturada (street/city/state) quando a busca por bairro nao retorna resultado', async () => {
      brasilAddressMock('01310100');
      nock(NOMINATIM)
        .get('/search')
        .query((q) => q.postalcode === '01310-100')
        .reply(200, []);
      nock(NOMINATIM)
        .get('/search')
        .query((q) => Boolean(q.q))
        .reply(200, []);
      nock(NOMINATIM)
        .get('/search')
        .query((q) => q.street === 'Avenida Paulista' && q.city === 'São Paulo')
        .reply(200, originPoint);
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('retorna 404 GEOLOCALIZACAO_NAO_ENCONTRADA quando o Nominatim nao acha o CEP nem o endereco', async () => {
      brasilAddressMock('01310100');
      nock(NOMINATIM).get('/search').query(true).times(3).reply(200, []);

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('GEOLOCALIZACAO_NAO_ENCONTRADA');
    });

    it('retorna 503 quando o Nominatim esta indisponivel e nao cacheia a falha', async () => {
      brasilAddressMock('01310100');
      nock(NOMINATIM).get('/search').query(true).reply(500);

      const failed = await request(app).get('/ceps-proximos/01310100');
      expect(failed.status).toBe(503);
      expect(failed.body.error).toBe('SERVICO_EXTERNO_INDISPONIVEL');
    });

    it('tenta o proximo mirror do Overpass quando o primeiro falha', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(504, 'Gateway Timeout');
      nock(OVERPASS_B).post('/api/interpreter').reply(200, overpassBody);

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('rejeita resposta com erro de memoria (Query ran out of memory) e retorna 503 com Retry-After', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').times(2).reply(200, {
        elements: [],
        remark: 'runtime error: Query ran out of memory in "query" at line 1. It would need at least 0 MB of RAM to continue.',
      });
      nock(OVERPASS_B).post('/api/interpreter').times(2).reply(200, {
        elements: [],
        remark: 'runtime error: Query ran out of memory.',
      });

      const res = await request(app).get('/ceps-proximos/01310100');
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICO_EXTERNO_INDISPONIVEL');
      expect(res.headers['retry-after']).toBe('30');
    });

    it('retorna 503 (e nao cacheia) quando todos os mirrors do Overpass falham ou devolvem erro parcial', async () => {
      mockBrasilApi('01310100');
      // 2 rodadas x 2 mirrors.
      nock(OVERPASS_A).post('/api/interpreter').times(2).reply(200, { elements: [], remark: 'runtime error: timeout' });
      nock(OVERPASS_B).post('/api/interpreter').times(2).replyWithError('boom');

      const failed = await request(app).get('/ceps-proximos/01310100');
      expect(failed.status).toBe(503);
      expect(failed.body.error).toBe('SERVICO_EXTERNO_INDISPONIVEL');
      expect(failed.headers['retry-after']).toBeDefined();

      // Geocoding ficou em cache (nao precisa de nova chamada); a busca e refeita.
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);
      const recovered = await request(app).get('/ceps-proximos/01310100');
      expect(recovered.status).toBe(200);
      expect(recovered.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('faz nova rodada (com backoff) quando o Overpass esta lotado em todos os mirrors', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(502, 'at capacity');
      nock(OVERPASS_B).post('/api/interpreter').reply(429, 'too many requests');
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('nao repete rodadas quando o erro nao e transitorio (ex: 400)', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(400, 'bad query');
      nock(OVERPASS_B).post('/api/interpreter').reply(400, 'bad query');

      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(503);
    });

    it('comeca pelo mirror que respondeu por ultimo', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(502, 'at capacity');
      nock(OVERPASS_B).post('/api/interpreter').reply(200, overpassBody);
      await request(app).get('/ceps-proximos/01310100');

      // 2o CEP: o mirror B deve ser tentado primeiro (A nao tem mock e quebraria o teste).
      mockBrasilApi('01310200');
      nock(OVERPASS_B).post('/api/interpreter').reply(200, overpassBody);
      const response = await request(app).get('/ceps-proximos/01310200');
      expect(response.status).toBe(200);
    });
  });

  describe('cache', () => {
    it('2a consulta do mesmo CEP nao faz nenhuma chamada externa', async () => {
      const brasil = mockBrasilApi('01310100');
      const overpass = nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);

      const first = await request(app).get('/ceps-proximos/01310100');
      expect(brasil.isDone()).toBe(true);
      expect(overpass.isDone()).toBe(true);

      // Formato diferente do mesmo CEP tambem deve bater no cache.
      const second = await request(app).get('/ceps-proximos/01310-100');
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
    });

    it('reaproveita o cache de geocoding quando apenas a busca expirou', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);
      await request(app).get('/ceps-proximos/01310100');

      await getCache().del('nearby:01310100');

      // Sem mock da BrasilAPI: so o Overpass pode ser chamado.
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);
      const response = await request(app).get('/ceps-proximos/01310100');
      expect(response.status).toBe(200);
      expect(response.body.ceps_proximos).toEqual(EXPECTED);
    });

    it('requisicoes simultaneas ao mesmo CEP geram uma unica chamada externa', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').delay(50).reply(200, overpassBody);

      const responses = await Promise.all([
        request(app).get('/ceps-proximos/01310100'),
        request(app).get('/ceps-proximos/01310100'),
        request(app).get('/ceps-proximos/01310100'),
      ]);

      responses.forEach((r) => expect(r.status).toBe(200));
    });
  });

  describe('DELETE /cache', () => {
    it('exige o token de administrador quando ADMIN_TOKEN esta definido', async () => {
      const noToken = await request(app).delete('/cache');
      expect(noToken.status).toBe(401);
      expect(noToken.body.error).toBe('NAO_AUTORIZADO');

      const wrongToken = await request(app).delete('/cache/01310100').set('x-admin-token', 'errado');
      expect(wrongToken.status).toBe(401);
    });

    it('DELETE /cache/:cep invalida apenas o CEP informado e forca nova consulta', async () => {
      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);
      await request(app).get('/ceps-proximos/01310100');
      await getCache().set('nearby:99999999', { marker: true }, 60);

      const deleted = await request(app).delete('/cache/01310-100').set('x-admin-token', 'segredo');
      expect(deleted.status).toBe(200);
      expect(await getCache().get('nearby:99999999')).toEqual({ marker: true });

      mockBrasilApi('01310100');
      nock(OVERPASS_A).post('/api/interpreter').reply(200, overpassBody);
      const again = await request(app).get('/ceps-proximos/01310100');
      expect(again.status).toBe(200);
    });

    it('DELETE /cache/:cep valida o CEP (400)', async () => {
      const response = await request(app).delete('/cache/abc').set('x-admin-token', 'segredo');
      expect(response.status).toBe(400);
    });

    it('DELETE /cache limpa todo o cache', async () => {
      await getCache().set('geocode:1', 1, 60);
      await getCache().set('nearby:1', 1, 60);

      const response = await request(app).delete('/cache').set('x-admin-token', 'segredo');
      expect(response.status).toBe(200);
      expect(await getCache().keys()).toEqual([]);
    });
  });

  describe('outras rotas', () => {
    it('GET /health', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('rota inexistente retorna 404', async () => {
      const response = await request(app).get('/nao-existe');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('ROTA_NAO_ENCONTRADA');
    });
  });
});
