import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useGetTripsTripIdVisitsDaysDay } from '@/shared/api/generated/trips/trips';
import type {
  AdjustTimesRequest,
  VisitCheck,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { deriveVisitStatus } from './visitStatus';
import {
  useAdjustVisitTimes,
  VISIT_CONFLICT_NOTICE,
  type AdjustVisitTimesOutcome,
} from './useAdjustVisitTimes';

/**
 * TRIP-613 · AC-1·AC-5·AC-6 · BR-U5-04·07·22 · INV-4 — 방문 시각 편집 뮤테이션 훅의 낙관 갱신 +
 * 서버 교체 + 409 낙관 락 충돌 처리(롤백 + 재조회). record `useVisitCheck.integration.test.tsx` 선례.
 *
 * ⚠️ `features/execution/model/useVisitCheck` 를 재사용/ import 하지 않는다 — record 는 per-record
 * 4상태 shape 라 다르다. 409 code 판별은 `@/shared/api/visitConflict`(shared 승격분)를 훅이 내부로 쓰고,
 * record 는 axios 를 직접 import 하지 않는다(G5, shared 캡슐이 유일 경로).
 *
 * 무엇을 보장하나(승인 계약):
 *  - **AC-1(BR-U5-04)** 도착만 바꿔 저장 → PATCH body 에 `arrivedAt`·`expectedUpdatedAt`만(`completedAt`
 *    미포함, 안 보내면 유지). `expectedUpdatedAt` 은 캐시 레코드의 `updatedAt`(BR-U5-22).
 *  - **AC-5(BR-U5-07·INV-U5-01)** 200 → 낙관 레코드를 **서버 VisitCheck 로 교체**(권위 updatedAt·파생
 *    상태 반영). 병합이 아니라 통째 교체.
 *  - **AC-6(BR-U5-22·INV-4)** 409 VISIT_CONFLICT → 낙관 **롤백(레코드 단위)** + 그 날 캐시 **재조회** +
 *    "다른 기기에서 먼저 수정됐어요" outcome. 롤백은 그 레코드만, 다른 레코드는 불변.
 *
 * 왜 통합 버킷인가: 심판 대상이 "실제로 나간 body"와 "응답 전/롤백 후 캐시 상태"다 — msw + 실
 * QueryClient 로만 관측(record `useVisitCheck.integration.test.tsx` 와 같은 자리·장치).
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
const ARR = '2026-08-31T14:20:00';
const COMP = '2026-08-31T15:00:00';
const OLD = '2026-08-31T14:20:05Z'; // 편집이 딛고 선 서버 버전.
const NEW = '2026-08-31T14:25:30Z'; // 서버가 돌려주는 새 버전.

/** 방문 기록 하나 — 케이스가 필드만 바꾼다. */
const vc = (
  over: Partial<VisitCheck> & Pick<VisitCheck, 'visitCheckId' | 'poiId'>
): VisitCheck => ({
  slotKey: `${DAY}#${over.poiId}`,
  arrivedAt: null,
  completedAt: null,
  skippedAt: null,
  source: 'MANUAL',
  spontaneous: false,
  updatedAt: OLD,
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
let capturedBody: AdjustTimesRequest | undefined;
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
  capturedBody = undefined;
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

/** 그 날 방문 기록 조회 + 편집 훅을 함께 띄운다 — 낙관 캐시를 visits.data.visits 로 직접 관찰. */
function useProbe() {
  return {
    visits: useGetTripsTripIdVisitsDaysDay(TRIP, DAY),
    adjust: useAdjustVisitTimes({ tripId: TRIP, day: DAY }).adjust,
  };
}

/** 캐시에서 그 visitCheckId 레코드(없으면 undefined). */
const cacheRecord = (
  visits: { data?: { visits: VisitCheck[] } },
  visitCheckId: string
): VisitCheck | undefined =>
  (visits.data?.visits ?? []).find((v) => v.visitCheckId === visitCheckId);

/** 캐시 레코드의 파생 상태(부재면 'MISSING'). ★ 상태를 timestamps 에서 파생해 관측. */
const cacheStatus = (
  visits: { data?: { visits: VisitCheck[] } },
  visitCheckId: string
): string => {
  const rec = cacheRecord(visits, visitCheckId);
  return rec ? deriveVisitStatus(rec) : 'MISSING';
};

describe('🔴 AC-1 · BR-U5-04 — 도착만 바꿔 저장 → PATCH body 는 arrivedAt·expectedUpdatedAt 만', () => {
  it('completedAt 은 미포함(안 보내면 유지) + expectedUpdatedAt 은 레코드 updatedAt', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: [
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: ARR,
              completedAt: COMP,
            }),
          ],
        })
      ),
      http.patch(
        `${BASE}/trips/:tripId/visits/:visitCheckId`,
        async ({ request }) => {
          capturedBody = (await request.json()) as AdjustTimesRequest;
          return HttpResponse.json(
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: '2026-08-31T13:20:00',
              completedAt: COMP,
              updatedAt: NEW,
            })
          );
        }
      )
    );
    const { result } = renderHook(() => useProbe(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.visits.isSuccess).toBe(true));

    // 실행 — 도착만 13:20 으로 바꿔 저장(completedAt 은 안 넘긴다 = 유지).
    let outcome!: AdjustVisitTimesOutcome;
    await act(async () => {
      outcome = await result.current.adjust({
        visitCheckId: 'v1',
        arrivedAt: '2026-08-31T13:20:00',
      });
    });

    // 단언 ① — 나간 body 가 정확히 두 필드다. completedAt 키가 있으면 "안 보내면 유지"가 깨진다.
    expect(capturedBody).toEqual({
      arrivedAt: '2026-08-31T13:20:00',
      expectedUpdatedAt: OLD,
    });
    // 단언 ② — 저장 성공으로 수렴.
    expect(outcome).toEqual({ kind: 'adjusted' });
  });
});

