import {
  CancelledError,
  MutationObserver,
  onlineManager,
  type QueryClient,
} from '@tanstack/react-query';
import { AxiosError, CanceledError } from 'axios';
import * as Sentry from '@sentry/react-native';

import { retryUnlessNotFound } from '@/shared/api';
import * as account from '@/shared/api/generated/account/account';
import * as location from '@/shared/api/generated/location/location';
import * as notification from '@/shared/api/generated/notification/notification';
import * as notifications from '@/shared/api/generated/notifications/notifications';
import * as places from '@/shared/api/generated/places/places';
import * as preferences from '@/shared/api/generated/preferences/preferences';
import * as profile from '@/shared/api/generated/profile/profile';
import * as reflection from '@/shared/api/generated/reflection/reflection';
import * as replan from '@/shared/api/generated/replan/replan';
import * as savedStays from '@/shared/api/generated/saved-stays/saved-stays';
import * as stays from '@/shared/api/generated/stays/stays';
import * as trips from '@/shared/api/generated/trips/trips';
import { createClockSkew } from '@/test-support/queryRender';
import {
  capturedEvents,
  resetSentryReportMock,
} from '@/test-support/sentryReactNativeMock';

import { createAppQueryClient } from './queryClient';
import { createQueryFailureReporter } from './reportQueryFailure';

/**
 * TRIP-1744 · 서버 조회·변경 요청이 재시도까지 끝나고도 실패하면 Sentry 에 breadcrumb(빵부스러기 — 나중에 올라가는 이벤트에 딸려 가는 앞선 기록 한 줄)
 * 과 이벤트(이슈 한 건)를 남긴다. 이 파일은 그 보고 장치(`createQueryFailureReporter`)를 **실제 `createAppQueryClient` 에 꽂아** 진짜 실패를 일으켜 본다.
 *
 * 무엇을 보장하나
 *  - 재시도가 다 끝난 "최종 실패" 한 번에 breadcrumb 1건, 5xx·네트워크·코드 버그만 이벤트 1건(4xx 는 breadcrumb 만). 재시도 도중·취소·성공은 0건.
 *  - 싣는 값은 허용 목록뿐이다 — 키 템플릿(id 가 `:id` 로 가려짐)·상태·시도 횟수 등. 본문·토큰·좌표·변수는 어떤 입력으로도 못 들어간다.
 *  - 같은 지문(= 같은 API·같은 상태)의 이벤트는 5분에 1건, breadcrumb 은 매번.
 *  - 보고가 실패(Sentry 가 던짐)해도 쿼리 상태·reject 값·재시도 횟수·화면 onError 는 보고가 없을 때와 같다.
 * 커버하지 않는 것: 실제 이벤트가 Sentry 서버에서 어떻게 묶이고 스크럽되는지(6-b), 앱 조립 배선(AppProviders.test·.noDsn.test).
 * 3동작: 준비(주입한 클라이언트·가짜 시계) → 실행(진짜 실패 일으키기) → 단언(Sentry 대역이 받은 것).
 */

jest.mock('@sentry/react-native', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/sentryReactNativeMock')
);
jest.mock('@/shared/storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/test-support/storageMock')
);

const addBreadcrumb = Sentry.addBreadcrumb as unknown as jest.Mock;
const captureException = Sentry.captureException as unknown as jest.Mock;
const withScope = Sentry.withScope as unknown as jest.Mock;

// 모듈 싱글턴(Sentry 대역의 기록·onlineManager·Date.now 스파이)은 파일 최상위에서 비운다 — describe 안에만 걸면 앞 테스트 상태가 샌다.
let skew: { advance: (ms: number) => void; restore: () => void } | null = null;
beforeEach(() => {
  resetSentryReportMock();
});
afterEach(() => {
  resetSentryReportMock();
  onlineManager.setOnline(true);
  skew?.restore();
  skew = null;
});

// ── 재료 ──────────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000;
const FIVE_MIN = 5 * 60 * 1000;

/** 손으로 흘리는 시계 — 5분 경계를 실제 시간에 기대지 않고 정확히 앞뒤로 잰다. */
function makeClock() {
  let t = T0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function reportingClient(clock = makeClock()): {
  client: QueryClient;
  clock: ReturnType<typeof makeClock>;
} {
  const client = createAppQueryClient(
    createQueryFailureReporter({ now: clock.now })
  );
  return { client, clock };
}

function httpError(
  status: number,
  body: unknown = {},
  config: Record<string, unknown> = {}
): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: body,
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  Object.assign(error, { config });
  return error;
}

function networkError(code = 'ERR_NETWORK'): AxiosError {
  return new AxiosError('Network Error', code);
}

type FetchExtra = Record<string, unknown>;

/** 조회를 일으켜 실패시키고 queryFn 이 불린 횟수를 돌려준다. 재시도 대기만 0 으로 줄이고 retry 규칙은 앱 기본(`retryUnlessNotFound`) 그대로다. */
async function failQuery(
  client: QueryClient,
  queryKey: readonly unknown[],
  error: unknown,
  extra: FetchExtra = {}
): Promise<number> {
  let calls = 0;
  await client
    .fetchQuery({
      queryKey,
      retryDelay: 0,
      queryFn: async () => {
        calls += 1;
        throw error;
      },
      ...extra,
    })
    .catch(() => undefined);
  return calls;
}

