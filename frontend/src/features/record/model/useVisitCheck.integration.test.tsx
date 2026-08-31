import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetTripsTripIdVisitsDaysDay } from '@/shared/api/generated/trips/trips';
import type { ArriveRequest, VisitCheck } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

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

afterAll(() => server.close());

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
  it('active 카드 완료 → 응답 전 낙관 + POST complete 1회 + itinerary(plan) 0건 + 성공 재조회', async () => {
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

    // 단언 ① — 서버가 답하기 전에 이미 완료(낙관).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');
    // 단언 ② — 완료 요청이 그 visitCheckId 로 나갔다.
    expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/v1/complete`)).toBe(1);
    // 단언 ③ — plan(visit_slot=itinerary) 은 어떤 요청도 안 나갔다(BR-U5-01).
    expect(observedHits.filter((h) => /\/itinerary/.test(h))).toEqual([]);

    // 실행 ② — 문 열고 마무리.
    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ④⑤ — 완료로 수렴 + 그 날 방문 기록 재요청(무효화, 1 → 2).
    expect(outcome).toEqual({ kind: 'completed' });
    await waitFor(() =>
      expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(2)
    );
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
    // 단언 mid — 낙관이 실제로 일어났다(이게 없으면 no-op 훅이 공허 통과).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');

    // 실행 ② — 문 열고 409 수신.
    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });

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
  it('skip → 응답 전 SKIPPED 낙관 + POST .../skip 1회 + 성공 무효화', async () => {
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
    // 단언 ① — 응답 전 건너뜀으로 낙관 반영.
    expect(cacheStatus(result.current.visits, 'v1')).toBe('SKIPPED');
    // 단언 ② — skip 요청이 그 visitCheckId 로 나갔다.
    expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/v1/skip`)).toBe(1);

    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });
    expect(outcome).toEqual({ kind: 'skipped' });
    await waitFor(() =>
      expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(2)
    );
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
