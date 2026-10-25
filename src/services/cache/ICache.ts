export interface ICache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(prefix?: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}