/** 변경 요청을 일으켜 실패시키고 mutationFn 이 불린 횟수를 돌려준다. */
async function failMutation(
  client: QueryClient,
  error: unknown,
  options: {
    mutationKey?: readonly unknown[];
    retry?: number;
    variables?: unknown;
    networkMode?: 'always';
    onError?: (error: unknown, variables: unknown) => void;
  } = {}
): Promise<number> {
  let calls = 0;
  const observer = new MutationObserver(client, {
    ...(options.mutationKey ? { mutationKey: options.mutationKey } : {}),
    ...(options.retry !== undefined ? { retry: options.retry } : {}),
    retryDelay: 0,
    ...(options.networkMode ? { networkMode: options.networkMode } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    mutationFn: async () => {
      calls += 1;
      throw error;
    },
  });
  await observer.mutate(options.variables).catch(() => undefined);
  return calls;
}

type SentBreadcrumb = {
  category?: string;
  level?: string;
  message?: string;
  data: Record<string, unknown>;
};
const crumbs = (): SentBreadcrumb[] =>
  addBreadcrumb.mock.calls.map((call) => call[0] as SentBreadcrumb);

/** 순환 참조에도 터지지 않는 직렬화 — 보낸 것 전부를 한 문자열로 만들어 "이 값이 어디에도 없다"를 본다. */
function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
    }
    return v;
  });
}
function describeError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    own: Object.fromEntries(
      Object.getOwnPropertyNames(error)
        .filter((k) => k !== 'stack')
        .map((k) => [k, (error as unknown as Record<string, unknown>)[k]])
    ),
    cause: (error as { cause?: unknown }).cause,
  };
}
/** Sentry 대역이 받은 모든 것(breadcrumb 인자·withScope 로 만든 이벤트의 오류·지문·태그·extras). */
function everythingSent(): string {
  return safeJson({
    crumbs: addBreadcrumb.mock.calls,
    events: capturedEvents().map((e) => ({
      ...e,
      error: describeError(e.error),
    })),
  });
}

const TRIP_UUID = '3f2a9c1e-7b4d-4e8a-9f61-2d5c8e0a1b7c';
const ITINERARY_KEY = [`/trips/${TRIP_UUID}/itinerary`] as const;
const ITINERARY_TEMPLATE = '/trips/:id/itinerary';

// ── 최종 실패 한 번이 한 번만 보고된다 ─────────────────────────────────

describe('조회 최종 실패 — 5xx', () => {
  it('500 은 재시도 3번까지 해 요청 4번 뒤에야 breadcrumb 1건 + 이벤트 1건이다 (재시도 도중엔 0건, breadcrumb 이 이벤트보다 먼저)', async () => {
    const { client } = reportingClient();
    const sentAtEachAttempt: number[] = [];
    let calls = 0;

    await client
      .fetchQuery({
        queryKey: ITINERARY_KEY,
        retryDelay: 0,
        queryFn: async () => {
          calls += 1;
          sentAtEachAttempt.push(
            addBreadcrumb.mock.calls.length + capturedEvents().length
          );
          throw httpError(500);
        },
      })
      .catch(() => undefined);

    expect(calls).toBe(4);
    expect(sentAtEachAttempt).toEqual([0, 0, 0, 0]);
    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(1);
    // 같은 실패의 breadcrumb 이 그 이벤트에 딸려 가려면 이벤트보다 먼저 쌓여야 한다.
    expect(addBreadcrumb.mock.invocationCallOrder[0]).toBeLessThan(
      captureException.mock.invocationCallOrder[0]
    );
  });

  it('재시도 끝에 성공하면 아무것도 보고하지 않는다 (같은 클라이언트의 뒤이은 진짜 실패는 보고한다)', async () => {
    const { client } = reportingClient();
    let calls = 0;
    const value = await client.fetchQuery({
      queryKey: ['/trips/t-ok/itinerary'],
      retryDelay: 0,
      queryFn: async () => {
        calls += 1;
        if (calls < 3) throw httpError(500);
        return { ok: true };
      },
    });
    expect(value).toEqual({ ok: true });
    expect(crumbs()).toHaveLength(0);
    expect(capturedEvents()).toHaveLength(0);

    await failQuery(client, ['/me/settings'], httpError(500));
    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(1);
  });

  it('breadcrumb 은 허용 목록의 값만 정확히 싣는다 (분류·키 템플릿·상태·시도 횟수·처음 로드 여부·서버 코드·추적 id)', async () => {
    const { client } = reportingClient();
    await failQuery(
      client,
      ITINERARY_KEY,
      httpError(500, { error: { code: 'INTERNAL', traceId: 'trace-abc-123' } })
    );

    const [crumb] = crumbs();
    expect(crumb).toMatchObject({
      category: 'query-failure',
      level: 'error',
      message: `GET ${ITINERARY_TEMPLATE} → 500`,
    });
    expect(crumb.data).toEqual({
      kind: 'query',
      key: ITINERARY_TEMPLATE,
      status: 500,
      attempts: 4,
      hadData: false,
      serverCode: 'INTERNAL',
      traceId: 'trace-abc-123',
    });
  });

  it('이벤트는 합성 오류(제목에서 API·상태가 읽힘)에 지문·태그를 scope 로 건다 — 원본 오류를 그대로 올리지 않는다', async () => {
    const { client } = reportingClient();
    const original = httpError(500);
    await failQuery(client, ITINERARY_KEY, original);

    expect(withScope).toHaveBeenCalledTimes(1);
    const [event] = capturedEvents();
    expect(event.error).toBeInstanceOf(Error);
    expect(event.error).not.toBe(original);
    expect(event.error).toMatchObject({
      name: 'QueryFailure',
      message: `GET ${ITINERARY_TEMPLATE} → 500`,
    });
    expect(event.fingerprint).toEqual([
      'query-failure',
      ITINERARY_TEMPLATE,
      '500',
    ]);
    // Sentry 태그 값은 문자열이다.
    expect(event.tags).toMatchObject({
      'failure.kind': 'query',
      'http.status': '500',
      'failure.key': ITINERARY_TEMPLATE,
    });
  });

  it.each([502, 503, 504])('%i 도 이벤트다', async (status) => {
    const { client } = reportingClient();
    await failQuery(client, ['/me/settings'], httpError(status));
    expect(capturedEvents()).toHaveLength(1);
    expect(capturedEvents()[0].fingerprint?.[2]).toBe(String(status));
  });
});

