import { RateLimiter } from '../src/utils/rateLimiter';
import { singleFlight } from '../src/utils/singleFlight';

describe('RateLimiter', () => {
  it('espaca chamadas sucessivas pelo intervalo minimo e as executa em ordem', async () => {
    const limiter = new RateLimiter(60);
    const startedAt: number[] = [];
    const t0 = Date.now();

    await Promise.all(
      [1, 2, 3].map(() =>
        limiter.schedule(async () => {
          startedAt.push(Date.now() - t0);
        }),
      ),
    );

    expect(startedAt[1] - startedAt[0]).toBeGreaterThanOrEqual(55);
    expect(startedAt[2] - startedAt[1]).toBeGreaterThanOrEqual(55);
  });

  it('com maxConcurrent=1 nao inicia a proxima chamada antes da anterior terminar', async () => {
    const limiter = new RateLimiter(0, 1);
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
    };

    await Promise.all([limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)]);
    expect(maxRunning).toBe(1);
  });

  it('com maxConcurrent=2 executa ate 2 chamadas em paralelo (e nunca mais que isso)', async () => {
    const limiter = new RateLimiter(0, 2);
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
    };

    await Promise.all([1, 2, 3, 4].map(() => limiter.schedule(task)));
    expect(maxRunning).toBe(2);
  });

  it('continua processando a fila quando uma tarefa falha', async () => {
    const limiter = new RateLimiter(0);
    const failing = limiter.schedule(async () => {
      throw new Error('falhou');
    });
    await expect(failing).rejects.toThrow('falhou');
    await expect(limiter.schedule(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('singleFlight', () => {
  it('compartilha uma unica execucao entre chamadas simultaneas da mesma chave', async () => {
    const task = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 42;
    });

    const results = await Promise.all([singleFlight('k', task), singleFlight('k', task), singleFlight('k', task)]);

    expect(results).toEqual([42, 42, 42]);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('libera a chave ao terminar (inclusive em erro), permitindo nova execucao', async () => {
    const task = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok');

    await expect(singleFlight('e', task)).rejects.toThrow('x');
    await expect(singleFlight('e', task)).resolves.toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('nao mistura chaves diferentes', async () => {
    const a = jest.fn(async () => 'a');
    const b = jest.fn(async () => 'b');
    await expect(Promise.all([singleFlight('ka', a), singleFlight('kb', b)])).resolves.toEqual(['a', 'b']);
  });
});
