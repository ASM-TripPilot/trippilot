import {
  create as createAxiosInstance,
  isAxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { installFaultInjection } from './interceptor';
import type { FaultRule } from './rules';

/**
 * 실패 주입 인터셉터 — axios 인스턴스에 달았을 때.
 *
 * 무엇을 보장하나:
 *  - GET 이 규칙에 맞으면 진짜 adapter 를 부르지 않고, 서버 4xx/5xx 와 같은 `AxiosError{response}` 로 거절한다.
 *  - 쓰기 요청(POST)은 같은 경로 규칙이 있어도 진짜 adapter 로 간다.
 *  - 규칙을 비우면(clear) 다시 진짜 adapter 로 간다.
 *  - 지연 규칙은 그 시간만큼 붙잡았다가 진짜 adapter 로 보낸다(상태가 같이 있으면 그 뒤 실패).
 *  - 저장소에서 규칙을 다 읽기 전(ready 전)에 나간 요청도 읽은 규칙으로 판정한다(앱 재시작 직후).
 */

function setup(initial: FaultRule[] = []) {
  let rules: readonly FaultRule[] = initial;
  let ready: Promise<void> = Promise.resolve();
  const realAdapter = jest.fn<
    Promise<AxiosResponse>,
    [InternalAxiosRequestConfig]
  >(async (config) => ({
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }));
  const client = createAxiosInstance({
    baseURL: 'https://api.test/api/v1',
    adapter: realAdapter as unknown as AxiosAdapter,
  });
  installFaultInjection(client, {
    ready: () => ready,
    rules: () => rules,
  });
  return {
    client,
    realAdapter,
    setRules: (next: FaultRule[]) => {
      rules = next;
    },
    setReady: (next: Promise<void>) => {
      ready = next;
    },
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('거절되지 않았다');
}

afterEach(() => {
  jest.useRealTimers();
});

describe('installFaultInjection', () => {
  it('GET 이 규칙에 맞으면 진짜 adapter 없이 그 상태·ErrorResponse 본문으로 거절한다', async () => {
    const { client, realAdapter } = setup([
      { path: '/trips/*/itinerary', status: 500 },
    ]);

    const error = await rejection(client.get('/trips/t1/itinerary'));

    expect(isAxiosError(error)).toBe(true);
    if (!isAxiosError(error)) return;
    expect(error.response?.status).toBe(500);
    expect(error.response?.data).toEqual({
      error: expect.objectContaining({ code: 'INTERNAL' }),
    });
    expect(realAdapter).not.toHaveBeenCalled();
  });

  it('쓰기 요청(POST)은 같은 경로 규칙이 있어도 진짜 adapter 로 간다', async () => {
    const { client, realAdapter } = setup([{ path: '/**', status: 500 }]);

    const response = await client.post('/trips/t1/itinerary', {});

    expect(response.status).toBe(200);
    expect(realAdapter).toHaveBeenCalledTimes(1);
  });

  it('규칙에 안 맞는 GET 과, 규칙을 비운 뒤의 GET 은 진짜 adapter 로 간다', async () => {
    const { client, realAdapter, setRules } = setup([
      { path: '/stays/search', status: 503 },
    ]);

    await client.get('/trips/t1');
    expect(realAdapter).toHaveBeenCalledTimes(1);

    setRules([]);
    const response = await client.get('/stays/search');

    expect(response.status).toBe(200);
    expect(realAdapter).toHaveBeenCalledTimes(2);
  });

  it('지연 규칙은 그 시간 동안 붙잡았다가 진짜 adapter 로 보낸다', async () => {
    jest.useFakeTimers();
    const { client, realAdapter } = setup([{ path: '/trips', delayMs: 5000 }]);

    const pending = client.get('/trips');
    await jest.advanceTimersByTimeAsync(4999);
    expect(realAdapter).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(realAdapter).toHaveBeenCalledTimes(1);
  });

  it('지연+상태 규칙은 기다린 뒤 실패한다', async () => {
    jest.useFakeTimers();
    const { client, realAdapter } = setup([
      { path: '/trips', delayMs: 100, status: 404 },
    ]);

    const outcome = rejection(client.get('/trips'));
    await jest.advanceTimersByTimeAsync(100);
    const error = await outcome;

    expect(isAxiosError(error) && error.response?.status).toBe(404);
    expect(realAdapter).not.toHaveBeenCalled();
  });

  it('저장소를 다 읽기 전에 나간 GET 도 읽고 난 규칙으로 판정한다', async () => {
    const { client, realAdapter, setRules, setReady } = setup([]);
    let finishHydrate: () => void = () => undefined;
    setReady(
      new Promise<void>((resolve) => {
        finishHydrate = () => {
          setRules([{ path: '/bootstrap', status: 500 }]);
          resolve();
        };
      })
    );

    const outcome = rejection(client.get('/bootstrap'));
    finishHydrate();
    const error = await outcome;

    expect(isAxiosError(error) && error.response?.status).toBe(500);
    expect(realAdapter).not.toHaveBeenCalled();
  });
});