describe('조회 최종 실패 — 4xx 는 breadcrumb 만', () => {
  it.each([400, 401, 403, 404, 409, 422, 429])(
    '%i 는 breadcrumb 1건(경고)만 남기고 이벤트는 0건이다 — 시도 횟수는 실제 요청 수와 같다',
    async (status) => {
      const { client } = reportingClient();
      const calls = await failQuery(
        client,
        ['/me/settings'],
        httpError(status)
      );

      expect(crumbs()).toHaveLength(1);
      expect(crumbs()[0]).toMatchObject({ level: 'warning' });
      expect(crumbs()[0].data).toMatchObject({
        status,
        attempts: calls,
        kind: 'query',
      });
      expect(capturedEvents()).toHaveLength(0);
    }
  );

  it('404 는 재시도하지 않으므로 시도 1번으로 센다 (앱 retry 규칙 그대로)', async () => {
    const { client } = reportingClient();
    const calls = await failQuery(client, ['/me/settings'], httpError(404));
    expect(calls).toBe(1);
    expect(crumbs()[0].data.attempts).toBe(1);
  });
});

describe('조회 최종 실패 — 응답이 없는 실패와 코드 버그', () => {
  it.each(['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'])(
    '%s 는 상태 network 로 breadcrumb(오류) + 이벤트 1건이다',
    async (code) => {
      const { client } = reportingClient();
      await failQuery(client, ITINERARY_KEY, networkError(code));

      expect(crumbs()).toHaveLength(1);
      expect(crumbs()[0]).toMatchObject({
        level: 'error',
        message: `GET ${ITINERARY_TEMPLATE} → network`,
      });
      expect(crumbs()[0].data).toMatchObject({ status: 'network' });
      expect(capturedEvents()).toHaveLength(1);
      expect(capturedEvents()[0].fingerprint).toEqual([
        'query-failure',
        ITINERARY_TEMPLATE,
        'network',
      ]);
      expect(capturedEvents()[0].tags).toMatchObject({
        'http.status': 'network',
      });
    }
  );

  it('오프라인(onlineManager)인 동안의 네트워크 실패는 breadcrumb 만(online:false)이고, 이벤트 창을 쓰지 않는다 — 온라인이 된 뒤 같은 실패는 이벤트가 된다', async () => {
    const { client } = reportingClient();
    onlineManager.setOnline(false);
    // 오프라인이면 요청이 아예 안 나가므로(보류) 'always' 로 NetInfo 가 아직 모르는 순간을 흉내 낸다.
    await failQuery(client, ITINERARY_KEY, networkError(), {
      networkMode: 'always',
      retry: false,
    });

    expect(crumbs()).toHaveLength(1);
    expect(crumbs()[0].data).toMatchObject({
      status: 'network',
      online: false,
    });
    expect(capturedEvents()).toHaveLength(0);

    onlineManager.setOnline(true);
    await failQuery(client, ITINERARY_KEY, networkError(), { retry: false });

    expect(crumbs()).toHaveLength(2);
    expect(crumbs()[1].data).not.toHaveProperty('online');
    expect(capturedEvents()).toHaveLength(1);
  });

  it.each<[string, () => unknown]>([
    ['TypeError', () => new TypeError('data is undefined')],
    ['던진 값이 undefined', () => undefined],
    ['던진 값이 문자열', () => 'boom'],
  ])(
    '서버 오류가 아닌 것(%s)은 코드 버그라 상태 client-error 로 breadcrumb(오류) + 이벤트 1건이다',
    async (_name, makeError) => {
      const { client } = reportingClient();
      await failQuery(client, ITINERARY_KEY, makeError());

      expect(crumbs()).toHaveLength(1);
      expect(crumbs()[0]).toMatchObject({
        level: 'error',
        message: `GET ${ITINERARY_TEMPLATE} → client-error`,
      });
      expect(crumbs()[0].data).toMatchObject({ status: 'client-error' });
      expect(capturedEvents()).toHaveLength(1);
      expect(capturedEvents()[0].fingerprint).toEqual([
        'query-failure',
        ITINERARY_TEMPLATE,
        'client-error',
      ]);
    }
  );
});

