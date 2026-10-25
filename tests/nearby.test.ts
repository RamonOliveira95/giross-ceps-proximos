import { parsePostcodes, rankNearbyCeps } from '../src/services/nearbyCepService';

const ORIGIN = { lat: -23.5617698, lng: -46.6553299 };
// 0,001 grau de latitude ~ 111,19 m (raio medio de 6371 km).
const north = (meters: number) => ({ lat: ORIGIN.lat + meters / 111194.93, lng: ORIGIN.lng });

describe('parsePostcodes', () => {
  it('normaliza formatos validos e separa multiplos valores', () => {
    expect(parsePostcodes('01310-100')).toEqual(['01310100']);
    expect(parsePostcodes('01310100')).toEqual(['01310100']);
    expect(parsePostcodes('01310-100; 01311-000')).toEqual(['01310100', '01311000']);
  });

  it('ignora valores invalidos', () => {
    expect(parsePostcodes('')).toEqual([]);
    expect(parsePostcodes('01310')).toEqual([]);
    expect(parsePostcodes('abc')).toEqual([]);
    expect(parsePostcodes('01310-100x')).toEqual([]);
  });
});

describe('rankNearbyCeps', () => {
  it('calcula a distancia real ate o objeto do CEP, arredonda em 2 casas e ordena', () => {
    const result = rankNearbyCeps(
      ORIGIN,
      '01310100',
      [
        { postcode: '01311-000', ...north(444.78) },
        { postcode: '01310-200', ...north(222.39) },
        { postcode: '01310-300', ...north(999) },
      ],
      1000,
    );

    expect(result).toEqual([
      { cep: '01310200', distancia_km: 0.22 },
      { cep: '01311000', distancia_km: 0.44 },
      { cep: '01310300', distancia_km: 1 },
    ]);
  });

  it('usa a menor distancia quando o mesmo CEP aparece em varios pontos', () => {
    const result = rankNearbyCeps(
      ORIGIN,
      '01310100',
      [
        { postcode: '01310-200', ...north(800) },
        { postcode: '01310-200', ...north(300) },
        { postcode: '01310200', ...north(500) },
      ],
      1000,
    );
    expect(result).toEqual([{ cep: '01310200', distancia_km: 0.3 }]);
  });

  it('descarta o CEP de origem, pontos fora do raio e CEPs invalidos', () => {
    const result = rankNearbyCeps(
      ORIGIN,
      '01310100',
      [
        { postcode: '01310-100', ...north(100) },
        { postcode: '01310-200', ...north(1001) },
        { postcode: 'invalido', ...north(100) },
        { postcode: '01310-300', ...north(100) },
      ],
      1000,
    );
    expect(result).toEqual([{ cep: '01310300', distancia_km: 0.1 }]);
  });

  it('retorna lista vazia quando nao ha pontos', () => {
    expect(rankNearbyCeps(ORIGIN, '01310100', [], 1000)).toEqual([]);
  });

  it('desempata distancias iguais pelo CEP, de forma deterministica', () => {
    const point = north(250);
    const result = rankNearbyCeps(
      ORIGIN,
      '01310100',
      [
        { postcode: '01310-300', ...point },
        { postcode: '01310-200', ...point },
      ],
      1000,
    );
    expect(result.map((r) => r.cep)).toEqual(['01310200', '01310300']);
  });
});
