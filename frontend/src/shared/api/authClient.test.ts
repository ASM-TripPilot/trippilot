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
