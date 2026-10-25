import axios from 'axios';
import { env } from '../config/env';
import { ExternalServiceError } from '../utils/errors';
import { CepAddress } from '../types';

const http = axios.create({ timeout: 8000 });

interface BrasilApiCepResponse {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

// As coordenadas da BrasilAPI NAO sao usadas: sao o centro da cidade (o mesmo ponto para
// todos os CEPs dela), o que falsearia as distancias.
export async function fetchBrasilApiCep(cep: string): Promise<CepAddress | null> {
  let data: BrasilApiCepResponse;
  try {
    const response = await http.get<BrasilApiCepResponse>(`${env.brasilApiBaseUrl}/cep/v2/${cep}`);
    data = response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response && [400, 404].includes(error.response.status)) {
      return null;
    }
    throw new ExternalServiceError('BrasilAPI', error);
  }

  if (!data || typeof data !== 'object') {
    throw new ExternalServiceError('BrasilAPI (resposta invalida)');
  }

  return {
    logradouro: data.street ?? '',
    bairro: data.neighborhood ?? '',
    localidade: data.city ?? '',
    uf: data.state ?? '',
  };
}
