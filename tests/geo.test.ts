import { haversineDistanceMeters } from '../src/utils/geo';

const METERS_PER_DEGREE = (Math.PI / 180) * 6371000;

describe('haversineDistanceMeters', () => {
  it('retorna 0 para o mesmo ponto', () => {
    expect(haversineDistanceMeters(-23.561, -46.656, -23.561, -46.656)).toBe(0);
  });

  it('1 grau de latitude equivale a ~111,19 km (raio medio da Terra de 6371 km)', () => {
    expect(haversineDistanceMeters(0, 0, 1, 0)).toBeCloseTo(METERS_PER_DEGREE, 3);
  });

  it('1 grau de longitude no equador equivale a ~111,19 km', () => {
    expect(haversineDistanceMeters(0, 10, 0, 11)).toBeCloseTo(METERS_PER_DEGREE, 3);
  });

  it('1 grau de longitude a -23,5 graus de latitude encolhe por cos(lat)', () => {
    const lat = -23.5;
    const expected = METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
    // Haversine e a aproximacao plana divergem em ~0,1% nessa escala.
    expect(haversineDistanceMeters(lat, -46, lat, -45)).toBeCloseTo(expected, -2);
  });

  it('calcula a distancia entre dois pontos reais (Av. Paulista -> Praca da Se, ~2,6 km)', () => {
    const distance = haversineDistanceMeters(-23.5617698, -46.6553299, -23.5505, -46.6333);
    expect(distance).toBeGreaterThan(2500);
    expect(distance).toBeLessThan(2650);
  });

  it('e simetrica', () => {
    const d1 = haversineDistanceMeters(-23.5505, -46.6333, -23.5629, -46.6544);
    const d2 = haversineDistanceMeters(-23.5629, -46.6544, -23.5505, -46.6333);
    expect(d1).toBeCloseTo(d2, 6);
  });
});
