import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetTripsTripIdVisitsDaysDay } from '@/shared/api/generated/trips/trips';
import type { ArriveRequest, VisitCheck } from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { useVisitCheck, type VisitCheckOutcome } from './useVisitCheck';

/**
 * TRIP-396 · AC-3 · AC-4 — 방문 체크 훅(도착·완료)의 낙관적 갱신 + 슬롯키 단위 롤백.
 *
 * 무엇을 보장하나:
 *  - **U1 (AC-3)** [방문 완료]는 **서버가 답하기 전에** 그 슬롯을 완료로 보이게 하고(낙관),
 *    성공하면 그 날 방문 기록을 다시 받아온다.
 *  - **U2 (AC-3 실패)** 완료가 실패하면 낙관 반영을 되돌리고, **실패 경로에서는 무효화하지
 *    않는다**(재요청이 롤백을 덮으면 "되돌렸나"를 관측할 수 없다 — savedPlaces 선례).
 *  - **U3 (AC-4)** 수동 [도착]은 응답 전 진행 중으로 낙관 반영하고, 나간 요청 바디가
 *    `{slotKey, poiId, source:'MANUAL'}` 다(지오펜스 아님).
 *  - **U4 (★핵심 트립와이어 · W-2)** 동시에 다른 두 슬롯을 도착 처리하다 한쪽이 실패하면,
 *    그 롤백이 **다른 쪽의 낙관을 지우지 않는다**. 통짜 스냅숏 롤백(savedStays W-2 동형)이면
 *    B 가 지워져 red — 슬롯키(레코드) 단위 롤백이라야 green.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 요청·바디"와 "응답 전 캐시 상태"다 — msw + 실
 * QueryClient 로만 관측 가능(`savedPlaces.integration.test.tsx` 와 같은 자리·장치).
 */

// authedClient(생성 클라이언트의 mutator 인증 계층)가 @/shared/storage 를 정적으로 문다.
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'a',
    refreshToken: 'r',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP = 'trip-1';
const DAY = '2026-08-20';
const T = '2026-08-20T13:00:00';
const T2 = '2026-08-20T13:45:00';

/** 방문 기록 하나. arrivedAt/completedAt 만 케이스가 바꾼다. */
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

/** 테스트가 열어 줄 때까지 응답하지 않는 문(savedPlaces 선례) — "응답 전"을 시간이 아닌 신호로. */
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

/** 초기 방문 기록이 도착한 상태를 만든다. */
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

/** 지금 캐시에 그 poiId 의 방문 기록이 들어 있나. */
const cacheHasPoi = (
  visits: { data?: { visits: VisitCheck[] } },
  poiId: string
): boolean => (visits.data?.visits ?? []).some((v) => v.poiId === poiId);

/** 지금 캐시에서 그 visitCheckId 가 완료됐나. */
const cacheCompleted = (
  visits: { data?: { visits: VisitCheck[] } },
  visitCheckId: string
): boolean =>
  (visits.data?.visits ?? []).some(
    (v) => v.visitCheckId === visitCheckId && v.completedAt != null
  );

describe('AC-3 · 방문 완료 — 응답 전 낙관 + 성공 후 재조회 (U1)', () => {
  it('U1 서버가 답하기 전에 완료로 보이고, 성공 후 그 날 방문 기록을 다시 받아온다', async () => {
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
              completedAt: T2,
            })
          );
        }
      )
    );
    // 앵커 — 시작은 미완료.
    expect(cacheCompleted(result.current.visits, 'v1')).toBe(false);

    // 실행 ① — 완료를 발사만 한다.
    let pending!: Promise<VisitCheckOutcome>;
    await act(async () => {
      pending = result.current.vc.complete('v1');
    });

    // 단언 ① — 서버가 아직 답하지 않았는데 이미 완료(낙관).
    expect(cacheCompleted(result.current.visits, 'v1')).toBe(true);
    // 단언 ② — 완료 요청은 그 visitCheckId 로 실제로 나갔다.
    expect(hitCount(`POST /api/v1/trips/${TRIP}/visits/v1/complete`)).toBe(1);

    // 실행 ② — 문을 연다.
    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ③④ — 완료로 수렴 + 그 날 방문 기록 재요청(무효화, 1 → 2).
    expect(outcome).toEqual({ kind: 'completed' });
    await waitFor(() =>
      expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(2)
    );
  });
});