describe('🔴 AC-5 · BR-U5-07 — 200 → 낙관을 서버 VisitCheck 로 교체', () => {
  it('완료 추가 저장 → 응답 전 낙관 COMPLETED + 응답 후 권위 updatedAt 으로 통째 교체', async () => {
    const gate = createGate();
    server.use(
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
        HttpResponse.json({
          visits: [vc({ visitCheckId: 'v1', poiId: 'p1', arrivedAt: ARR })],
        })
      ),
      http.patch(`${BASE}/trips/:tripId/visits/:visitCheckId`, async () => {
        await gate.opened;
        return HttpResponse.json(
          vc({
            visitCheckId: 'v1',
            poiId: 'p1',
            arrivedAt: ARR,
            completedAt: COMP,
            updatedAt: NEW,
          })
        );
      })
    );
    const { result } = renderHook(() => useProbe(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.visits.isSuccess).toBe(true));
    // 앵커 — 시작은 진행 중(tracked-props: act 전 .data 읽기).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('IN_PROGRESS');

    // 실행 ① — 완료 시각을 더해 저장(발사만).
    let pending!: Promise<AdjustVisitTimesOutcome>;
    await act(async () => {
      pending = result.current.adjust({
        visitCheckId: 'v1',
        completedAt: COMP,
      });
    });

    // 단언 ① — 서버가 답하기 전 낙관 COMPLETED, 단 버전은 아직 옛값(서버 미확인).
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');
    expect(cacheRecord(result.current.visits, 'v1')?.updatedAt).toBe(OLD);

    // 실행 ② — 문 열고 마무리.
    gate.release();
    let outcome!: AdjustVisitTimesOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ②③ — 낙관을 서버 레코드로 교체(권위 updatedAt) + 파생 상태 COMPLETED 유지.
    expect(outcome).toEqual({ kind: 'adjusted' });
    expect(cacheRecord(result.current.visits, 'v1')?.updatedAt).toBe(NEW);
    expect(cacheStatus(result.current.visits, 'v1')).toBe('COMPLETED');
  });
});

