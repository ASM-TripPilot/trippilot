import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { authedClient, createAuthedApiClient } from '.';
import { customInstance } from './mutator';

// axios 인스턴스를 만드는 설정을 받아 적는다 — 무인증 baseClient 는 모듈 안 인스턴스라 바꿔 끼울 수 없어,
// 만들어지는 순간의 설정(timeout)을 여기서 본다. 실물 create 를 그대로 부르므로 다른 테스트 동작은 같다.
// 기록 배열은 팩토리 안에 둔다 — import 가 테스트 파일 본문보다 먼저 평가돼 바깥 변수는 아직 없다.
type CreateConfig = { baseURL?: string; timeout?: number };
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  const createConfigs: CreateConfig[] = [];
  return {
    ...actual,
    createConfigs,
    create: (config: CreateConfig) => {
      createConfigs.push(config);
      return actual.create(config);
    },
  };
});

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

/**
 * TRIP-935 — 요청 timeout. 서버가 포트만 잡고 답을 안 주면 timeout 이 없을 때 요청이 끝나지 않아
 * 화면이 스켈레톤에 갇혔다. 반대로 서버가 AI 를 동기로 부르는 요청을 같은 값으로 자르면 서버는 일을
 * 끝냈는데 화면만 실패로 읽는다 — 그래서 "전역 상한 + AI 요청 예외" 두 쪽을 함께 잰다.
 *
 * *(개념)* timeout — 응답을 기다리는 최대 시간(ms). 넘으면 axios 가 `ECONNABORTED` 코드로 요청을
 *   거부한다. 0 은 "상한 없음"이다. 실제 시계는 axios 의 기본 adapter 가 재므로, 여기서는 adapter 가
 *   **받은 설정값**(`config.timeout`)을 본다.
 */
describe('createAuthedApiClient — timeout (TRIP-935)', () => {
  it('요청마다 15초 상한을 싣고, 시간 초과(ECONNABORTED)는 리프레시를 타지 않고 그대로 거부된다', async () => {
    // 준비 — 응답 대신 "시간 초과" 오류를 내는 adapter(응답이 없으니 401 이 아니다)
    const seenTimeouts: (number | undefined)[] = [];
    const adapter: AxiosAdapter = async (config) => {
      seenTimeouts.push(config.timeout);
      throw new AxiosError(
        'timeout of 15000ms exceeded',
        'ECONNABORTED',
        config
      );
    };
    const refreshTokens = jest.fn(async () => 'fresh');
    const onSessionExpired = jest.fn();
    const client = createAuthedApiClient({
      baseURL: 'http://test',
      adapter,
      getAccessToken: () => 'token',
      refreshTokens,
      onSessionExpired,
    });

    // 실행 + 단언 — 네트워크 오류와 같은 길: 오류가 그대로 올라오고 세션은 건드리지 않는다
    await expect(client.get('/trips')).rejects.toMatchObject({
      code: 'ECONNABORTED',
    });
    expect(seenTimeouts).toEqual([15_000]);
    expect(refreshTokens).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });
});

describe('api 모듈이 만드는 인스턴스 — 인증·무인증 둘 다 15초 (TRIP-935)', () => {
  it('authedClient·baseClient 모두 15초 상한으로 만들어진다 — 토큰 갱신(baseClient)이 매달려도 끝난다', () => {
    // 준비·실행은 모듈 로드(파일 맨 위 import)가 이미 했다 — 앱 주소(/api/v1)로 만든 인스턴스만 고른다.
    const { createConfigs } = jest.requireMock<{
      createConfigs: CreateConfig[];
    }>('axios');
    const appClients = createConfigs.filter((config) =>
      config.baseURL?.endsWith('/api/v1')
    );

    // 단언 — 두 벌(인증 authedClient · 무인증 baseClient)이고, 둘 다 15초다. baseClient 가 빠지면
    // 401 → 리프레시 대기 중인 원 요청이 갱신 응답을 영원히 기다린다(authedClient 의 timeout 은 아직 출발 전).
    expect(appClients).toHaveLength(2);
    expect(appClients.map((config) => config.timeout)).toEqual([
      15_000, 15_000,
    ]);
  });
});

describe('customInstance — AI 를 동기로 부르는 요청만 상한을 풀어 준다 (TRIP-935)', () => {
  // 실제 authedClient(생성 클라이언트가 타는 그 인스턴스)의 adapter 만 바꿔, 나가는 설정을 받아 적는다.
  const originalAdapter = authedClient.defaults.adapter;
  let seen: InternalAxiosRequestConfig[] = [];

  beforeEach(() => {
    seen = [];
    authedClient.defaults.adapter = async (config) => {
      seen.push(config);
      return okResponse(config);
    };
  });
  afterEach(() => {
    authedClient.defaults.adapter = originalAdapter;
  });

  it('일반 조회·저장은 전역 15초 상한을 탄다(일정 폴링 GET 포함)', async () => {
    await customInstance({ url: '/trips', method: 'GET' });
    await customInstance({ url: '/trips/t1/itinerary', method: 'GET' });
    await customInstance({ url: '/me/consents', method: 'POST' });
    // 접두가 같은 비-AI POST(일정 확정)가 예외로 새지 않는다 — 정규식 끝 `$` 가 이것을 막는다.
    await customInstance({
      url: '/trips/t1/itinerary/confirm',
      method: 'POST',
    });

    expect(seen.map((config) => config.timeout)).toEqual([
      15_000, 15_000, 15_000, 15_000,
    ]);
  });

  it('일정 생성·편집 재검증·되돌리기·슬롯 후보·회고 생성·회고 수정은 상한 없음(0) — 서버의 AI 상한(최대 612초)이 끊는다', async () => {
    await customInstance({ url: '/trips/t1/itinerary', method: 'POST' });
    await customInstance({ url: '/trips/t1/itinerary', method: 'PUT' });
    await customInstance({
      url: '/trips/t1/itinerary/revisions/r1/restore',
      method: 'POST',
    });
    await customInstance({
      url: '/trips/t1/itinerary/slot-candidates',
      method: 'POST',
    });
    await customInstance({
      url: '/trips/t1/reflections/2026-10-01',
      method: 'POST',
    });
    // 회고 수정 — 그날 회고가 아직 없으면 서버가 AI 초안부터 만든다(15초에 끊으면 "저장 실패"인데 저장됨).
    await customInstance({
      url: '/trips/t1/reflections/2026-10-01',
      method: 'PUT',
    });

    expect(seen.map((config) => config.timeout)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
