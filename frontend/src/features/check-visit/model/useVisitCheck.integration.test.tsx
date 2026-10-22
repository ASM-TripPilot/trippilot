import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import {
  defaultScheduler,
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetTripsTripIdVisitsDaysDay } from '@/shared/api/index.hooks';
import type { ArriveRequest, VisitCheck } from '@/shared/api/index.schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { flushNotifications } from '@/test-support/flushNotifications';

import { deriveVisitStatus } from './visitStatus';
import { useVisitCheck, type VisitCheckOutcome } from './useVisitCheck';

/**
 * TRIP-565 · AC-1·AC-2·AC-5·skip — record 소관 방문 체크 훅의 낙관적 갱신 + 레코드 단위 롤백.
 *
 * ⚠️ 이 훅은 `features/execution/model/useVisitCheck` 를 **재사용/ import 하지 않는다**(01b Q2).
 * 패턴만 미러(낙관 갱신·슬롯키 롤백·판별 유니온) — record 는 per-record 4상태라 shape 가 다르다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - **AC-1(BR-U5-01)** active 카드 완료 → `POST .../complete` 1회, plan(itinerary) **미접촉**(실적에만 적재).
 *  - **AC-2(BR-U5-02)** 재체크 409 → 낙관 완료를 롤백, 파생 상태 불변(조용한 성공 금지).
 *  - **AC-5(BR-U5-03)** 즉석 방문 2건 → 각 바디 slotKey=null·MANUAL, 캐시 2건 append(유니크 밖).
 *  - **skip** → `POST .../skip` 1회, 낙관 skippedAt + 성공 무효화.
 *  - **★W-2** 동시 두 도착 중 한쪽 실패 롤백이 다른 쪽 낙관을 안 지운다(레코드 단위 롤백).
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청·바디"와 "응답 전/롤백 후 캐시 상태"다 — msw + 실
 * QueryClient 로만 관측 가능(execution `useVisitCheck.integration.test.tsx` 와 같은 자리·장치).
 *
 * 화면 읽기 규율(TRIP-884): react-query 는 캐시 변경 알림을 스케줄러로 미뤄 보낸다. 이 파일은
 * 그 알림을 일부러 5ms 늦춰(beforeAll) "알림을 안 기다리고 result.current 를 읽는" 단언을 드러낸다.
 * ⚠️ 항상 red 는 아니다 — 기대값이 호출 전 값과 같은 단언(롤백 후 false 등)은 flush 를 빼먹어도
 * 옛 화면을 읽고 통과한다. 그러니 화면을 읽기 전엔 예외 없이 `flushNotifications()` 를 거친다.
 */

// authedClient(mutator 인증 계층)가 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest
    .fn()
    .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP = 'trip-1';
const DAY = '2026-08-31';
const T = '2026-08-31T14:20:00';

/** 방문 기록 하나 — 케이스가 timestamps 만 바꾼다. */
const vc = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
): VisitCheck => ({
  slotKey: `${DAY}#${over.poiId}`,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  // 서버 버전 시각(BR-U5-22 · openapi:1953) — codegen 후 required 라 픽스처가 미리 채운다(TRIP-619).
  updatedAt: '2026-08-31T14:20:05Z',
  ...over,
});

/** 테스트가 열어 줄 때까지 응답하지 않는 문 — "응답 전"을 시간이 아닌 신호로. */
function createGate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

let observedHits: string[] = [];
let capturedBodies: ArriveRequest[] = [];
const hitCount = (needle: string) =>
  observedHits.filter((hit) => hit === needle).length;

beforeAll(() => {
  notifyManager.setScheduler((cb) => setTimeout(cb, 5));
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  capturedBodies = [];
  setAccessToken('a');
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => {
  notifyManager.setScheduler(defaultScheduler);
  server.close();
});

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return Wrapper;
}

/** 그 날 방문 기록 조회 + 훅을 함께 띄운다 — 낙관 캐시를 visits.data.visits 로 직접 관찰. */
function useProbe() {
  return {
    visits: useGetTripsTripIdVisitsDaysDay(TRIP, DAY),
    vc: useVisitCheck({ tripId: TRIP, day: DAY }),
  };
}

async function renderProbeReady(initial: VisitCheck[]) {
  server.use(
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: initial })
    )
  );
  const rendered = renderHook(() => useProbe(), { wrapper: createWrapper() });
  await waitFor(() =>
    expect(rendered.result.current.visits.isSuccess).toBe(true)
  );
  return rendered;
}

