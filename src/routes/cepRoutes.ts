import { Router } from 'express';
import { getCepsProximos } from './cepController';

const router = Router();

router.get('/ceps-proximos/:cep', getCepsProximos);

export default router;
