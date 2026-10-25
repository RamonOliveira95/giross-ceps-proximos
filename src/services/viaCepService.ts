import axios from 'axios';
import { env } from '../config/env';
import { CepNotFoundError, ExternalServiceError } from '../utils/errors';
import { CepAddress } from '../types';

const http = axios.create({ timeout: 5000 });

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

export async function fetchViaCep(cep: string): Promise<CepAddress> {
  let data: ViaCepResponse | undefined;
  try {
    const response = await http.get<ViaCepResponse>(`${env.viaCepBaseUrl}/${cep}/json/`);
    data = response.data;
  } catch (error) {
    // O ViaCEP responde 400 para CEPs com formato que ele considera invalido.
    if (axios.isAxiosError(error) && error.response?.status === 400) {
      throw new CepNotFoundError(cep);
    }
    throw new ExternalServiceError('ViaCEP', error);
  }

  if (!data || typeof data !== 'object' || data.erro) {
    throw new CepNotFoundError(cep);
  }

  return {
    logradouro: data.logradouro ?? '',
    bairro: data.bairro ?? '',
    localidade: data.localidade ?? '',
    uf: data.uf ?? '',
  };
}
