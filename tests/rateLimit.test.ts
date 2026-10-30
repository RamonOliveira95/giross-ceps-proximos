process.env.API_RATE_LIMIT_PER_MINUTE = '2';
process.env.REDIS_URL = '';

/* eslint-disable @typescript-eslint/no-require-imports */
const request = require('supertest');
const { createApp } = require('../src/app');

describe('rate limiting da API', () => {
  it('retorna 429 ao exceder o limite por IP em /ceps-proximos', async () => {
    const app = createApp();

    // CEPs invalidos: nao consomem nenhuma API externa, mas contam para o limite.
    expect((await request(app).get('/ceps-proximos/1')).status).toBe(400);
    expect((await request(app).get('/ceps-proximos/2')).status).toBe(400);

    const limited = await request(app).get('/ceps-proximos/3');
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('MUITAS_REQUISICOES');
  });

  it('nao limita /health', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
  });
});