describe('취소·성공은 보고하지 않는다', () => {
  // 부정 단언은 공허하게 통과하기 쉽다(보고 장치가 아예 안 달려도 0건) — 매번 진짜 실패 하나(앵커)가 먼저 보고되는 것을 확인한 뒤 센다.
  async function anchor(client: QueryClient) {
    await failQuery(client, ['/me/anchor-1744'], httpError(404));
    expect(crumbs()).toHaveLength(1);
  }

  it('요청 취소(axios CanceledError)로 끝난 조회는 breadcrumb·이벤트 0건이다', async () => {
    const { client } = reportingClient();
    await anchor(client);

    await failQuery(client, ITINERARY_KEY, new CanceledError());

    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(0);
  });

  it('화면 이탈·키 변경으로 취소된 조회(cancelQueries → CancelledError)는 0건이다', async () => {
    const { client } = reportingClient();
    await anchor(client);

    const pending = client
      .fetchQuery({
        queryKey: ITINERARY_KEY,
        retry: false,
        queryFn: () => new Promise(() => undefined),
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );
    await client.cancelQueries({ queryKey: ITINERARY_KEY });

    expect(await pending).toBeInstanceOf(CancelledError);
    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(0);
  });

  it('요청 취소로 끝난 변경 요청도 0건이다', async () => {
    const { client } = reportingClient();
    await anchor(client);

    await failMutation(client, new CanceledError(), {
      mutationKey: ['putMePreferences'],
    });

    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(0);
  });
});

// ── 변경 요청 ─────────────────────────────────────────────────────────

describe('변경 요청 최종 실패', () => {
  it('재시도 2번이면 시도 3번(failureCount+1)이고, 라벨은 mutationKey 첫 조각이며, 5xx 라 이벤트도 1건이다', async () => {
    const { client } = reportingClient();
    const calls = await failMutation(client, httpError(500), {
      mutationKey: ['putMePreferences'],
      retry: 2,
    });

    expect(calls).toBe(3);
    expect(crumbs()).toHaveLength(1);
    expect(crumbs()[0]).toMatchObject({
      category: 'query-failure',
      level: 'error',
      message: 'MUTATION putMePreferences → 500',
    });
    expect(crumbs()[0].data).toEqual({
      kind: 'mutation',
      key: 'putMePreferences',
      status: 500,
      attempts: 3,
    });
    expect(capturedEvents()).toHaveLength(1);
    expect(capturedEvents()[0].error).toMatchObject({
      name: 'QueryFailure',
      message: 'MUTATION putMePreferences → 500',
    });
    expect(capturedEvents()[0].fingerprint).toEqual([
      'query-failure',
      'putMePreferences',
      '500',
    ]);
    expect(capturedEvents()[0].tags).toMatchObject({
      'failure.kind': 'mutation',
      'http.status': '500',
      'failure.key': 'putMePreferences',
    });
  });

  it('재시도 없는 기본 변경 요청은 시도 1번이다 (조회와 달리 0 이 아니다)', async () => {
    const { client } = reportingClient();
    await failMutation(client, httpError(500), { mutationKey: ['postTrips'] });
    expect(crumbs()[0].data.attempts).toBe(1);
  });

  it.each([400, 409, 422, 429])(
    '변경 요청의 %i 는 업무 규칙 응답이라 breadcrumb(경고)만이다',
    async (status) => {
      const { client } = reportingClient();
      await failMutation(client, httpError(status), {
        mutationKey: ['postTrips'],
      });
      expect(crumbs()).toHaveLength(1);
      expect(crumbs()[0]).toMatchObject({ level: 'warning' });
      expect(capturedEvents()).toHaveLength(0);
    }
  );

  it('네트워크 실패는 이벤트(오프라인이면 breadcrumb 만)이고, mutationKey 가 없으면 unnamed 다', async () => {
    const { client } = reportingClient();
    await failMutation(client, networkError());
    expect(crumbs()[0].data).toMatchObject({
      kind: 'mutation',
      key: 'unnamed',
      status: 'network',
    });
    expect(capturedEvents()).toHaveLength(1);

    onlineManager.setOnline(false);
    resetSentryReportMock();
    const offline = reportingClient();
    await failMutation(offline.client, networkError(), {
      mutationKey: ['postTrips'],
      networkMode: 'always',
    });
    expect(crumbs()).toHaveLength(1);
    expect(crumbs()[0].data).toMatchObject({ online: false });
    expect(capturedEvents()).toHaveLength(0);
  });
});

// ── 값의 모양(허용 목록) ──────────────────────────────────────────────

describe('breadcrumb 의 값', () => {
  it('이미 데이터가 있는 채로 백그라운드 재조회가 실패하면 hadData:true, 처음 로드 실패는 false 다', async () => {
    const { client } = reportingClient();
    const key = ['/me/settings'];
    client.setQueryData(key, { cached: true });

    await failQuery(client, key, httpError(404), { staleTime: 0 });
    await failQuery(client, ['/me/profile'], httpError(404));

    expect(crumbs()[0].data.hadData).toBe(true);
    expect(crumbs()[1].data.hadData).toBe(false);
  });

  it('싣는 키는 허용 목록 안이다 (서버 코드·추적 id 가 있는 실패, 오프라인 네트워크 실패 모두)', async () => {
    const { client } = reportingClient();
    await failQuery(
      client,
      ITINERARY_KEY,
      httpError(500, { error: { code: 'INTERNAL', traceId: 'trace-1' } })
    );
    onlineManager.setOnline(false);
    await failQuery(client, ['/me/settings'], networkError(), {
      networkMode: 'always',
      retry: false,
    });

    const allowed = new Set([
      'kind',
      'key',
      'status',
      'attempts',
      'hadData',
      'serverCode',
      'traceId',
      'online',
    ]);
    const extra = crumbs().flatMap((c) =>
      Object.keys(c.data).filter((k) => !allowed.has(k))
    );
    expect(crumbs()).toHaveLength(2);
    expect(extra).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['공백이 있는 값', 'has space'],
    ['65자(한도 초과)', 'x'.repeat(65)],
    ['빈 문자열', ''],
    ['숫자', 123],
    ['객체', { Authorization: 'Bearer nope' }],
    ['슬래시가 섞인 값', 'a/b'],
    ['한글', '내부오류'],
  ])(
    '서버 코드·추적 id 모양이 의심스러우면(%s) 싣지 않는다 (fail-closed)',
    async (_name, bad) => {
      const { client } = reportingClient();
      await failQuery(
        client,
        ITINERARY_KEY,
        httpError(500, { error: { code: bad, traceId: bad } })
      );
      expect(crumbs()).toHaveLength(1);
      expect(crumbs()[0].data).not.toHaveProperty('serverCode');
      expect(crumbs()[0].data).not.toHaveProperty('traceId');
    }
  );

  it.each<[string, unknown]>([
    ['본문이 문자열(HTML 오류 페이지)', '<html>502</html>'],
    ['본문이 null', null],
    ['오류 봉투가 없는 객체', { message: 'x' }],
  ])(
    '응답 본문이 예상 모양이 아니어도(%s) 터지지 않고 서버 코드·추적 id 없이 보고한다',
    async (_name, body) => {
      const { client } = reportingClient();
      await failQuery(client, ITINERARY_KEY, httpError(500, body));
      expect(crumbs()).toHaveLength(1);
      expect(crumbs()[0].data).not.toHaveProperty('serverCode');
    }
  );
});

describe('같은 실패끼리 묶이고 다른 실패는 갈라진다 (지문)', () => {
  it('같은 API·같은 상태는 여행 id 가 달라도 같은 지문이다', async () => {
    const a = reportingClient();
    const b = reportingClient();
    await failQuery(a.client, ['/trips/aaaa-1111/itinerary'], httpError(500));
    await failQuery(b.client, ['/trips/bbbb-2222/itinerary'], httpError(500));

    expect(capturedEvents()).toHaveLength(2);
    expect(capturedEvents()[0].fingerprint).toEqual(
      capturedEvents()[1].fingerprint
    );
  });

  it('다른 상태·다른 API 는 다른 지문이다', async () => {
    const { client } = reportingClient();
    await failQuery(client, ITINERARY_KEY, httpError(500));
    await failQuery(client, ITINERARY_KEY, httpError(503));
    await failQuery(client, [`/trips/${TRIP_UUID}/routes`], httpError(500));

    const prints = capturedEvents().map((e) => safeJson(e.fingerprint));
    expect(prints).toHaveLength(3);
    expect(new Set(prints).size).toBe(3);
  });
});

// ── 이벤트 폭주 제한 ──────────────────────────────────────────────────

describe('같은 지문 이벤트는 5분에 1건, breadcrumb 은 매번', () => {
  it('5분 창 안의 같은 실패는 breadcrumb 만 쌓이고, 창이 열리는 정각(300000ms)에 이벤트가 다시 나간다 — 그때부터 새 창이다', async () => {
    const { client, clock } = reportingClient();
    const fail = () =>
      failQuery(client, [`/trips/${TRIP_UUID}/itinerary`], httpError(500));

    await fail(); // t = 0
    expect(capturedEvents()).toHaveLength(1);

    clock.advance(10_000);
    await fail(); // 다른 여행이어도 템플릿이 같으면 같은 지문
    expect(capturedEvents()).toHaveLength(1);
    expect(crumbs()).toHaveLength(2);

    clock.advance(FIVE_MIN - 10_000 - 1); // t = 299_999
    await fail();
    expect(capturedEvents()).toHaveLength(1);
    expect(crumbs()).toHaveLength(3);

    clock.advance(1); // t = 300_000
    await fail();
    expect(capturedEvents()).toHaveLength(2);
    expect(crumbs()).toHaveLength(4);

    clock.advance(FIVE_MIN - 1); // 새 창 안
    await fail();
    expect(capturedEvents()).toHaveLength(2);

    clock.advance(1);
    await fail();
    expect(capturedEvents()).toHaveLength(3);
  });

  it('지문이 다르면(다른 상태·다른 API) 같은 창 안에서도 따로 나간다', async () => {
    const { client } = reportingClient();
    await failQuery(client, ITINERARY_KEY, httpError(500));
    await failQuery(client, ITINERARY_KEY, httpError(503));
    await failQuery(client, [`/trips/${TRIP_UUID}/routes`], httpError(500));
    await failQuery(client, ITINERARY_KEY, networkError());

    expect(capturedEvents()).toHaveLength(4);
  });

  it('코드 버그(client-error)·변경 요청도 같은 규칙을 따른다', async () => {
    const { client, clock } = reportingClient();
    await failQuery(client, ITINERARY_KEY, new TypeError('a'));
    await failQuery(client, ITINERARY_KEY, new TypeError('b'));
    await failMutation(client, httpError(500), { mutationKey: ['postTrips'] });
    await failMutation(client, httpError(500), { mutationKey: ['postTrips'] });
    expect(capturedEvents()).toHaveLength(2);

    clock.advance(FIVE_MIN);
    await failQuery(client, ITINERARY_KEY, new TypeError('c'));
    await failMutation(client, httpError(500), { mutationKey: ['postTrips'] });
    expect(capturedEvents()).toHaveLength(4);
  });

  it('시계를 주입하지 않으면 Date.now 를 쓴다 (앱이 인자 없이 만들어도 창이 동작한다)', async () => {
    skew = createClockSkew();
    const client = createAppQueryClient(createQueryFailureReporter());

    await failQuery(client, ITINERARY_KEY, httpError(500));
    await failQuery(client, ITINERARY_KEY, httpError(500));
    expect(capturedEvents()).toHaveLength(1);

    skew.advance(FIVE_MIN + 1000);
    await failQuery(client, ITINERARY_KEY, httpError(500));
    expect(capturedEvents()).toHaveLength(2);
  });
});

// ── 금지: 민감한 값은 어떤 입력으로도 못 들어간다 ───────────────────────

describe('보내지 않는 것', () => {
  const SECRETS = [
    'SECRET_BEARER_TOKEN_VALUE',
    'SECRET_QUERY_TOKEN',
    'hunter2',
    'a.user@example.com',
    '37.5665',
    '126.978',
    'PRIVATE_RESPONSE_MESSAGE',
  ];

  function leakyAxiosError(): AxiosError {
    return httpError(
      500,
      {
        error: {
          code: 'INTERNAL',
          traceId: 'trace-1',
          message: 'PRIVATE_RESPONSE_MESSAGE a.user@example.com',
        },
      },
      {
        url: '/stays/reverse-geocode?lat=37.5665&lng=126.978&access_token=SECRET_QUERY_TOKEN',
        headers: { Authorization: 'Bearer SECRET_BEARER_TOKEN_VALUE' },
        data: JSON.stringify({ password: 'hunter2' }),
        params: { lat: 37.5665, lng: 126.978 },
      }
    );
  }

  function expectNoSecrets() {
    const sent = everythingSent();
    expect(sent.length).toBeGreaterThan(50); // 앵커 — 아무것도 안 보낸 채 통과하지 않게
    for (const secret of SECRETS) expect(sent).not.toContain(secret);
  }

  it('조회: 요청 헤더·본문·URL 쿼리·응답 메시지·키 [1](좌표)이 breadcrumb 에도 이벤트에도 없다', async () => {
    const { client } = reportingClient();
    await failQuery(
      client,
      ['/stays/reverse-geocode', { lat: 37.5665, lng: 126.978 }],
      leakyAxiosError()
    );

    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(1);
    expectNoSecrets();
  });

  it('변경 요청: variables 와 오류 객체의 요청 설정이 어디에도 없다', async () => {
    const { client } = reportingClient();
    await failMutation(client, leakyAxiosError(), {
      mutationKey: ['postStaysReverseGeocode'],
      variables: {
        email: 'a.user@example.com',
        lat: 37.5665,
        lng: 126.978,
        password: 'hunter2',
        token: 'SECRET_BEARER_TOKEN_VALUE',
      },
    });

    expect(crumbs()).toHaveLength(1);
    expect(capturedEvents()).toHaveLength(1);
    expectNoSecrets();
  });

  it('키에 id 가 섞인 조회: 여행 id 가 breadcrumb·이벤트 어디에도 없다', async () => {
    const { client } = reportingClient();
    await failQuery(client, ITINERARY_KEY, httpError(500));
    expect(crumbs()).toHaveLength(1); // 앵커 — 보낸 것이 있어야 "없다"가 의미를 가진다
    expect(capturedEvents()).toHaveLength(1);
    expect(everythingSent()).not.toContain(TRIP_UUID);
  });
});

// ── 키 템플릿 ─────────────────────────────────────────────────────────

/**
 * 키 첫 조각은 경로 문자열인데 id 가 들어 있다(`/trips/<uuid>/itinerary`). 그대로 보내면 이슈가 사용자·여행마다 쪼개지고 id 가 새므로
 * 알려진 리터럴 구간만 남기고 나머지는 전부 `:id` 로 가린다(어휘 허용 목록 — 새 리터럴은 일단 과하게 가려질 뿐 id 는 새지 않는다).
 */
describe('쿼리 키 템플릿', () => {
  // 생성 클라이언트의 모든 GET 키 함수를 모듈에서 열거한다 — 손으로 목록을 적지 않아 새 엔드포인트가 자동으로 편입된다.
  // 모듈 목록 자체는 손으로 적는다(소스 스캔 금지 규칙 — 새 생성 모듈이 생기면 한 줄 추가, 아래 앵커가 빈 열거를 막는다).
  const generatedModules: Record<string, unknown>[] = [
    account,
    location,
    notification,
    notifications,
    places,
    preferences,
    profile,
    reflection,
    replan,
    savedStays,
    stays,
    trips,
  ];
  const keyFunctions: [string, (...args: string[]) => readonly unknown[]][] =
    generatedModules.flatMap((mod) =>
      Object.entries(mod).filter(
        (entry): entry is [string, (...args: string[]) => readonly unknown[]] =>
          /^get.*QueryKey$/.test(entry[0]) && typeof entry[1] === 'function'
      )
    );

  // 모양이 다른 id 들 — uuid · 날짜 · 임의 문자열(stayId 는 형식 불명) · 숫자. 어느 자리에 들어가도 안 보여야 한다.
  const SAMPLES = [
    '9d1b7c2e-5a3f-4b8d-8e6a-0c4f2a7b1d93',
    '2026-11-03',
    'stay_Zk9qXw3Lm',
    '48151623',
  ];

  it('앵커: 열거된 키 함수가 충분히 많고, id 자리가 있는 것도 많다 (정규식·모듈 목록이 어긋나 빈 열거로 통과하지 않게)', () => {
    expect(keyFunctions.length).toBeGreaterThanOrEqual(30); // 2026-11-03 실측 45개
    const withIdSlot = keyFunctions.filter(([, fn]) =>
      String(fn(':id', ':id', ':id', ':id')[0]).includes(':id')
    );
    expect(withIdSlot.length).toBeGreaterThanOrEqual(15);
  });

  it.each(keyFunctions.map(([name]) => name))(
    '%s — 샘플 id 가 템플릿에 0건이고 리터럴 구간은 그대로다',
    async (name) => {
      const fn = keyFunctions.find(([n]) => n === name)![1];
      // 같은 함수에 id 자리마다 ':id' 를 넣은 결과가 곧 "기대 템플릿"이다 — 생성 소스의 리터럴을 그대로 정본으로 삼는다.
      const expected = fn(':id', ':id', ':id', ':id')[0];

      for (const sample of SAMPLES) {
        resetSentryReportMock();
        const { client } = reportingClient();
        // 인자 수를 모르므로 네 자리 모두 같은 샘플을 넣는다(params 자리에 들어간 문자열은 키 [1] 로 남는다 — 그것도 안 새야 한다).
        const key = fn(sample, sample, sample, sample);
        await failQuery(client, key, httpError(404));

        const [crumb] = crumbs();
        expect({ name, sample, key: crumb.data.key }).toEqual({
          name,
          sample,
          key: expected,
        });
        expect(everythingSent()).not.toContain(sample);
      }
    }
  );

  it.each<[string, readonly unknown[], string]>([
    // 손으로 쓴 경로형 키(생성물에 없는 리터럴 `multi`·`consents` 가 어휘에 들어 있어야 한다)
    ['/me/consents', ['/me/consents'], '/me/consents'],
    [
      '/places/multi (지역 배열이 [1])',
      ['/places/multi', ['서울', '부산', '제주'], null, '', null],
      '/places/multi',
    ],
    [
      '역지오코딩 (좌표가 [1])',
      ['/stays/reverse-geocode', { lat: 37.5665, lng: 126.978 }],
      '/stays/reverse-geocode',
    ],
    // 경로가 아닌 키 — [0] 그대로, [1] 은 알려진 3개 낱말(session·messages·sessions)일 때만 덧붙인다
    ['terms (종류는 [1])', ['terms', 'PRIVACY'], 'terms'],
    ['reconsent-targets', ['reconsent-targets'], 'reconsent-targets'],
    ['photo-uri (로컬 사진 id)', ['photo-uri', 'ph://AB12-CD34'], 'photo-uri'],
    [
      'photo-uri — 소문자뿐인 짧은 id 여도 덧붙이지 않는다',
      ['photo-uri', 'localasset'],
      'photo-uri',
    ],
    ['visit-memo', ['visit-memo', TRIP_UUID, 'vc-1'], 'visit-memo'],
    [
      'assistant session',
      ['assistant', 'session', TRIP_UUID],
      'assistant/session',
    ],
    [
      'assistant session(일반)',
      ['assistant', 'session', 'general'],
      'assistant/session',
    ],
    [
      'assistant messages',
      ['assistant', 'messages', 'sess-1'],
      'assistant/messages',
    ],
    ['assistant sessions', ['assistant', 'sessions'], 'assistant/sessions'],
    ['assistant 의 모르는 낱말', ['assistant', 'whatever', 'x'], 'assistant'],
    // fail-closed: 처음 보는 리터럴은 id 로 보고 가린다
    ['처음 보는 경로 리터럴', ['/brand-new-endpoint/3f2a9c1e'], '/:id/:id'],
    // 문자열 경로가 아닌 첫 조각
    ['빈 키', [], 'unknown'],
    ['숫자 첫 조각', [123], 'unknown'],
    ['객체 첫 조각', [{ a: 1 }], 'unknown'],
    ['null 첫 조각', [null], 'unknown'],
  ])('손으로 쓴 키 — %s', async (_name, queryKey, expected) => {
    const { client } = reportingClient();
    await failQuery(client, queryKey, httpError(404));

    expect(crumbs()).toHaveLength(1);
    expect(crumbs()[0].data.key).toBe(expected);
    // 키의 나머지(좌표·지역·id)는 어디에도 실리지 않는다.
    const sent = everythingSent();
    for (const leak of [
      '37.5665',
      '126.978',
      '서울',
      'AB12-CD34',
      'localasset',
      TRIP_UUID,
      'sess-1',
      'PRIVACY',
    ]) {
      expect(sent).not.toContain(leak);
    }
  });
});

// ── 보고가 실패해도 화면 동작은 그대로 ─────────────────────────────────

describe('보고 함수는 던지지 않고, Sentry 가 던져도 앱 동작이 달라지지 않는다', () => {
  const sentryFns = { addBreadcrumb, captureException, withScope };

  it.each(['addBreadcrumb', 'captureException', 'withScope'] as const)(
    '%s 가 던져도 조회는 원래 오류로 reject 되고 상태는 error, 요청은 4번이다',
    async (name) => {
      sentryFns[name].mockImplementation(() => {
        throw new Error('sentry down');
      });
      const { client } = reportingClient();
      const original = httpError(500);
      let calls = 0;

      const rejected = await client
        .fetchQuery({
          queryKey: ITINERARY_KEY,
          retryDelay: 0,
          queryFn: async () => {
            calls += 1;
            throw original;
          },
        })
        .then(
          () => undefined,
          (error: unknown) => error
        );

      expect(sentryFns[name]).toHaveBeenCalled(); // 앵커 — 보고 경로가 실제로 탔다
      expect(rejected).toBe(original);
      expect(calls).toBe(4);
      const state = client.getQueryState(ITINERARY_KEY);
      expect(state?.status).toBe('error');
      expect(state?.error).toBe(original);
      expect(state?.fetchFailureCount).toBe(4);
    }
  );

  it.each(['addBreadcrumb', 'captureException', 'withScope'] as const)(
    '%s 가 던져도 변경 요청의 화면 onError 는 같은 인자로 한 번 불리고, 재시도 횟수·reject 값이 같으며, 처리 안 된 거절이 생기지 않는다',
    async (name) => {
      sentryFns[name].mockImplementation(() => {
        throw new Error('sentry down');
      });
      const { client } = reportingClient();
      const original = httpError(500);
      const screenOnError = jest.fn();
      const variables = { id: 1 };
      let calls = 0;

      const observer = new MutationObserver(client, {
        mutationKey: ['putMePreferences'],
        retry: 2,
        retryDelay: 0,
        onError: screenOnError,
        mutationFn: async () => {
          calls += 1;
          throw original;
        },
      });
      const rejected = await observer.mutate(variables).then(
        () => undefined,
        (error: unknown) => error
      );
      // 처리 안 된 거절(TanStack 이 보고 함수 예외를 삼키며 만드는 것)은 한 틱 뒤에 터진다 — 그 틱까지 기다려 테스트가 잡게 한다.
      await new Promise((resolve) => setImmediate(resolve));

      expect(sentryFns[name]).toHaveBeenCalled();
      expect(rejected).toBe(original);
      expect(calls).toBe(3);
      expect(screenOnError).toHaveBeenCalledTimes(1);
      expect(screenOnError.mock.calls[0][0]).toBe(original);
      expect(screenOnError.mock.calls[0][1]).toBe(variables);
    }
  );

  it('어떤 인자로 직접 불러도 던지지 않는다 (undefined · 순환 객체 · 빈 쿼리 모양)', () => {
    const reporter = createQueryFailureReporter({ now: makeClock().now });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      reporter.onQueryError(undefined, undefined as never)
    ).not.toThrow();
    expect(() => reporter.onQueryError(circular, {} as never)).not.toThrow();
    expect(() =>
      reporter.onQueryError(circular, {
        queryKey: [circular],
        state: { fetchFailureCount: circular, data: circular },
      } as never)
    ).not.toThrow();
    expect(() =>
      reporter.onMutationError(
        undefined,
        undefined,
        undefined,
        undefined as never
      )
    ).not.toThrow();
    expect(() =>
      reporter.onMutationError(circular, circular, circular, {
        options: { mutationKey: [circular] },
        state: { failureCount: circular },
      } as never)
    ).not.toThrow();
  });
});

