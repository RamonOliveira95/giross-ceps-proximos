import { validateCep, sanitizeCep, formatCep } from '../src/utils/cep';
import { InvalidCepError } from '../src/utils/errors';

describe('sanitizeCep', () => {
  it('remove o hifen e espacos nas pontas', () => {
    expect(sanitizeCep('01310-100')).toBe('01310100');
    expect(sanitizeCep('01310100')).toBe('01310100');
    expect(sanitizeCep('  01310-100  ')).toBe('01310100');
  });
});

describe('validateCep', () => {
  it.each(['01310100', '01310-100', ' 01310-100 '])('aceita %p', (value) => {
    expect(validateCep(value)).toBe('01310100');
  });

  it.each(['', '123', '0131010', '013101000', '0131-0100', '01310-1000', '0131010a', '01.310-100', '01310-100abc', '--------', 'abcdefgh'])(
    'rejeita %p com InvalidCepError',
    (value) => {
      expect(() => validateCep(value)).toThrow(InvalidCepError);
    },
  );
});

describe('formatCep', () => {
  it('formata 8 digitos como 00000-000', () => {
    expect(formatCep('01310100')).toBe('01310-100');
  });
});
