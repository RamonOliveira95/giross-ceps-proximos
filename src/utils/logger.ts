/* eslint-disable no-console -- unico ponto de saida de logs da aplicacao */

// Nos testes (NODE_ENV=test, definido pelo Jest) nao emite nada.
const silent = process.env.NODE_ENV === 'test';

export const logger = {
  info: (message: string): void => {
    if (!silent) console.log(message);
  },
  warn: (message: string): void => {
    if (!silent) console.warn(message);
  },
  error: (message: string, error?: unknown): void => {
    if (!silent) console.error(message, error ?? '');
  },
};
