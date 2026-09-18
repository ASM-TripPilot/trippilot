import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

import { createAuthedApiClient } from '.';

function readAuth(config: InternalAxiosRequestConfig): string | undefined {
  const headers = config.headers as unknown as {
    Authorization?: string;
    get?: (name: string) => string | undefined;
  };
  if (typeof headers?.get === 'function') {
    return headers.get('Authorization');
  }
  return headers?.Authorization;
}

function okResponse(config: InternalAxiosRequestConfig): AxiosResponse {
  return {
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

function unauthorized(config: InternalAxiosRequestConfig): never {
  const response = {
    data: { error: { code: 'UNAUTHORIZED' } },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  } as AxiosResponse;
  throw Object.assign(new Error('Request failed with status code 401'), {
    isAxiosError: true,
    config,
    response,
  });
}

describe('createAuthedApiClient — 401 single-flight 리프레시 (AC-ONB-01-9)', () => {
  it('동시 다발 401 에서도 리프레시는 정확히 1회만 실행되고 대기 요청이 모두 재시도된다', async () => {
    let currentToken = 'stale';
    let releaseRefresh: (token: string) => void = () => {};
    const refreshGate = new Promise<string>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshTokens = jest.fn(() =>
      refreshGate.then((token) => {
        currentToken = token;
        return token;
      })
    );
    const onSessionExpired = jest.fn();

    const adapter: AxiosAdapter = async (config) =>
      readAuth(config) === 'Bearer fresh'
        ? okResponse(config)
        : unauthorized(config);

    const client = createAuthedApiClient({
      baseURL: 'http://test',
      adapter,
      getAccessToken: () => currentToken,
      refreshTokens,
      onSessionExpired,
    });

    const inflight = Array.from({ length: 5 }, () => client.get('/protected'));

    // 모든 요청이 401 을 받고 리프레시 대기 큐에 들어갈 시간을 준다.
    await new Promise((resolve) => setImmediate(resolve));
    expect(refreshTokens).toHaveBeenCalledTimes(1);

    releaseRefresh('fresh');
    const results = await Promise.all(inflight);

    results.forEach((res: AxiosResponse) =>
      expect(res.data).toEqual({ ok: true })
    );
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('createAuthedApiClient — 리프레시 실패 처리 (AC-ONB-01-10)', () => {
  it('리프레시가 401(무효·만료·회전 재사용)로 실패하면 onSessionExpired(토큰삭제·로그인 라우팅)를 부르고 요청을 거부한다', async () => {
    const refreshTokens = jest.fn(async () => {
      throw Object.assign(new Error('refresh rejected'), { status: 401 });
    });
    const onSessionExpired = jest.fn();

    const adapter: AxiosAdapter = async (config) => unauthorized(config);

    const client = createAuthedApiClient({
      baseURL: 'http://test',
      adapter,
      getAccessToken: () => 'stale',
      refreshTokens,
      onSessionExpired,
    });

    await expect(client.get('/protected')).rejects.toBeTruthy();

    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('createAuthedApiClient — 재시도 상한 (A4 · BR-U0-07/08)', () => {
  it('401 요청은 요청당 1회만 재시도하고, 재시도가 또 401이면 두 번째 리프레시·토큰 파기 없이 거부한다', async () => {
    // 준비 — 어댑터는 항상 401 을 던진다. adapterCalls > 5 는 재시도 상한이 안 걸렸을 때의
    // 무한 루프를 즉시 끊는 폭주 방지 계수기다(정상 흐름에서는 절대 5를 넘지 않는다).
    let adapterCalls = 0;
    const adapter: AxiosAdapter = async (config) => {
      adapterCalls += 1;
      if (adapterCalls > 5) {
        throw new Error(`재시도 폭주: 어댑터가 ${adapterCalls}회 불렸다`);
      }
      return unauthorized(config);
    };
    const refreshTokens = jest.fn(async () => 'fresh');
    const onSessionExpired = jest.fn();

    const client = createAuthedApiClient({
      baseURL: 'http://test',
      adapter,
      getAccessToken: () => 'stale',
      refreshTokens,
      onSessionExpired,
    });

    // 실행 — 재시도까지 포함해 최종적으로 거부된다(재-401).
    await expect(client.get('/protected')).rejects.toHaveProperty(
      'response.status',
      401
    );

    // 단언 — 원 요청 1 + 재시도 1 = 정확히 2. 두 번째 리프레시도, 토큰 파기도 없다.
    expect(adapterCalls).toBe(2);
    expect(refreshTokens).toHaveBeenCalledTimes(1);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('createAuthedApiClient — 리프레시 슬롯 해제 (A6 · BR-U0-07/08)', () => {
  it('리프레시 성공 후 슬롯이 풀려, 나중에 다시 401이 나면 리프레시가 또 한 번 실행된다', async () => {
    // 준비 — 대본 어댑터: 요청 내용이 아니라 "몇 번째 호출인가"로만 응답을 정한다.
    const script = ['401', '200', '401', '200'];
    let step = 0;
    const adapter: AxiosAdapter = async (config) =>
      script[step++] === '401' ? unauthorized(config) : okResponse(config);
    const refreshTokens = jest.fn(async () => 'fresh');
    const onSessionExpired = jest.fn();

    const client = createAuthedApiClient({
      baseURL: 'http://test',
      adapter,
      getAccessToken: () => 'stale',
      refreshTokens,
      onSessionExpired,
    });

    // 실행 — 두 요청을 순차로(동시가 아니다) 보낸다.
    const first = await client.get('/protected');
    const second = await client.get('/protected');

    // 단언 — 두 라운드 모두 재시도로 성공했고, 대본을 다 썼고(4왕복), 리프레시가 라운드마다
    // 새로 실행됐다(=2). 슬롯을 안 비우면 2라운드가 옛 프라미스를 재사용해 1이 되어 실패한다.
    expect(first.data).toEqual({ ok: true });
    expect(second.data).toEqual({ ok: true });
    expect(step).toBe(4);
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('리프레시 실패 후에도 슬롯이 풀려, 이후 새 401이 리프레시를 다시 시도한다', async () => {
    // 준비 — 어댑터는 항상 401(폭주 계수기 불필요: 리프레시가 실패해 재시도 자체가 없다).
    const adapter: AxiosAdapter = async (config) => unauthorized(config);
    const refreshTokens = jest.fn(async () => {
      throw new Error('refresh rejected');
    });
    const onSessionExpired = jest.fn();

    const client = createAuthedApiClient({
      baseURL: 'http://test',
      adapter,
      getAccessToken: () => 'stale',
      refreshTokens,
      onSessionExpired,
    });

    // 실행 — 서로 다른 경로로 순차 2회(각각 독립 요청임을 눈으로 보이게).
    await expect(client.get('/first')).rejects.toBeTruthy();
    await expect(client.get('/second')).rejects.toBeTruthy();

    // 단언 — 실패 프라미스를 슬롯에 붙들고 있으면 두 번째 리프레시가 1로 줄어 실패한다.
    // onSessionExpired 는 요청 1개당 1회(순차 시나리오라 횟수 단언이 허용된다).
    expect(refreshTokens).toHaveBeenCalledTimes(2);
    expect(onSessionExpired).toHaveBeenCalledTimes(2);
  });
});
