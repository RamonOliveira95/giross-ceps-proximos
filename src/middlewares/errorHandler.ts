import { Request, Response, NextFunction } from 'express';
import { AppError, ExternalServiceError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err instanceof ExternalServiceError) {
      // Sem este log a causa real do 503 (qual servico, status, timeout) seria invisivel.
      const cause = err.cause instanceof Error ? err.cause.message : 'sem detalhes';
      logger.warn(`[503] ${req.method} ${req.originalUrl} -> ${err.message} Causa: ${cause}`);
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
    }
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  logger.error(`Erro nao tratado em ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ error: 'ERRO_INTERNO', message: 'Erro interno inesperado.' });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'ROTA_NAO_ENCONTRADA', message: 'Rota nao encontrada.' });
}
