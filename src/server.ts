import { createApp } from './app';
import { env } from './config/env';
import { getCache } from './services/cache';
import { logger } from './utils/logger';

// Conecta ao Redis na subida e nao na 1a requisicao.
getCache();

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(`API rodando em http://localhost:${env.port} (ambiente: ${env.nodeEnv})`);
});

// Encerramento gracioso: como PID 1, o Node ignora SIGTERM sem handler e o Docker
// precisaria esperar o timeout e enviar SIGKILL.
function shutdown(signal: string): void {
  logger.info(`${signal} recebido: encerrando...`);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  // Consultas ao Overpass podem demorar; nao espera alem de 10 s.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
