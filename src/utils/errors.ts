export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

export class InvalidCepError extends AppError {
  constructor(cep: string) {
    super(400, 'CEP_INVALIDO', `CEP '${cep}' possui formato invalido. Use o formato 00000000 ou 00000-000.`);
  }
}

export class CepNotFoundError extends AppError {
  constructor(cep: string) {
    super(404, 'CEP_NAO_ENCONTRADO', `CEP '${cep}' nao foi encontrado.`);
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super(401, 'NAO_AUTORIZADO', "Token de administrador ausente ou invalido (header 'x-admin-token').");
  }
}

export class GeolocationNotFoundError extends AppError {
  constructor(cep: string) {
    super(
      404,
      'GEOLOCALIZACAO_NAO_ENCONTRADA',
      `O CEP '${cep}' existe, mas nao foi possivel obter sua geolocalizacao (lat/lng).`,
    );
  }
}

export class ExternalServiceError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(serviceName: string, cause?: unknown, retryAfterSeconds = 15) {
    super(
      503,
      'SERVICO_EXTERNO_INDISPONIVEL',
      `Nao foi possivel completar a requisicao pois o servico externo '${serviceName}' esta indisponivel no momento. Tente novamente em instantes.`,
    );
    this.retryAfterSeconds = retryAfterSeconds;
    if (cause instanceof Error) {
      this.cause = cause;
    }
  }
}
