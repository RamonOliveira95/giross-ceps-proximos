# Giross - CEPs Próximos API

API REST em Node.js/TypeScript (Express) que recebe um CEP e retorna todos os CEPs
num raio de 1 km, cada um com a distância (km, 2 casas decimais) até o CEP de origem,
ordenados do mais perto para o mais longe.

Case técnico – Desenvolvedor Fullstack Jr. – Giross.

## Sumário

- [Como rodar](#como-rodar)
- [Endpoints](#endpoints)
- [Melhorias e Evoluções Recentes (v1.1)](#melhorias-e-evoluções-recentes-v11)
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
# Se REDIS_URL estiver ativa no .env, inicie o Redis (ex: docker compose up redis -d)
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

Exemplo de resposta de `GET /ceps-proximos/01310-100` (trecho):

```json
{
  "cep_origem": "01310-100",
  "endereco_origem": "Avenida Paulista, Bela Vista, São Paulo - SP",
  "raio_km": 1,
  "total_encontrados": 147,
  "ceps_proximos": [
    { "cep": "01404-100", "distancia_km": 0.03 },
    { "cep": "01311-100", "distancia_km": 0.05 },
    { "cep": "01404-000", "distancia_km": 0.07 },
    { "cep": "01310-940", "distancia_km": 0.09 }
  ]
}
```

Exemplo de resposta de `DELETE /cache`:

```json
{
  "message": "Cache limpo com sucesso.",
  "storage": "memory"
}
```

---

## Melhorias e Evoluções Recentes (v1.1)

Com base em análises de arquitetura e cenários de borda em alta escala, foram implementadas as seguintes melhorias:

### 1. Transparência e Rigor na Invalidação do Cache (`DELETE /cache` com ou sem Redis)
- **Cenário:** O endpoint permitia invalidar o cache mesmo quando o Redis não estava em execução.
- **Explicação:** A aplicação segue o padrão *Strategy* via interface `ICache`. Quando `REDIS_URL` não é configurada, a camada de cache em memória (`MemoryCache` via `node-cache`) assume a responsabilidade de forma transparente (limpando a memória RAM local).
- **Implementação com Redis Obrigatório:** Uma vez que `REDIS_URL` está ativa no `.env`, o Redis se torna a dependência oficial de cache. Se o Redis estiver offline ou inacessível, a aplicação não mascara a falha: tentativas de invalidação (`DELETE /cache` ou `DELETE /cache/:cep`) retornam erro **503 `SERVICO_EXTERNO_INDISPONIVEL`** com o header `Retry-After: 15`. Isso impede falsos positivos de sucesso quando o serviço de cache estiver fora do ar. Além disso, o campo `storage` (`"memory"` ou `"redis"`) é retornado explicitamente em caso de sucesso.

### 2. Desambiguação de Ruas Homônimas no Nominatim (Busca Estruturada)
- **Cenário:** Ruas com nomes comuns (ex: "Avenida Brasil", "Rua São José", "Rua 1") podiam sofrer desvios caso o Nominatim utilizasse busca livre por texto (`q`), retornando coordenadas de outra cidade com maior relevância histórica no OSM.
- **Implementação:** O fluxo de geocodificação foi aprimorado para **três níveis de precisão**:
  1. **CEP exato (`postalcode`):** Consulta direta ao CEP na base do OSM.
  2. **Busca Estruturada (`street`, `city`, `state`):** Se o CEP não constar no OSM, a busca é delimitada estritamente aos limites do município e estado retornados pela BrasilAPI/ViaCEP, eliminando falsos positivos entre cidades diferentes.
  3. **Busca Livre (`q`):** Mantida apenas como último recurso para logradouros atípicos (rodovias, praças, monumentos).

### 3. Prevenção e Tratamento de Estouro de Memória

- **Cenário 1: No processo Node.js local (`MemoryCache` - Heap Out of Memory)**
  - **Problema:** Em execuções prolongadas sem Redis sob alto tráfego, o crescimento contínuo de chaves em memória poderia esgotar a Heap do V8 e derrubar o processo Node.js.
  - **Tratamento:** Configurado `maxKeys: 5000` no `MemoryCache`. Ao atingir a capacidade máxima, o `node-cache` descarta automaticamente as entradas mais antigas aplicando a política **LRU (Least Recently Used)**, mantendo o consumo de RAM estável e previsível.

- **Cenário 2: No servidor da Overpass API (`Query ran out of memory`)**
  - **Problema:** Em regiões hiperdensas (como centros metropolitanos), o servidor público do Overpass pode esgotar sua cota de RAM por consulta. Quando isso acontece, o Overpass responde **HTTP 200** com a lista de elementos vazia (`elements: []`) e a mensagem `"runtime error: Query ran out of memory"` no campo `remark`. Se não tratado, a API responderia falsamente que existem 0 CEPs e salvaria essa informação falsa no cache.
  - **Tratamento implementado:**
    1. **Prevenção:** Definido explicitamente `[maxsize:1073741824]` (1 GB de RAM alocada para a query), permitindo que o Overpass utilize mais memória antes de falhar.
    2. **Detecção e Rejeição:** A função `parseElements` inspeciona o campo `remark`. Ao detectar erro de memória, **rejeita a resposta vazia imediatamente**, emitindo log de alerta e lançando exceção para impedir falso positivo.
    3. **Resiliência e Retry:** A requisição é tentada nos outros mirrors disponíveis (`lz4` e `z`) com backoff exponencial.
    4. **Resposta ao Cliente:** Se todos os mirrors estiverem sem memória disponível, a API responde **`503 SERVICO_EXTERNO_INDISPONIVEL`** com o header HTTP **`Retry-After: 30`** (orientando o cliente a aguardar 30 segundos até que os workers de memória do servidor sejam liberados).
    5. **Proteção do Cache:** O erro **nunca é cacheado**, garantindo que, assim que a infraestrutura liberar memória, a próxima requisição seja executada do zero com sucesso.

---

## Estratégia: como buscar CEPs num raio de 1 km

Não existe API pública gratuita que liste "CEPs num raio X". O que existe de aberto e
gratuito são os dados do **OpenStreetMap (OSM)**, onde muitos endereços/vias têm a tag
`addr:postcode` (CEP) e coordenadas. A solução tem duas etapas:

### 1. Geocoding da origem (CEP → lat/lng)

1. **Endereço** (valida que o CEP existe): **BrasilAPI v2** e, se ela estiver fora do ar ou
   não conhecer o CEP, **ViaCEP**.
2. **Coordenadas**: **Nominatim** (OSM), respeitando o limite de 1 req/s:
   - 1º pelo próprio CEP (`postalcode`), mesma base da busca por raio;
   - 2º por busca estruturada (`street`, `city`, `state`), blindando contra homônimos;
   - 3º por busca livre (`q`), como fallback.

> **Por que não usar as coordenadas da BrasilAPI?** Em testes a BrasilAPI v2
> devolveu para **todos** os CEPs de uma cidade o mesmo ponto (o centro da cidade; ex.: todos
> os CEPs de São Paulo em `-23.5475, -46.63611`, `service: open-cep`). Usá-las faria a origem
> cair a quilômetros do CEP real e falsearia todas as distâncias. Por isso a BrasilAPI é
> usada só para o endereço.

### 2. CEPs vizinhos: uma consulta otimizada ao Overpass API (OSM)

Com a lat/lng da origem, uma **única** consulta ao Overpass:

```overpass
[out:json][timeout:60][maxsize:1073741824];
nwr(around:1000,<lat>,<lng>)["addr:postcode"];
out center tags qt;
```

devolve todos os objetos (nós e vias) com CEP dentro do raio, já com coordenadas.
Em seguida, no servidor:

1. Normaliza a tag (`01310-100`, `01310100`, `01310-100;01311-000` → CEPs de 8 dígitos;
   valores inválidos são descartados).
2. Calcula a **distância real (Haversine)** da origem até cada objeto.
3. Para cada CEP, fica com a **menor** distância entre os objetos que o carregam.
4. Descarta o próprio CEP de origem e tudo que ficar além de 1000 m (o `around` do
   Overpass considera a geometria; aqui medimos até o ponto central).
5. Arredonda para 2 casas e ordena por distância (empate → ordem do CEP, determinístico).

## Trade-off: precisão × performance

| Aspecto | Escolha / consequência |
| ------- | ---------------------- |
| **Cobertura** | Depende do OSM: CEPs sem `addr:postcode` mapeado não aparecem. Grandes centros têm boa cobertura; cidades pequenas e áreas rurais, esparsa. Não existe fonte pública, gratuita e completa de CEP com coordenadas no Brasil. |
| **Distância** | Haversine até o objeto OSM mais próximo daquele CEP – e não até um "centro" do CEP, que a base não fornece. Para o raio de 1 km o erro da esfera é < 0,5 %. Um CEP que cobre uma rua longa aparece com a distância do ponto dela mais próximo da origem. |
| **Origem** | A coordenada vem do Nominatim/OSM (ponto do CEP ou do logradouro estruturado), logo é aproximada: um CEP que cobre uma rua longa tem a origem num ponto dela, e a lista de vizinhos muda conforme esse ponto. |
| **Latência (1ª consulta)** | 1 chamada ao Overpass: **30–45 s medidos** (Av. Paulista, 4 400+ objetos, 147 CEPs). Esse tempo é do servidor público e **não depende do tamanho da consulta**: até uma consulta trivial (`node(1)`) levou ~37 s no mesmo horário; o conteúdo da resposta também não mudou o tempo. O Overpass público responde 502/429/504 quando lotado, então há retries com backoff, rotação de mirrors, orçamento total de tempo e 503 claro com `Retry-After`. |
| **Consultas repetidas** | ~50 ms, via cache (ver abaixo). Consultas simultâneas ao mesmo CEP compartilham uma única execução (*single-flight*). |
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
- `ICache` com duas implementações: `MemoryCache` (`node-cache` com teto de 5000 chaves contra OOM, padrão quando `REDIS_URL` não está configurada) e `RedisCache`
  (ativado obrigatoriamente por `REDIS_URL`; chaves sob o namespace `giross:`, `SCAN` em vez de `KEYS`; se o Redis estiver offline, a API reporta `503` nas operações de limpeza em vez de simular sucesso).
- Os TTLs são configuráveis por variável de ambiente.

## Tratamento de erros

| Cenário | Status | Código |
| ------- | ------ | ------ |
| CEP em formato inválido (só `00000000` ou `00000-000`) | 400 | `CEP_INVALIDO` |
| CEP inexistente | 404 | `CEP_NAO_ENCONTRADO` |
| CEP existe, mas sem geolocalização obtida | 404 | `GEOLOCALIZACAO_NAO_ENCONTRADA` |
| BrasilAPI/ViaCEP/Nominatim/Overpass/Redis (em DELETE) indisponível | 503 (com header `Retry-After`) | `SERVICO_EXTERNO_INDISPONIVEL` |
| Limite de requisições por IP excedido | 429 | `MUITAS_REQUISICOES` |
| `DELETE /cache` sem/ com token inválido (quando `ADMIN_TOKEN` definido) | 401 | `NAO_AUTORIZADO` |
| Rota inexistente | 404 | `ROTA_NAO_ENCONTRADA` |
| Erro inesperado | 500 | `ERRO_INTERNO` |

Um CEP válido sem nenhum CEP mapeado no raio retorna **200** com lista vazia.

### Resiliência do Overpass (origem dos 503)

O Overpass público responde HTTP 502 *"currently at capacity"* quando está lotado e HTTP 200 com `"runtime error: Query ran out of memory"` quando excede a RAM permitida. Por isso, para cada consulta:

1. Tenta cada mirror (`overpass-api.de`, `lz4.` e `z.`) em ordem; o último que respondeu com sucesso vai primeiro.
2. Se todos falharem com erro transitório (timeout, 408/429/5xx, erro de memória/resposta parcial no `remark`), espera (backoff exponencial com jitter: ~2 s, ~4 s) e faz nova rodada, até `OVERPASS_MAX_ROUNDS`.
3. Tudo limitado por `OVERPASS_TOTAL_BUDGET_MS` (150 s). Erros não transitórios (ex.: 400) não repetem.
4. Até `OVERPASS_MAX_CONCURRENT` (2) consultas simultâneas, espaçadas de 1 s.
5. Só então responde 503 com `Retry-After`. A causa detalhada (mirror, status, erro de memória) vai para o log do servidor.

Se o cliente desistir (timeout do Postman, por exemplo) a consulta **continua no servidor** e,
ao terminar, fica em cache: repetir a mesma chamada em seguida responde na hora.

## Diferenciais implementados

- ✅ **Redis** como cache (opcional, `REDIS_URL`), com fallback para memória quando ausente.
- ✅ **Rate limiting** da API externa: espaçamento mínimo entre chamadas ao
  Nominatim (1,1 s, conforme a política de uso, 1 por vez) e ao Overpass (1 s entre inícios, até 2 simultâneas), em
  [src/utils/rateLimiter.ts](src/utils/rateLimiter.ts). Também há rate limit por IP na própria
  API (`API_RATE_LIMIT_PER_MINUTE`, padrão 60).
- ✅ **Invalidação manual de cache**: `DELETE /cache` e `DELETE /cache/:cep`, protegidos
  por `ADMIN_TOKEN` (header `x-admin-token`) quando definido.
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
- Se o Overpass público estiver fora do ar por mais que o orçamento de tempo, a API responde 503.

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
  Nominatim e Overpass mockados): 400/404/503, busca estruturada, fallbacks, mirrors do Overpass, erro de memória do Overpass (503 com `Retry-After`), falha não
  cacheada, cache (2ª consulta sem chamadas externas, expiração parcial, concorrência) e
  `DELETE /cache`.
- `tests/rateLimit.test.ts`: 429 por IP.

## Collection do Postman

A collection em [postman/giross-ceps-proximos.postman_collection.json](postman/giross-ceps-proximos.postman_collection.json)
permite testar a API manualmente, com asserções automáticas em cada requisição.

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
| `REDIS_URL` | _(vazio)_ | Ativa o Redis obrigatoriamente (ex: `redis://localhost:6379`). Se estiver offline, operações de invalidação reportam `503`. |

## Stack

Node.js + TypeScript + Express · `axios` · `node-cache` / `ioredis` · `helmet`, `cors`,
`express-rate-limit` · `jest` + `supertest` + `nock`.
