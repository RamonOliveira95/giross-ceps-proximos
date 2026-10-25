import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { validateCep, formatCep } from '../utils/cep';
import { findNearbyCeps } from '../services/nearbyCepService';

export async function getCepsProximos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cep = validateCep(String(req.params.cep));
    const { origem, proximos } = await findNearbyCeps(cep);

    res.status(200).json({
      cep_origem: formatCep(origem.cep),
      endereco_origem: origem.enderecoFormatado,
      raio_km: env.nearbySearchRadiusMeters / 1000,
      total_encontrados: proximos.length,
      ceps_proximos: proximos.map((item) => ({
        cep: formatCep(item.cep),
        distancia_km: item.distancia_km,
      })),
    });
  } catch (error) {
    next(error);
  }
}