describe('AC-3 · 완료 실패는 되돌리고 무효화하지 않는다 (U2 · INV-4)', () => {
  it('U2 네트워크 실패 → 낙관 완료를 되돌리고, 방문 기록 재요청 0건', async () => {
    const { result } = await renderProbeReady([
      vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: T }),
    ]);
    server.use(
      http.post(`${BASE}/trips/:tripId/visits/:visitCheckId/complete`, () =>
        HttpResponse.error()
      )
    );

    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await result.current.vc.complete('v1');
    });

    // 단언 ① — 사유가 호출자에게 도달한다(조용히 삼키면 INV-4 위반).
    expect(outcome.kind).toBe('failed');
    // 단언 ② — 호출 전 상태(미완료)로 되돌아갔다.
    expect(cacheCompleted(result.current.visits, 'v1')).toBe(false);
    // 단언 ③ — 실패 경로는 무효화하지 않는다(재요청 1건 유지).
    expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(1);
  });
});

describe('AC-4 · 수동 체크인 — MANUAL 바디 + 응답 전 낙관 (U3)', () => {
  it('U3 응답 전 진행 중으로 반영하고, 나간 바디가 {slotKey, poiId, source:MANUAL} 다', async () => {
    const gate = createGate();
    const { result } = await renderProbeReady([]);
    server.use(
      http.post(`${BASE}/trips/:tripId/visits`, async ({ request }) => {
        capturedBodies.push((await request.json()) as ArriveRequest);
        await gate.opened;
        return HttpResponse.json(
          vc({ visitCheckId: 'vp9', poiId: 'p9', arrivedAt: T }),
          { status: 201 }
        );
      })
    );
    // 앵커 — 시작은 그 poiId 기록 없음.
    expect(cacheHasPoi(result.current.visits, 'p9')).toBe(false);

    // 실행 ① — 수동 도착을 발사만.
    let pending!: Promise<VisitCheckOutcome>;
    await act(async () => {
      pending = result.current.vc.arrive({
        slotKey: `${DAY}#p9`,
        poiId: 'p9',
        source: 'MANUAL',
      });
    });

    // 단언 ① — 응답 전에 진행 중(도착)으로 낙관 반영.
    expect(cacheHasPoi(result.current.visits, 'p9')).toBe(true);
    // 단언 ② — 나간 바디가 수동 체크인이다(지오펜스 자동 아님).
    expect(capturedBodies).toEqual([
      { slotKey: `${DAY}#p9`, poiId: 'p9', source: 'MANUAL' },
    ]);

    // 실행 ② — 문 열고 마무리.
    gate.release();
    let outcome!: VisitCheckOutcome;
    await act(async () => {
      outcome = await pending;
    });
    expect(outcome).toEqual({ kind: 'arrived' });
  });
});

describe('AC-4 · ★ W-2 — 동시 두 도착 중 한쪽 실패가 다른 쪽을 지우지 않는다 (U4)', () => {
  it('U4 A 실패 롤백 후에도 B 의 낙관이 캐시에 살아남는다 (슬롯키 단위 롤백)', async () => {
    const gateB = createGate();
    const { result } = await renderProbeReady([]);
    // 같은 경로, 바디 poiId 로 갈린다: A → 404 즉시, B → 문 뒤에서 대기(pending 유지).
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

    // 앵커 — 시작은 두 poiId 모두 기록 없음. (act 전에 .data 를 한 번 읽어 react-query v5
    // tracked-props 가 이후 낙관 setQueryData 변경을 관찰자에 통지하게 만든다 — U1:170·U3:238 동형.
    // 이 줄이 없으면 올바른 구현에서도, 틀린 통짜-스냅숏 롤백에서도 똑같이 stale 을 읽어 심판이 무효.)
    expect(cacheHasPoi(result.current.visits, 'a')).toBe(false);
    expect(cacheHasPoi(result.current.visits, 'b')).toBe(false);

    // 실행 — A 낙관 삽입 → B 가 A 포함 스냅숏을 캡처 → A 실패. (호출 순서가 곧 낙관 적용 순서)
    let pA!: Promise<VisitCheckOutcome>;
    let pB!: Promise<VisitCheckOutcome>;
    await act(async () => {
      pA = result.current.vc.arrive({
        slotKey: `${DAY}#a`,
        poiId: 'a',
        source: 'MANUAL',
      });
      pB = result.current.vc.arrive({
        slotKey: `${DAY}#b`,
        poiId: 'b',
        source: 'MANUAL',
      });
      await pA; // A 는 404 로 즉시 실패 → 롤백이 여기서 돈다. B 는 문에 걸려 pending.
    });

    // 단언 — A 롤백 후에도 B 의 낙관이 살아남는다(통짜 스냅숏 롤백이면 B 가 지워져 여기서 red).
    expect(cacheHasPoi(result.current.visits, 'b')).toBe(true);
    // A 는 되돌아가 사라졌다.
    expect(cacheHasPoi(result.current.visits, 'a')).toBe(false);

    // 정리 — 문 열고 B 마무리(매달린 요청 정리).
    gateB.release();
    await act(async () => {
      await pB;
    });
  });
});