describe('🔴 AC-6 · BR-U5-22 · INV-4 — 409 VISIT_CONFLICT → 롤백 + 재조회 + 안내', () => {
  it('낙관 롤백은 그 레코드만(다른 레코드 불변) + 재조회로 서버 신버전 수렴 + conflict 메시지', async () => {
    const gatePatch = createGate();
    const gateRefetch = createGate();
    let getCount = 0;
    server.use(
      // 1번째 GET = 원본, 2번째 GET(재조회) = 다른 기기가 앞서 쓴 신버전(문 뒤 대기).
      http.get(`${BASE}/trips/:tripId/visits/days/:day`, async () => {
        getCount += 1;
        if (getCount === 1) {
          return HttpResponse.json({
            visits: [
              vc({
                visitCheckId: 'v1',
                poiId: 'p1',
                arrivedAt: ARR,
                updatedAt: OLD,
              }),
              vc({
                visitCheckId: 'v2',
                poiId: 'p2',
                arrivedAt: ARR,
                updatedAt: OLD,
              }),
            ],
          });
        }
        await gateRefetch.opened;
        return HttpResponse.json({
          visits: [
            vc({
              visitCheckId: 'v1',
              poiId: 'p1',
              arrivedAt: '2026-08-31T15:00:00', // 다른 기기가 15:00 으로 바꿔 놓음
              updatedAt: NEW,
            }),
            vc({
              visitCheckId: 'v2',
              poiId: 'p2',
              arrivedAt: ARR,
              updatedAt: OLD,
            }),
          ],
        });
      }),
      // 낙관 락 충돌: 서버 updatedAt 이 expectedUpdatedAt 보다 앞서 나감 → VISIT_CONFLICT.
      http.patch(`${BASE}/trips/:tripId/visits/:visitCheckId`, async () => {
        await gatePatch.opened;
        return HttpResponse.json(
          { error: { code: 'VISIT_CONFLICT', serverUpdatedAt: NEW } },
          { status: 409 }
        );
      })
    );
    const { result } = renderHook(() => useProbe(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.visits.isSuccess).toBe(true));
    // 앵커 — 시작은 v1 도착 14:20(tracked-props 읽기).
    expect(cacheRecord(result.current.visits, 'v1')?.arrivedAt).toBe(ARR);

    // 실행 ① — v1 도착을 13:00 으로 바꿔 저장(발사만).
    let pending!: Promise<AdjustVisitTimesOutcome>;
    await act(async () => {
      pending = result.current.adjust({
        visitCheckId: 'v1',
        arrivedAt: '2026-08-31T13:00:00',
      });
    });
    // 단언 mid — 낙관이 실제로 일어났다(이게 없으면 no-op 훅이 공허 통과).
    expect(cacheRecord(result.current.visits, 'v1')?.arrivedAt).toBe(
      '2026-08-31T13:00:00'
    );

    // 실행 ② — patch 문 열어 409 수신(재조회는 gateRefetch 로 아직 막아 둔다).
    gatePatch.release();
    let outcome!: AdjustVisitTimesOutcome;
    await act(async () => {
      outcome = await pending;
    });

    // 단언 ① — 안내가 호출자에게 도달(조용히 삼키면 INV-4 위반).
    expect(outcome).toEqual({
      kind: 'conflict',
      message: VISIT_CONFLICT_NOTICE,
    });
    expect(VISIT_CONFLICT_NOTICE).toBe('다른 기기에서 먼저 수정됐어요');
    // 단언 ② — 재조회 **완료 전**: v1 은 롤백돼 원본 14:20/OLD(낙관 13:00 이 남아 있으면 red),
    //           v2 는 통짜 스냅숏 복원이 아니라 애초에 안 건드려 불변(레코드 단위 롤백).
    expect(cacheRecord(result.current.visits, 'v1')?.arrivedAt).toBe(ARR);
    expect(cacheRecord(result.current.visits, 'v1')?.updatedAt).toBe(OLD);
    expect(cacheRecord(result.current.visits, 'v2')?.arrivedAt).toBe(ARR);

    // 실행 ③ — 재조회 문 열기 → 그 날 캐시 재조회(invalidate)로 서버 신버전 수렴.
    gateRefetch.release();
    await waitFor(() =>
      expect(hitCount(`GET /api/v1/trips/${TRIP}/visits/days/${DAY}`)).toBe(2)
    );
    // 단언 ③ — 재조회 후 v1 은 서버 신버전(15:00/NEW). 낙관도 옛 원본도 아닌 "진짜 최신"으로 수렴.
    await waitFor(() =>
      expect(cacheRecord(result.current.visits, 'v1')?.arrivedAt).toBe(
        '2026-08-31T15:00:00'
      )
    );
    expect(cacheRecord(result.current.visits, 'v1')?.updatedAt).toBe(NEW);
  });
});
