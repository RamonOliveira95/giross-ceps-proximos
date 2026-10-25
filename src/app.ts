import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import cepRoutes from './routes/cepRoutes';
import cacheRoutes from './routes/cacheRoutes';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';

export function createApp(): Express {
  const app = express();

  if (env.trustProxyHops > 0) app.set('trust proxy', env.trustProxyHops);
  app.use(helmet());
  app.use(cors());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.apiRateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'MUITAS_REQUISICOES', message: 'Limite de requisicoes excedido. Tente novamente em instantes.' },
  });

  app.use('/ceps-proximos', apiLimiter);
  app.use(cepRoutes);
  app.use(cacheRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
