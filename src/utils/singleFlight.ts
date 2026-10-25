const inFlight = new Map<string, Promise<unknown>>();

// Deduplica execucoes simultaneas da mesma chave (evita "cache stampede" de chamadas
// identicas as APIs externas).
export function singleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const promise = task().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
