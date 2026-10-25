import { InvalidCepError } from './errors';

const CEP_PATTERN = /^\d{5}-?\d{3}$/;

export function sanitizeCep(rawCep: string): string {
  return (rawCep ?? '').trim().replace(/-/g, '');
}

export function validateCep(rawCep: string): string {
  const value = (rawCep ?? '').trim();
  if (!CEP_PATTERN.test(value)) {
    throw new InvalidCepError(rawCep);
  }
  return sanitizeCep(value);
}

export function formatCep(cep: string): string {
  return `${cep.slice(0, 5)}-${cep.slice(5)}`;
}
