import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import { getCache, invalidateCep } from '../services/cache';
import { validateCep } from '../utils/cep';
import { UnauthorizedError } from '../utils/errors';

const router = Router();

function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

// Sem ADMIN_TOKEN os endpoints ficam abertos (conveniente em desenvolvimento).
function requireAdminToken(req: Request, _res: Response, next: NextFunction): void {
  if (env.adminToken && !safeEquals(String(req.header('x-admin-token') ?? ''), env.adminToken)) {
    next(new UnauthorizedError());
    return;
  }
  next();
}

/**
 * Endpoints auxiliares (diferencial) para invalidar o cache manualmente.
 * Informa no campo 'storage' qual camada foi limpa ('memory' ou 'redis').
 */
router.delete('/cache/:cep', requireAdminToken, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cep = validateCep(String(req.params.cep));
    await invalidateCep(cep);
    res.status(200).json({
      message: `Cache do CEP ${cep} invalidado com sucesso.`,
      storage: getCache().storageType,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/cache', requireAdminToken, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cache = getCache();
    await cache.clear();
    res.status(200).json({
      message: 'Cache limpo com sucesso.',
      storage: cache.storageType,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