/** 캐시에서 그 poiId 방문 기록이 있나. */
const cacheHasPoi = (
  visits: { data?: { visits: VisitCheck[] } },
  poiId: string
): boolean => (visits.data?.visits ?? []).some((v) => v.poiId === poiId);

/** 캐시에서 그 visitCheckId 레코드(없으면 undefined). */
const cacheRecord = (
  visits: { data?: { visits: VisitCheck[] } },
  visitCheckId: string
): VisitCheck | undefined =>
  (visits.data?.visits ?? []).find((v) => v.visitCheckId === visitCheckId);

/** 캐시 레코드의 파생 상태(부재면 'MISSING'). ★ 상태를 timestamps 에서 파생해 관측한다. */
const cacheStatus = (
  visits: { data?: { visits: VisitCheck[] } },
  visitCheckId: string
): string => {
  const rec = cacheRecord(visits, visitCheckId);
  return rec ? deriveVisitStatus(rec) : 'MISSING';
};

describe('AC-1 · BR-U5-01 — 완료는 실적에만 적재, plan 미접촉', () => {
  it('active 카드 완료 → 응답 전 낙관 + POST complete 1회 + itinerary(plan) 0건 + 응답 교체(재조회 0)', async () => {
    const gate = createGate();
    const { result } = await renderProbeReady([
      vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
    ]);
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/complete`,
        async () => {
          await gate.opened;
          return HttpResponse.json(
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: T,
              completedAt: T,
            })
          );
        }
      )
    );
    // 앵커 — 시작은 진행 중(react-query tracked-props: act 전 .data 읽기).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    // 실행 ① — 완료를 발사만.
    let pending!: Promise<VisitCheckOutcome>;
    await act(async () => {
      pending = result.current.vc.complete('v1');
    });
    await flushNotifications();

    // 단언 ① — 서버가 답하기 전에 이미 완료(낙관).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');
    // 단언 ② — 완료 요청이 그 visitCheckId 로 나갔다.
    await waitFor(() =>
      expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/v1/complete`)).toBe(1)
    );
    // 단언 ③ — plan(visit_slot=itinerary) 은 어떤 요청도 안 나갔다(BR-U5-01).
    expect(observedHits.filter((h) => /\/itinerary/.test(h))).toEqual([]);

    // 실행 ② — 문 열고 마무리.
    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ④⑤ — 완료로 수렴 + 캐시가 응답 레코드로 교체됐고 그 날 방문 기록 재조회는 0건(TRIP-1348).
    expect(outcome).toEqual({ kind: 'completed' });
    await flushNotifications();
    expect(cacheRecord(result.current.visits, 'v1')?.completedAt).toBe(T);
    expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(1);
  });
});

