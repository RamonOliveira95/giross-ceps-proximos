# Giross - CEPs Próximos API

API REST em Node.js/TypeScript (Express) que recebe um CEP e retorna todos os CEPs
num raio de 1 km, cada um com a distância (km, 2 casas decimais) até o CEP de origem,
ordenados do mais perto para o mais longe.

Case técnico – Desenvolvedor Fullstack Jr. – Giross.

## Sumário

- [Como rodar](#como-rodar)
- [Endpoints](#endpoints)
- [Estratégia: como buscar CEPs num raio de 1 km](#estratégia-como-buscar-ceps-num-raio-de-1-km)
- [Trade-off: precisão × performance](#trade-off-precisão--performance)
- [Cache e TTLs](#cache-e-ttls)
- [Tratamento de erros](#tratamento-de-erros)
- [Diferenciais implementados](#diferenciais-implementados)
- [Limitações conhecidas e próximos passos](#limitações-conhecidas-e-próximos-passos)
- [Proteger a invalidação de cache (ADMIN_TOKEN)](#proteger-a-invalidação-de-cache-admin_token)
- [Testes](#testes)
- [Collection do Postman](#collection-do-postman)
- [Docker](#docker)
- [Variáveis de ambiente](#variáveis-de-ambiente)

## Como rodar

```bash
npm install
cp .env.example .env
npm run dev
```

Sobe em `http://localhost:3000` (`PORT` no `.env`).

```bash
curl http://localhost:3000/ceps-proximos/01310-100
```

> A **primeira** consulta de um CEP em região densa pode levar ~30 s (ver
> [Trade-off](#trade-off-precisão--performance)); as seguintes saem do cache em milissegundos.
> Para testar pela interface, importe a [collection do Postman](#collection-do-postman).

## Endpoints

| Método | Rota                  | Descrição                                                  |
| ------ | --------------------- | ---------------------------------------------------------- |
| GET    | `/ceps-proximos/:cep` | CEPs num raio de 1 km (aceita `01310100` ou `01310-100`)   |
| DELETE | `/cache/:cep`         | Invalida o cache (geocoding, busca, cache negativo) de um CEP |
| DELETE | `/cache`              | Limpa todo o cache                                         |
| GET    | `/health`             | Health check                                               |

Resposta real de `GET /ceps-proximos/01310-100` (trecho; no total foram 158 CEPs):

```json
{
  "cep_origem": "01310-100",
  "endereco_origem": "Avenida Paulista, Bela Vista, São Paulo - SP",
  "raio_km": 1,
  "total_encontrados": 158,
  "ceps_proximos": [
    { "cep": "01332-030", "distancia_km": 0.04 },
    { "cep": "01310-200", "distancia_km": 0.07 },
    { "cep": "01311-200", "distancia_km": 0.07 },
    { "cep": "01332-000", "distancia_km": 0.08 }
  ]
}
```

## Estratégia: como buscar CEPs num raio de 1 km

Não existe API pública gratuita que liste "CEPs num raio X". O que existe de aberto e
gratuito são os dados do **OpenStreetMap (OSM)**, onde muitos endereços/vias têm a tag
`addr:postcode` (CEP) e coordenadas. A solução tem duas etapas:

### 1. Geocoding da origem (CEP → lat/lng)

1. **Endereço** (valida que o CEP existe): **BrasilAPI v2** e, se ela estiver fora do ar ou
   não conhecer o CEP, **ViaCEP**.
2. **Coordenadas**: **Nominatim** (OSM), respeitando o limite de 1 req/s. Primeiro pelo
   próprio CEP (`postalcode`), que devolve o ponto que o OSM associa a ele – a mesma base
   (`addr:postcode`) usada na busca por raio. Se o OSM não conhecer o CEP, geocodifica-se
   pelo endereço (rua, bairro, cidade, UF).

> **Por que não usar as coordenadas da BrasilAPI?** Em testes (Out/2026) a BrasilAPI v2
> devolveu para **todos** os CEPs de uma cidade o mesmo ponto (o centro da cidade; ex.: todos
> os CEPs de São Paulo em `-23.5475, -46.63611`, `service: open-cep`). Usá-las faria a origem
> cair a quilômetros do CEP real e falsearia todas as distâncias. Por isso a BrasilAPI é
> usada só para o endereço.

### 2. CEPs vizinhos: uma consulta ao Overpass API (OSM)

Com a lat/lng da origem, uma **única** consulta ao Overpass:

```
[out:json][timeout:60];
nwr(around:1000,<lat>,<lng>)["addr:postcode"];
out center tags qt;
```

devolve todos os objetos (nós, vias e relações) com CEP dentro do raio, já com coordenadas.
Em seguida, no servidor:

1. Normaliza a tag (`01310-100`, `01310100`, `01310-100;01311-000` → CEPs de 8 dígitos;
   valores inválidos são descartados).
2. Calcula a **distância real (Haversine)** da origem até cada objeto.
3. Para cada CEP, fica com a **menor** distância entre os objetos que o carregam.
4. Descarta o próprio CEP de origem e tudo que ficar além de 1000 m (o `around` do
   Overpass considera a geometria; aqui medimos até o ponto central).
5. Arredonda para 2 casas e ordena por distância (empate → ordem do CEP, determinístico).

**Por que essa estratégia?** Uma abordagem anterior (reverse-geocoding de ~24 pontos em
anéis ao redor da origem) foi descartada: levava ~25 s só em chamadas serializadas ao
Nominatim, encontrava no máximo 24 CEPs (a consulta Overpass acima achou 158 só na
região da Av. Paulista) e, pior, a distância reportada era a do *anel* (350/700/1000 m),
não a distância real até o CEP.

## Trade-off: precisão × performance

| Aspecto | Escolha / consequência |
| ------- | ---------------------- |
| **Cobertura** | Depende do OSM: CEPs sem `addr:postcode` mapeado não aparecem. Grandes centros têm boa cobertura; cidades pequenas e áreas rurais, esparsa. Não existe fonte pública, gratuita e completa de CEP com coordenadas no Brasil. |
| **Distância** | Haversine até o objeto OSM mais próximo daquele CEP – e não até um "centro" do CEP, que a base não fornece. Para o raio de 1 km o erro da esfera é < 0,5 %. Um CEP que cobre uma rua longa aparece com a distância do ponto dela mais próximo da origem. |
| **Origem** | A coordenada vem do Nominatim/OSM (ponto do CEP ou, na falta, do endereço), logo é aproximada: um CEP que cobre uma rua longa tem a origem num ponto dela, e a lista de vizinhos muda conforme esse ponto. |
| **Latência (1ª consulta)** | 1 chamada ao Overpass: **30–45 s medidos** (Av. Paulista, 4 400+ objetos, 158+ CEPs). Esse tempo é do servidor público e **não depende do tamanho da consulta**: até uma consulta trivial (`node(1)`) levou ~37 s no mesmo horário; o conteúdo da resposta (JSON, CSV, nós/vias) também não mudou o tempo. O Overpass público ainda responde 502/429/504 quando lotado, então há retries com backoff, rotação de mirrors, orçamento total de tempo e 503 claro com `Retry-After`. |
| **Consultas repetidas** | ~50 ms, via cache (ver abaixo). Consultas simultâneas ao mesmo CEP compartilham uma única execução. |
| **Alternativa para produção** | Base própria (ex.: CNEFE/IBGE ou base licenciada) em PostGIS/índice geoespacial: busca em milissegundos e cobertura completa, ao custo de ingestão e manutenção da base. É a evolução natural se esse endpoint for crítico. |

## Cache e TTLs

Duas camadas (mais um cache negativo curto), todas por CEP:

| Cache | Chave | TTL padrão | Justificativa |
| ----- | ----- | ---------- | ------------- |
| Geocoding (CEP → lat/lng + endereço) | `geocode:{cep}` | **7 dias** (`604800`) | Endereço e coordenadas de um CEP praticamente não mudam. TTL longo maximiza o hit-rate e poupa a cota das APIs públicas. |
| Busca "CEPs no raio de 1 km" (resultado completo) | `nearby:{cep}` | **24 h** (`86400`) | É o resultado mais caro (~30 s). O OSM muda diariamente, mas a lista de CEPs de uma área muda pouco; 1 dia equilibra atualidade e custo. Menor que o do geocoding. |
| CEP inexistente (cache negativo) | `notfound:{cep}` | **10 min** (`600`) | Evita repetir chamadas por CEPs inexistentes sem "grudar" um erro caso a base externa seja corrigida. |

Detalhes:

- A busca é cacheada **com a origem**: um *hit* em `nearby:` não toca em nenhuma API.
- **Falhas nunca são cacheadas** (503, resposta parcial do Overpass etc.), para um erro
  transitório não ficar "preso" no cache.
- **Single-flight**: N requisições simultâneas ao mesmo CEP sem cache geram uma única
  chamada externa.
- `ICache` com duas implementações: `MemoryCache` (`node-cache`, padrão) e `RedisCache`
  (ativado por `REDIS_URL`; chaves sob o namespace `giross:`, `SCAN` em vez de `KEYS`, e
  falha do Redis vira *cache miss* em vez de derrubar a API).
- Os TTLs são configuráveis por variável de ambiente.

## Tratamento de erros

| Cenário | Status | Código |
| ------- | ------ | ------ |
| CEP em formato inválido (só `00000000` ou `00000-000`) | 400 | `CEP_INVALIDO` |
| CEP inexistente | 404 | `CEP_NAO_ENCONTRADO` |
| CEP existe, mas sem geolocalização obtida | 404 | `GEOLOCALIZACAO_NAO_ENCONTRADA` |
| BrasilAPI/ViaCEP/Nominatim/Overpass indisponível, timeout ou resposta inválida | 503 (com header `Retry-After`) | `SERVICO_EXTERNO_INDISPONIVEL` |
| Limite de requisições por IP excedido | 429 | `MUITAS_REQUISICOES` |
| `DELETE /cache` sem/ com token inválido (quando `ADMIN_TOKEN` definido) | 401 | `NAO_AUTORIZADO` |
| Rota inexistente | 404 | `ROTA_NAO_ENCONTRADA` |
| Erro inesperado | 500 | `ERRO_INTERNO` |

Um CEP válido sem nenhum CEP mapeado no raio retorna **200** com lista vazia.

### Resiliência do Overpass (origem dos 503)

O Overpass público (`overpass-api.de`) responde 502 *"currently at capacity"* quando está
lotado e pede retry com backoff. Por isso, para cada consulta:

1. Tenta cada mirror (`overpass-api.de`, `lz4.` e `z.`) em ordem; o último que respondeu vai primeiro.
2. Se todos falharem com erro transitório (timeout, 408/429/5xx, resposta parcial), espera
   (backoff exponencial com jitter: ~2 s, ~4 s) e faz nova rodada, até `OVERPASS_MAX_ROUNDS`.
3. Tudo limitado por `OVERPASS_TOTAL_BUDGET_MS` (150 s). Erros não transitórios (ex.: 400) não repetem.
4. Até `OVERPASS_MAX_CONCURRENT` (2) consultas simultâneas, espaçadas de 1 s.
5. Só então responde 503. A causa detalhada (mirror, HTTP/timeout) vai para o log do servidor.

Se o cliente desistir (timeout do Postman, por exemplo) a consulta **continua no servidor** e,
ao terminar, fica em cache: repetir a mesma chamada em seguida responde na hora.

## Diferenciais implementados

- ✅ **Redis** como cache (opcional, `REDIS_URL`), com fallback para memória quando ausente.
- ✅ **Rate limiting** da API externa: espaçamento mínimo entre chamadas ao
  Nominatim (1,1 s, conforme a política de uso, 1 por vez) e ao Overpass (1 s entre inícios, até 2 simultâneas), em
  [src/utils/rateLimiter.ts](src/utils/rateLimiter.ts). Também há rate limit por IP na própria
  API (`API_RATE_LIMIT_PER_MINUTE`, padrão 60).
- ✅ **Invalidação manual de cache**: `DELETE /cache` e `DELETE /cache/:cep`, protegidos
  por `ADMIN_TOKEN` (header `x-admin-token`) quando definido. Ver
  [Proteger a invalidação de cache](#proteger-a-invalidação-de-cache-admin_token).
- ✅ **Dockerfile** multi-stage (usuário não root, `HEALTHCHECK`) + `docker-compose.yml`
  com Redis.

## Limitações conhecidas e próximos passos

- Cobertura e latência dependem do OSM/Overpass público (ver trade-off). Em produção:
  instância própria do Overpass ou base própria de CEPs geolocalizados.
- Sem `ADMIN_TOKEN`, os endpoints `DELETE /cache` ficam abertos (pensado para
  desenvolvimento) – defina o token em qualquer ambiente exposto.
- Overpass e Nominatim exigem `User-Agent` identificável: configure um contato real em
  `NOMINATIM_USER_AGENT`.
- Com várias instâncias da API e cache em memória, cada uma mantém seu cache (e seu
  rate limit): use Redis.
- O rate limit por IP é em memória; atrás de proxy/load balancer defina `TRUST_PROXY_HOPS`
  (ex.: `1`) para que ele use o IP real do cliente.
- Se o Overpass público estiver fora do ar por mais que o orçamento de tempo, a API responde 503
  (não há resposta de contingência: devolver dados desatualizados ou aproximados seria pior).

## Proteger a invalidação de cache (`ADMIN_TOKEN`)

O token é **opcional**: sem `ADMIN_TOKEN`, `DELETE /cache` fica aberto (conveniente para
avaliar/desenvolver localmente). Em qualquer ambiente exposto, defina-o:

```bash
# 1. gerar um segredo forte e colocá-lo no .env (que não vai para o Git)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# ADMIN_TOKEN=<valor gerado>

# 2. chamar os endpoints com o header x-admin-token
curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/cache
curl -X DELETE -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/cache/01310-100
```

Sem o header (ou com valor errado) a resposta é `401 NAO_AUTORIZADO`. A comparação é em
tempo constante (`timingSafeEqual`). Com `docker compose`, o valor é lido do `.env` ao
lado do `docker-compose.yml`.

## Testes

```bash
npm test
```

- `tests/geo.test.ts`: Haversine com valores esperados calculados à mão (1° de latitude =
  111,19 km, encolhimento por cos(lat) etc.).
- `tests/nearby.test.ts`: normalização de CEPs do OSM e ranking (menor distância por CEP,
  descarte da origem/fora do raio, arredondamento, empate determinístico).
- `tests/cep.test.ts`: validação estrita de CEP.
- `tests/cache.test.ts`: `MemoryCache` (inclui expiração por TTL) e `RedisCache` (fake de
  cliente: namespace, TTL, `clear` sem afetar chaves alheias, Redis fora do ar).
- `tests/utils.test.ts`: rate limiter e single-flight.
- `tests/api.integration.test.ts`: API ponta a ponta com `nock` (BrasilAPI, ViaCEP,
  Nominatim e Overpass mockados): 400/404/503, fallbacks, mirrors do Overpass, falha não
  cacheada, cache (2ª consulta sem chamadas externas, expiração parcial, concorrência) e
  `DELETE /cache`.
- `tests/rateLimit.test.ts`: 429 por IP.

## Collection do Postman

A collection em [postman/giross-ceps-proximos.postman_collection.json](postman/giross-ceps-proximos.postman_collection.json)
permite testar a API manualmente, com asserções automáticas em cada requisição.

**Como usar**

1. Suba a API (`docker compose up --build` ou `npm run dev`).
2. No Postman: **Import** → selecione o arquivo da collection.
3. Em **Variables** da collection, confira:
   - `baseUrl` – padrão `http://localhost:3000`;
   - `cep` – padrão `01310-100`;
   - `adminToken` – só se o servidor tiver `ADMIN_TOKEN` definido (use *Current value*, não
     *Initial value*, para o segredo não ser sincronizado/exportado).
4. Execute as pastas em ordem (**Run collection**).

**O que cada pasta cobre**

| Pasta | Requisições | O que valida |
| ----- | ----------- | ------------ |
| 1. Consulta principal | `GET /ceps-proximos/:cep` (1ª chamada, 2ª chamada, CEP sem hífen) | Status 200; campos da resposta; distâncias entre 0 e 1 km com no máximo 2 casas; ordenação crescente; sem CEPs repetidos nem o CEP de origem; 2ª chamada e variação sem hífen servidas do cache (< 1 s) |
| 2. Erros e casos de borda | CEP com letras, com 7 dígitos, com lixo após o CEP, inexistente, rota inexistente | 400 `CEP_INVALIDO`, 404 `CEP_NAO_ENCONTRADO`, 404 `ROTA_NAO_ENCONTRADA` |
| 3. Delete Cache | `DELETE /cache/:cep`, `DELETE /cache/abc`, `DELETE /cache`, `DELETE /cache` sem token | 200 com token; 400 para CEP inválido; 401 `NAO_AUTORIZADO` sem token quando `ADMIN_TOKEN` está ativo (sem `ADMIN_TOKEN` no servidor, aceita 200) |
| 4. Infra | `GET /health` | 200 e `status: ok` |

**Dicas**

- A 1ª chamada de um CEP novo pode levar 30–45 s (ver [Trade-off](#trade-off-precisão--performance));
  com várias consultas simultâneas a espera soma. Se o Postman der timeout, repita a chamada:
  a consulta continua no servidor e o resultado entra em cache. Se a resposta for 503, veja
  o log do servidor (traz a causa) e tente de novo em instantes.
- Para repetir o teste de cache a partir do zero, rode antes `DELETE /cache`.
- Cenários que exigem alterar o ambiente não estão na collection:
  - **503 (API externa fora do ar):** suba a API com `OVERPASS_URLS=http://localhost:9` e
    consulte um CEP novo (falha em poucos segundos, com `Retry-After`).
  - **429 (rate limit por IP):** use `API_RATE_LIMIT_PER_MINUTE=3` e faça 4 chamadas seguidas.
  Ambos são cobertos pelos testes automatizados (`npm test`).

## Docker

```bash
docker compose up --build        # API + Redis
```

ou só a API (cache em memória):

```bash
docker build -t giross-ceps-proximos .
docker run -p 3000:3000 --env-file .env giross-ceps-proximos
```

## Variáveis de ambiente

Lista completa em [.env.example](.env.example). Principais:

| Variável | Padrão | Descrição |
| -------- | ------ | --------- |
| `GEOCODE_CACHE_TTL_SECONDS` | `604800` (7 d) | TTL do cache de geocoding |
| `NEARBY_CACHE_TTL_SECONDS` | `86400` (24 h) | TTL do cache da busca por raio |
| `NOT_FOUND_CACHE_TTL_SECONDS` | `600` (10 min) | TTL do cache negativo |
| `NEARBY_SEARCH_RADIUS_METERS` | `1000` | Raio de busca |
| `NOMINATIM_MIN_INTERVAL_MS` / `OVERPASS_MIN_INTERVAL_MS` | `1100` / `1000` | Intervalo mínimo entre chamadas às APIs externas |
| `OVERPASS_URLS` | overpass-api.de, lz4., z. | Mirrors, tentados em ordem |
| `OVERPASS_TIMEOUT_MS` | `60000` | Timeout de cada tentativa |
| `OVERPASS_MAX_ROUNDS` / `OVERPASS_BACKOFF_MS` | `3` / `2000` | Rodadas pelos mirrors e backoff base entre elas |
| `OVERPASS_TOTAL_BUDGET_MS` | `150000` | Orçamento total de tempo de uma consulta ao Overpass |
| `OVERPASS_MAX_CONCURRENT` | `2` | Consultas simultâneas ao Overpass |
| `TRUST_PROXY_HOPS` | `0` | Proxies na frente da API (IP real no rate limit) |
| `API_RATE_LIMIT_PER_MINUTE` | `60` | Limite por IP em `/ceps-proximos` |
| `ADMIN_TOKEN` | _(vazio)_ | Protege `DELETE /cache` |
| `REDIS_URL` | _(vazio)_ | Usa Redis em vez de memória |

## Stack

Node.js + TypeScript + Express · `axios` · `node-cache` / `ioredis` · `helmet`, `cors`,
`express-rate-limit` · `jest` + `supertest` + `nock`.
