export interface ICache {
  readonly storageType: 'memory' | 'redis';
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Remove todas as chaves que comecam com o prefixo informado (ou tudo, se omitido). */
  clear(prefix?: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}