describe('AC-2 · BR-U5-02 — 재체크 409 롤백, 파생 상태 불변', () => {
  it('완료 409 → 낙관 완료를 되돌리고 상태 불변 + 조용한 성공 금지 + 무효화 안 함', async () => {
    const gate = createGate();
    const { result } = await renderProbeReady([
      vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
    ]);
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/complete`,
        async () => {
          await gate.opened;
          return new HttpResponse(null, { status: 409 });
        }
      )
    );
    // 앵커 — 시작은 진행 중.
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    // 실행 ① — 완료 발사.
    let pending!: Promise<VisitCheckOutcome>;
    await act(async () => {
      pending = result.current.vc.complete('v1');
    });
    await flushNotifications();
    // 단언 mid — 낙관이 실제로 일어났다(이게 없으면 no-op 훅이 공허 통과).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');

    // 실행 ② — 문 열고 409 수신.
    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });
    await flushNotifications();

    // 단언 ① — 사유가 호출자에게 도달(조용히 삼키면 INV-4 위반).
    expect(outcome).toEqual({ kind: 'failed', reason: 'conflict' });
    // 단언 ② — 롤백되어 호출 전 상태(진행 중)로 = 불변.
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');
    // 단언 ③ — 실패 경로는 무효화하지 않는다(재요청 1건 유지).
    expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(1);
  });
});

describe('AC-5 · BR-U5-03 — 즉석 방문 여러 건 append', () => {
  it('slotKey 없는 즉석 2회 → 각 바디 {slotKey:null, MANUAL}, 캐시 2건 append(spontaneous)', async () => {
    const { result } = await renderProbeReady([]);
    server.use(
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        const body = (await request.json()) as ArriveRequest;
        capturedBodies.push(body);
        return HttpResponse.json(
          vc({
            visitCheckId: `v-${body.poiId}`,
            poiId: body.poiId,
            arrivedAt: T,
            spontaneous: true,
          }),
          { status: 201 }
        );
      })
    );
    // 앵커 — 시작은 두 poiId 모두 없음.
    expect(cacheHasPoi(result.current.visits, 's1')).toBe(false);

    // 실행 — 즉석 방문 2건.
    await act(async () => {
      await result.current.vc.arrive({
        slotKey: null,
        poiId: 's1',
        source: 'MANUAL',
      });
      await result.current.vc.arrive({
        slotKey: null,
        poiId: 's2',
        source: 'MANUAL',
      });
    });
    await flushNotifications();

    // 단언 ① — 각 호출 바디가 slotKey=null · source MANUAL(즉석 방문).
    expect(capturedBodies).toEqual([
      { slotKey: null, poiId: 's1', source: 'MANUAL' },
      { slotKey: null, poiId: 's2', source: 'MANUAL' },
    ]);
    // 단언 ② — 캐시에 2건 append(유니크 제약 밖).
    expect(cacheHasPoi(result.current.visits, 's1')).toBe(true);
    expect(cacheHasPoi(result.current.visits, 's2')).toBe(true);
    // 단언 ③ — 낙관 레코드는 즉석(spontaneous)이다(INV-U5-02: plan 행 0).
    expect(cacheRecord(result.current.visits, 'v-s1')?.spontaneous).toBe(true);
  });
});

describe('skip 배선(라이트) — 건너뜀은 낙관 + POST skip 1회', () => {
  it('skip → 응답 전 SKIPPED 낙관 + POST .../skip 1회 + 응답 교체(재조회 0)', async () => {
    const gate = createGate();
    const { result } = await renderProbeReady([
      vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
    ]);
    server.use(
      http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/skip`, async () => {
        await gate.opened;
        return HttpResponse.json(
          vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T, skippedAt: T })
        );
      })
    );
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    let pending!: Promise<VisitCheckOutcome>;
    await act(async () => {
      pending = result.current.vc.skip('v1');
    });
    await flushNotifications();
    // 단언 ① — 응답 전 건너뜀으로 낙관 반영.
    expect(cacheStatus(result.current.visits, 'v1')).toBe('SKIPPED');
    // 단언 ② — skip 요청이 그 visitCheckId 로 나갔다.
    await waitFor(() =>
      expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/v1/skip`)).toBe(1)
    );

    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });
    expect(outcome).toEqual({ kind: 'skipped' });
    await flushNotifications();
    expect(cacheRecord(result.current.visits, 'v1')?.skippedAt).toBe(T);
    expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(1);
  });
});

describe('★W-2 — 동시 두 도착 중 한쪽 실패가 다른 쪽을 지우지 않는다', () => {
  it('A 실패 롤백 후에도 B 의 낙관이 캐시에 살아남는다(레코드 단위 롤백)', async () => {
    const gateB = createGate();
    const { result } = await renderProbeReady([]);
    // 같은 경로, 바디 poiId 로 갈린다: A → 404 즉시, B → 문 뒤 대기.
    server.use(
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        const body = (await request.json()) as ArriveRequest;
        if (body.poiId === 'a') return new HttpResponse(null, { status: 404 });
        await gateB.opened;
        return HttpResponse.json(
          vc({ visitCheckId: 'vb', poiId: 'b', arrivedAt: T }),
          {
            status: 201,
          }
        );
      })
    );
    // 앵커 — 시작은 둘 다 없음(tracked-props: 이후 setQueryData 를 관찰자에 통지시키는 읽기).
    expect(cacheHasPoi(result.current.visits, 'a')).toBe(false);
    expect(cacheHasPoi(result.current.visits, 'b')).toBe(false);

    // 실행 — A 낙관 삽입 → B 낙관 삽입 → A 실패 롤백.
    let pB!: Promise<VisitCheckOutcome>;
    await act(async () => {
      const pA = result.current.vc.arrive({
        slotKey: null,
        poiId: 'a',
        source: 'MANUAL',
      });
      pB = result.current.vc.arrive({
        slotKey: null,
        poiId: 'b',
        source: 'MANUAL',
      });
      await pA; // A 404 즉시 실패 → 롤백이 여기서 돈다. B 는 문에 걸려 pending.
    });
    await flushNotifications();

    // 단언 — A 롤백 후에도 B 의 낙관이 살아남는다(통짜 스냅숏 롤백이면 B 가 지워져 red).
    expect(cacheHasPoi(result.current.visits, 'b')).toBe(true);
    // A 는 되돌아가 사라졌다.
    expect(cacheHasPoi(result.current.visits, 'a')).toBe(false);

    // 정리 — 문 열고 B 마무리.
    gateB.release();
    await act(async () => {
      await pB;
    });
  });
});

/**
 * TRIP-1561 — 수동 방문: 다음 장소 [도착] 때 앞 장소를 먼저 완료한다(`completeThenArrive`).
 *
 * 사슬 = 완료 요청 → (성공하면) 도착 요청. 서버는 열린 도착이 둘이어도 받아 주므로(두 번째 도착 거절 규칙 없음) **순서를
 * 지키는 책임은 클라 몫**이다 — 완료 응답 전에 도착을 쏘거나 완료가 실패했는데 도착을 쏘면, 허브가 진행 중을 하나만
 * 인정해 뒤 도착이 '예정'으로 숨는 막다른 길이 된다.
 *
 * 무엇을 보장하나:
 *  - **순서** 완료 POST 가 먼저, 도착 POST 는 완료 응답 뒤에만 나간다(요청 기록 순서 + 문을 닫은 동안 도착 0회).
 *  - **완료 실패** 도착을 보내지 않고, 앞 장소를 진행 중으로 되돌리고, `failed(step:'complete')` 로 알린다. 409 는 서버가
 *    이미 완료(자동 완료·다른 기기)했다는 뜻이라 되돌린 화면이 서버 진실과 어긋나므로 그날 방문 기록을 1회 재조회해 맞춘다(결정 5).
 *  - **도착 실패** 완료는 서버가 확정했으니 되돌리지 않고(완료 취소 API 없음), 도착 낙관만 걷고 `failed(step:'arrive')`.
 *  - **연타** 사슬이 도는 동안의 두 번째 호출은 어떤 도착 대상이든 요청 없이 `ignored` — 완료·도착 POST 는 각 1회.
 *    성공·실패 뒤에는 잠금이 풀려 다시 누를 수 있다.
 *  - **낙관 id** 앞 장소 id 가 `optimistic:` 이면(직전 도착 응답 대기 중, 서버에 없는 id) 사슬을 시작하지 않는다 — 요청 0.
 *  - 완료 요청엔 본문이 없다(AC-10 — 출처는 서버가 MANUAL 로 채운다).
 */
describe('TRIP-1561 — 완료→도착 사슬(completeThenArrive)', () => {
  const COMPLETE_HIT = `POST /api/v1/trips/${TRIP}/visits/v1/complete`;
  const ARRIVE_HIT = `POST /api/v1/trips/${TRIP}/visits`;
  const GET_HIT = `GET /api/v1/trips/${TRIP}/visits/days/${DAY}`;
  const T2 = '2026-08-31T14:50:00';
  const T3 = '2026-08-31T14:50:01';
  const NEXT = {
    slotKey: `${DAY}#p2`,
    poiId: 'p2',
    source: 'MANUAL' as const,
  };
  const chainInput = (poiId = 'p2') => ({
    completeVisitCheckId: 'v1',
    arrive: { slotKey: `${DAY}#${poiId}`, poiId, source: 'MANUAL' as const },
  });

  /** 앞 장소가 진행 중인 하루 — v1(p1 도착·미완료). */
  const activeP1 = () => [
    vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
  ];
  const completedP1 = () =>
    vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T, completedAt: T2 });
  const arrivedP2 = (poiId = 'p2') =>
    vc({
      visitCheckId: `v-${poiId}`,
      poiId,
      arrivedAt: T3,
      slotKey: `${DAY}#${poiId}`,
    });

  /** 음성 단언("안 나갔다") 전에 비동기 일이 끝날 틈을 준다 — "요청 0회"가 공허해지지 않게. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

  const completeOk = () =>
    http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () =>
      HttpResponse.json(completedP1())
    );
  const arriveOk = () =>
    http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
      const body = (await request.json()) as ArriveRequest;
      capturedBodies.push(body);
      return HttpResponse.json(arrivedP2(body.poiId), { status: 201 });
    });

  it('CH1 완료 요청이 먼저, 도착 요청은 완료 응답 뒤에만 — 응답 교체로 끝나고 재조회는 없다', async () => {
    const gate = createGate();
    let completeBody: string | null = null;
    const { result } = await renderProbeReady(activeP1());
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/complete`,
        async ({ request }) => {
          completeBody = await request.text();
          await gate.opened;
          return HttpResponse.json(completedP1());
        }
      ),
      arriveOk()
    );
    // 앵커 — 시작은 p1 진행 중·p2 기록 없음(tracked-props: act 전 .data 읽기).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');
    expect(cacheHasPoi(result.current.visits, 'p2')).toBe(false);

    // 실행 ① — 사슬을 발사만. 완료 응답은 문 뒤에서 대기한다.
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.vc.completeThenArrive(chainInput());
    });
    await waitFor(() => expect(hitCount(COMPLETE_HIT)).toBe(1));
    await settle();
    await flushNotifications();

    // 단언 ① — 완료 응답 전에는 도착이 한 번도 안 나갔고, 앞 장소는 이미 완료로 보인다(낙관).
    expect(hitCount(ARRIVE_HIT)).toBe(0);
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');

    // 실행 ② — 문을 열어 완료 응답을 준다.
    gate.release();
    let outcome: unknown;
    await act(async () => {
      outcome = await pending;
    });
    await flushNotifications();

    // 단언 ② — 요청 순서는 완료 → 도착, 각 1회. 도착 본문은 다음 장소의 슬롯 키를 실은 수동 도착이다.
    expect(outcome).toEqual({ kind: 'arrived' });
    expect(observedHits.filter((hit) => hit.startsWith('POST '))).toEqual([
      COMPLETE_HIT,
      ARRIVE_HIT,
    ]);
    expect(capturedBodies).toEqual([NEXT]);
    // 단언 ③ — 완료 요청엔 본문이 없다(AC-10: 출처·시각은 서버가 채운다).
    expect(completeBody).toBe('');
    // 단언 ④ — 앞 장소는 서버 응답 레코드(완료 시각 T2)로, 다음 장소는 응답 레코드 v-p2 로 교체됐고 재조회는 0.
    expect(cacheRecord(result.current.visits, 'v1')?.completedAt).toBe(T2);
    expect(cacheStatus(result.current.visits, 'v-p2')).toBe('IN_PROGRESS');
    expect(cacheRecord(result.current.visits, 'optimistic:p2')).toBeUndefined();
    expect(hitCount(GET_HIT)).toBe(1);
  });

  it.each([
    ['500', () => new HttpResponse(null, { status: 500 }), 'network', 1],
    ['네트워크 끊김', () => HttpResponse.error(), 'network', 1],
    ['404', () => new HttpResponse(null, { status: 404 }), 'not-found', null],
    [
      '409 이미 완료',
      () => new HttpResponse(null, { status: 409 }),
      'conflict',
      2,
    ],
  ] as const)(
    'CH2 완료가 %s 로 실패하면 도착을 보내지 않고, 앞 장소를 진행 중으로 되돌리고, 완료 단계 실패로 알린다',
    async (_name, failure, reason, expectedGets) => {
      // 409 는 서버가 이미 완료한 상태 — 재조회가 오면 완료 레코드를 준다.
      let gets = 0;
      const { result } = await renderProbeReady(activeP1());
      server.use(
        http.get(`${BASE}/trips/:tripId/visits/days/:day`, () => {
          gets += 1;
          return HttpResponse.json({
            visits: gets === 1 ? activeP1() : [completedP1()],
          });
        }),
        http.post(
          `${BASE}/trips/:tripId/visits/:visitCheckId/complete`,
          failure
        ),
        arriveOk()
      );
      // 앵커 — 시작은 진행 중(위 handler 교체 전에 받은 첫 조회 결과).
      expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');
      gets = 1;

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.vc.completeThenArrive(chainInput());
      });
      await settle();
      await flushNotifications();

      // 단언 ① — 완료 단계 실패이고 사유가 호출자에게 도달한다(조용히 삼키면 INV-4 위반).
      expect(outcome).toEqual({ kind: 'failed', step: 'complete', reason });
      // 단언 ② — 도착은 한 번도 안 나갔고 다음 장소 낙관도 없다.
      expect(hitCount(ARRIVE_HIT)).toBe(0);
      expect(cacheHasPoi(result.current.visits, 'p2')).toBe(false);
      if (expectedGets === 2) {
        // 409 — 서버 진실에 맞추려 그날 방문 기록을 정확히 1회 다시 읽고, 화면은 완료로 수렴한다(결정 5).
        await waitFor(() => expect(hitCount(GET_HIT)).toBe(2));
        await flushNotifications();
        expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');
      } else {
        // 그 밖의 실패 — 되돌린 진행 중이 그대로다.
        expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');
        if (expectedGets !== null) expect(hitCount(GET_HIT)).toBe(1);
      }
    }
  );

  it.each([
    ['500', () => new HttpResponse(null, { status: 500 }), 'network'],
    ['409', () => new HttpResponse(null, { status: 409 }), 'conflict'],
  ] as const)(
    'CH3 완료는 성공하고 도착이 %s 로 실패하면 완료는 남기고, 다음 장소 낙관만 걷고, 도착 단계 실패로 알린다',
    async (_name, failure, reason) => {
      const { result } = await renderProbeReady(activeP1());
      server.use(
        completeOk(),
        http.post(`${BASE}/trips/:tripId/visits`, failure)
      );
      expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

      let outcome: unknown;
      await act(async () => {
        outcome = await result.current.vc.completeThenArrive(chainInput());
      });
      await flushNotifications();

      // 단언 ① — 도착 단계 실패. 완료·도착 요청은 각 1회다.
      expect(outcome).toEqual({ kind: 'failed', step: 'arrive', reason });
      expect(hitCount(COMPLETE_HIT)).toBe(1);
      expect(hitCount(ARRIVE_HIT)).toBe(1);
      // 단언 ② — 완료는 되돌리지 않는다(서버가 확정, 취소 API 없음): 서버 응답의 완료 시각이 남는다.
      expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');
      expect(cacheRecord(result.current.visits, 'v1')?.completedAt).toBe(T2);
      // 단언 ③ — 다음 장소 낙관 레코드는 걷혔다(예정으로 돌아옴). 재조회는 없다.
      expect(cacheHasPoi(result.current.visits, 'p2')).toBe(false);
      expect(hitCount(GET_HIT)).toBe(1);
    }
  );

  it('CH4 사슬이 도는 동안 연타하면(같은 대상·다른 대상 모두) 요청 없이 ignored — 완료·도착 POST 는 각 1회', async () => {
    const gate = createGate();
    const { result } = await renderProbeReady([...activeP1()]);
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/complete`,
        async () => {
          await gate.opened;
          return HttpResponse.json(completedP1());
        }
      ),
      arriveOk()
    );
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    // 실행 — 같은 틱에 세 번: p2 [도착] · p2 [도착] 연타 · p3 [도착].
    const pending: Promise<unknown>[] = [];
    await act(async () => {
      pending.push(result.current.vc.completeThenArrive(chainInput('p2')));
      pending.push(result.current.vc.completeThenArrive(chainInput('p2')));
      pending.push(result.current.vc.completeThenArrive(chainInput('p3')));
    });
    await waitFor(() => expect(hitCount(COMPLETE_HIT)).toBe(1));
    gate.release();
    let outcomes: unknown[] = [];
    await act(async () => {
      outcomes = await Promise.all(pending);
    });
    await flushNotifications();

    // 단언 — 첫 사슬만 끝까지 갔고 나머지는 ignored. 완료·도착 POST 는 각 1회, 본문은 첫 호출의 p2.
    expect(outcomes).toEqual([
      { kind: 'arrived' },
      { kind: 'ignored' },
      { kind: 'ignored' },
    ]);
    expect(hitCount(COMPLETE_HIT)).toBe(1);
    expect(hitCount(ARRIVE_HIT)).toBe(1);
    expect(capturedBodies).toEqual([NEXT]);
  });

  it('CH5 실패 뒤에는 잠금이 풀려 다시 누르면 사슬이 처음부터 다시 돈다 (완료 → 도착)', async () => {
    let completes = 0;
    const { result } = await renderProbeReady(activeP1());
    server.use(
      http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () => {
        completes += 1;
        return completes === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(completedP1());
      }),
      arriveOk()
    );
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    let first: unknown;
    await act(async () => {
      first = await result.current.vc.completeThenArrive(chainInput());
    });
    await flushNotifications();
    expect(first).toEqual({
      kind: 'failed',
      step: 'complete',
      reason: 'network',
    });
    expect(hitCount(ARRIVE_HIT)).toBe(0);

    // 사람 손가락처럼 한 틱 쉬고 다시 누른다.
    await settle();
    let second: unknown;
    await act(async () => {
      second = await result.current.vc.completeThenArrive(chainInput());
    });
    await flushNotifications();

    expect(second).toEqual({ kind: 'arrived' });
    expect(hitCount(COMPLETE_HIT)).toBe(2);
    expect(hitCount(ARRIVE_HIT)).toBe(1);
  });

  it('CH6 앞 장소 id 가 낙관 id(optimistic:…)이면 사슬을 시작하지 않는다 — 요청 0, 캐시 불변', async () => {
    const { result } = await renderProbeReady([
      vc({ visitCheckId: 'optimistic:p1', poiId: 'p1', arrivedAt: T }),
    ]);
    server.use(completeOk(), arriveOk());
    expect(cacheStatus(result.current.visits, 'optimistic:p1')).toBe(
      'IN_PROGRESS'
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.vc.completeThenArrive({
        ...chainInput(),
        completeVisitCheckId: 'optimistic:p1',
      });
    });
    await settle();
    await flushNotifications();

    expect(outcome).toEqual({ kind: 'ignored' });
    expect(observedHits.filter((hit) => hit.startsWith('POST '))).toEqual([]);
    expect(cacheStatus(result.current.visits, 'optimistic:p1')).toBe(
      'IN_PROGRESS'
    );
    expect(cacheHasPoi(result.current.visits, 'p2')).toBe(false);
  });

  // 5-b 보강(경고-1) — 성공 뒤에도 잠금이 풀리는가. CH5 는 "실패 뒤"만 봤다: 성공한 사슬이 잠금을 쥔 채 끝나면(finally 대신 실패
  // 경로에서만 푸는 회귀) 3곳 일정의 두 번째 이동(p2 → p3)부터 [도착]이 `ignored` 로 영원히 무시되는데도 기존 15건은 green 이었다.
  it('CH7 사슬이 성공한 뒤에도 잠금이 풀려 다음 이동이 다시 사슬로 나간다 — p1→p2 성공 뒤 p2→p3 은 완료(p2) → 도착(p3)', async () => {
    const completeIds: string[] = [];
    const { result } = await renderProbeReady(activeP1());
    server.use(
      http.post(
        `${BASE}/trips/:tripId/visits/:visitCheckId/complete`,
        ({ params }) => {
          const id = String(params.visitCheckId);
          completeIds.push(id);
          return HttpResponse.json(
            id === 'v1'
              ? completedP1()
              : vc({
                  visitCheckId: id,
                  poiId: 'p2',
                  arrivedAt: T3,
                  completedAt: '2026-08-31T15:10:00',
                  slotKey: `${DAY}#p2`,
                })
          );
        }
      ),
      arriveOk()
    );
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    // 실행 ① — p1 → p2 (성공).
    let first: unknown;
    await act(async () => {
      first = await result.current.vc.completeThenArrive(chainInput('p2'));
    });
    await flushNotifications();
    expect(first).toEqual({ kind: 'arrived' });
    // 앵커 — 첫 사슬이 실제로 끝났다: p2 가 진행 중, 완료·도착 각 1회.
    expect(cacheStatus(result.current.visits, 'v-p2')).toBe('IN_PROGRESS');
    expect(completeIds).toEqual(['v1']);
    expect(capturedBodies).toEqual([NEXT]);

    // 실행 ② — 사람 손가락처럼 한 틱 쉬고, 이번엔 p2(방금 도착한 진짜 id) → p3.
    await settle();
    let second: unknown;
    await act(async () => {
      second = await result.current.vc.completeThenArrive({
        completeVisitCheckId: 'v-p2',
        arrive: { slotKey: `${DAY}#p3`, poiId: 'p3', source: 'MANUAL' },
      });
    });
    await flushNotifications();

    // 단언 — 두 번째도 `ignored` 가 아니라 사슬이 돌았다: 완료는 p2 레코드로, 도착은 p3 으로 각 1회씩 더 나갔다.
    expect(second).toEqual({ kind: 'arrived' });
    expect(completeIds).toEqual(['v1', 'v-p2']);
    expect(hitCount(ARRIVE_HIT)).toBe(2);
    expect(capturedBodies.map((body) => body.poiId)).toEqual(['p2', 'p3']);
    expect(cacheStatus(result.current.visits, 'v-p3')).toBe('IN_PROGRESS');
  });
});