// ── 클라이언트 팩토리: 주입 자리 ──────────────────────────────────────

describe('createAppQueryClient — 보고 함수 주입', () => {
  it('인자를 안 주면 어떤 실패도 Sentry 로 가지 않고, 주면 간다 (팩토리는 Sentry 를 모른다)', async () => {
    const plain = createAppQueryClient();
    await failQuery(plain, ITINERARY_KEY, httpError(500));
    await failMutation(plain, httpError(500), { mutationKey: ['postTrips'] });
    expect(addBreadcrumb).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();

    const { client } = reportingClient();
    await failQuery(client, ITINERARY_KEY, httpError(500));
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it('주입한 함수는 재시도가 다 끝난 뒤 한 번, 오류와 쿼리·변경 요청 객체를 받는다', async () => {
    const onQueryError = jest.fn();
    const onMutationError = jest.fn();
    const client = createAppQueryClient({ onQueryError, onMutationError });
    const queryError = httpError(500);
    const mutationError = httpError(409);
    const variables = { v: 1 };

    const calls = await failQuery(client, ITINERARY_KEY, queryError);
    await failMutation(client, mutationError, {
      mutationKey: ['postTrips'],
      variables,
    });

    expect(calls).toBe(4);
    expect(onQueryError).toHaveBeenCalledTimes(1);
    expect(onQueryError.mock.calls[0][0]).toBe(queryError);
    expect(onQueryError.mock.calls[0][1].queryKey).toEqual(ITINERARY_KEY);
    expect(onMutationError).toHaveBeenCalledTimes(1);
    expect(onMutationError.mock.calls[0][0]).toBe(mutationError);
    expect(onMutationError.mock.calls[0][1]).toBe(variables);
    expect(onMutationError.mock.calls[0][3].options.mutationKey).toEqual([
      'postTrips',
    ]);
  });

  it('조회 쪽만 주입해도 변경 요청이 평소처럼 실패하고, 반대도 마찬가지다', async () => {
    const onQueryError = jest.fn();
    const onlyQuery = createAppQueryClient({ onQueryError });
    await failQuery(onlyQuery, ITINERARY_KEY, httpError(404));
    await failMutation(onlyQuery, httpError(500));
    expect(onQueryError).toHaveBeenCalledTimes(1); // 조회만 불렸다

    const onMutationError = jest.fn();
    const onlyMutation = createAppQueryClient({ onMutationError });
    await failMutation(onlyMutation, httpError(500));
    await failQuery(onlyMutation, ITINERARY_KEY, httpError(404));
    expect(onMutationError).toHaveBeenCalledTimes(1); // 변경 요청만 불렸다
  });

  it('주입해도 앱 기본 옵션(재시도 규칙·신선 시간·보관 시간·복귀 재조회 정책)은 그대로다', () => {
    const { client } = reportingClient();
    const queries = client.getDefaultOptions().queries;

    expect(queries?.retry).toBe(retryUnlessNotFound);
    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.gcTime).toBe(10 * 60_000);
    const refetchOnFocus = queries?.refetchOnWindowFocus as unknown as (query: {
      queryKey: unknown[];
    }) => boolean;
    expect(refetchOnFocus({ queryKey: ['/me'] })).toBe(false);
    expect(refetchOnFocus({ queryKey: ['/trips'] })).toBe(true);
    expect(client.getDefaultOptions().mutations).toBeUndefined();
  });
});

/**
 * 5-b 보강 (03b B-1 · W-1 · W-2) — 오케 작성.
 * 무엇을 보장하나: ① 코드 버그 이벤트의 오류 이름 태그는 안전한 이름(클래스명)일 때만 싣고 메시지·이상한 이름은 싣지 않는다(B-1)
 *   ② mutationKey 가 없는 변경 요청은 axios 오류의 메서드+경로 템플릿으로 갈라져, 다른 API 의 실패가 한 지문·한 5분 창에 합쳐지지 않는다(W-1)
 *   ③ mutationKey 가 경로 문자열이면 조회와 같은 템플릿을 거쳐 id 가 안 실린다(W-2).
 * 3동작: 준비(실패 오류·키) → 실행(최종 실패) → 단언(태그·라벨·지문·보낸 값 전체에 비밀·id 없음).
 */
describe('5-b 보강 — 오류 이름 태그·변경 요청 라벨', () => {
  const SECRET = 'SECRET-TOKEN-5B1X';
  const TRIP = '7f0c2a4e-1111-4abc-9def-0123456789ab';

  it('B-1 · 코드 버그는 오류 클래스명만 태그로 싣고, 메시지·위험한 이름은 싣지 않는다', async () => {
    const { client } = reportingClient();
    await failQuery(client, ITINERARY_KEY, new TypeError(`token=${SECRET}`));
    expect(capturedEvents()[0].tags['failure.error_name']).toBe('TypeError');

    resetSentryReportMock();
    const weird = new Error('boom');
    weird.name = `Bearer ${SECRET}`;
    const second = reportingClient();
    await failQuery(second.client, ITINERARY_KEY, weird);
    expect(capturedEvents()[0].tags['failure.error_name']).toBe('non-error');

    expect(everythingSent()).not.toContain(SECRET);
  });

  it('W-1 · mutationKey 가 없으면 axios 요청의 메서드+경로 템플릿이 라벨이고, 다른 API 는 다른 지문이다', async () => {
    const { client } = reportingClient();
    await failMutation(
      client,
      httpError(
        500,
        {},
        { method: 'post', url: `/trips/${TRIP}/bases?access_token=${SECRET}` }
      )
    );
    await failMutation(
      client,
      httpError(
        500,
        {},
        {
          method: 'put',
          url: `https://api.example/api/v1/trips/${TRIP}/itinerary`,
        }
      )
    );

    expect(crumbs().map((c) => c.data.key)).toEqual([
      'POST /trips/:id/bases',
      'PUT /trips/:id/itinerary',
    ]);
    expect(capturedEvents()).toHaveLength(2);
    expect(capturedEvents().map((e) => e.fingerprint?.[1])).toEqual([
      'POST /trips/:id/bases',
      'PUT /trips/:id/itinerary',
    ]);
    expect(everythingSent()).not.toContain(TRIP);
    expect(everythingSent()).not.toContain(SECRET);
  });

  it('W-1 · axios 가 아닌 오류로 끝난 이름 없는 변경 요청은 unnamed 다', async () => {
    const { client } = reportingClient();
    await failMutation(client, new TypeError('x'));
    expect(crumbs()[0].data).toMatchObject({
      kind: 'mutation',
      key: 'unnamed',
    });
  });

  it('W-2 · 경로 문자열 mutationKey 도 템플릿을 거쳐 id 가 안 실린다', async () => {
    const { client } = reportingClient();
    await failMutation(client, httpError(500), {
      mutationKey: [`/trips/${TRIP}/itinerary`],
    });
    expect(crumbs()[0].data).toMatchObject({ key: '/trips/:id/itinerary' });
    expect(everythingSent()).not.toContain(TRIP);
  });
});
