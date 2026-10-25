export interface CepAddress {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult extends GeoPoint {
  cep: string;
  enderecoFormatado: string;
}

export interface CepProximo {
  cep: string;
  distancia_km: number;
}

export interface NearbyResult {
  origem: GeocodeResult;
  proximos: CepProximo[];
}
