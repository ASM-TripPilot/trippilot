import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { setAccessToken, clearAccessToken } from '@/shared/api/tokenManager';
import type {
  BaseAssignment,
  Coverage,
  SavedStay,
} from '@/shared/api/generated/schemas';

import { useSavedStays } from './useSavedStays';
import {
  useAssignBase,
  useTripBases,
  useTripCoverage,
  useUnassignBase,
} from './useTripBases';

/**
 * TRIP-225 g02 — 거점 조회·배정 훅이 **실제로 나간 요청**으로 계약을 지킨다.
 *
 * 무엇을 보장하나:
 *  - **★4 · 01b D11** 지정·해제에 성공하면 `bases`와 `coverage` **둘 다** 다시 받아오고,
 *    `saved-stays`는 **건드리지 않는다**. 무효화는 낙관적 갱신 대신 고른 길이다 — "지정하면
 *    `blocked`가 어떻게 바뀔지"는 서버 판정이라 클라이언트가 예측하면 INV-2 위반이다.
 *  - **01b D13-b** 409(이미 배정됨)는 **실패가 아니다.** 목표 상태와 결과 상태가 같으므로
 *    성공으로 접어 재조회로 간다(선례: TRIP-209 must-visit 409).
 *  - **★10 · 01b D7** `tripId`가 없으면 요청이 **한 건도 나가지 않는다**.
 *  - 나가는 요청 본문이 `AssignBaseRequest` 3필드 그대로다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 재요청 횟수와 최종 본문은 msw만
 * 관찰할 수 있다(`useCreateTrip.integration.test.tsx`와 같은 이유).
 *
 * > *(개념)* **쿼리 무효화(invalidate)** — 캐시를 지우는 것이 아니라 "이 캐시는 이제 못 믿는다,
 * > 필요해지면 다시 받아라"라는 **상한 표시**를 붙이는 동작. 화면에 떠 있는(=활성) 쿼리는 그
 * > 표시가 붙는 즉시 다시 요청한다 — 이 테스트가 무효화를 관찰하는 방법이 그것이다.
 *
 * ⚠️ **부정 짝이 이 파일의 본체다.** 인자 없는 `invalidateQueries()`는 **모든** 쿼리를
 * 무효화하는데, 긍정 단언("bases가 다시 왔다")만 두면 그 난폭한 구현도 통과한다.
 * `saved-stays`가 **안 왔다**를 같이 재야 사정거리가 잠긴다(TRIP-203 ★5 선례).
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다. expo-secure-store 실물 로드를 피하려면 목킹해야 한다
// (`useCreateTrip.integration.test.tsx:60` 과 같은 형태).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

/** authWiring.integration.test.ts:59 와 같은 값(리포 관례). */
const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';

const STAY_FIXTURE: SavedStay = {
  savedStayId: 'stay-a',
  name: '해운대 오션 호텔',
  coordConfirmed: true,
  checkIn: '2026-06-10',
  checkOut: '2026-06-12',
  registerRoute: 'MAP_SEARCH',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const ASSIGNMENT_FIXTURE: BaseAssignment = {
  baseAssignmentId: 'ba-1',
  savedStayId: 'stay-a',
  dateFrom: '2026-06-10',
  dateTo: '2026-06-12',
};

const COVERAGE_FIXTURE: Coverage = {
  blocked: false,
  days: [
    { date: '2026-06-10', status: 'AUTO', savedStayId: 'stay-a', candidates: [] },
  ],
};

/** 나간 요청의 `METHOD /경로` 누적 — 재요청 횟수를 세는 데 쓴다. */
let observedHits: string[] = [];
/** `POST /trips/{id}/bases`가 실제로 실어 보낸 본문(JSON 직렬화 **이후**). */
let capturedBody: Record<string, unknown> | null = null;
/** 다음 POST가 돌려줄 상태 코드 — 케이스마다 갈아 끼운다. */
let postStatus = 201;

function hitCount(needle: string): number {
  return observedHits.filter((hit) => hit === needle).length;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  server.events.on('request:start', ({ request }) => {
    observedHits.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});

beforeEach(() => {
  observedHits = [];
  capturedBody = null;
  postStatus = 201;
  clearAccessToken();
  server.use(
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([STAY_FIXTURE])),
    http.get(`${BASE}/trips/${TRIP_ID}/bases`, () =>
      HttpResponse.json([ASSIGNMENT_FIXTURE])
    ),
    http.get(`${BASE}/trips/${TRIP_ID}/coverage`, () =>
      HttpResponse.json(COVERAGE_FIXTURE)
    ),
    http.post(`${BASE}/trips/${TRIP_ID}/bases`, async ({ request }) => {
      capturedBody = (await request.json()) as Record<string, unknown>;
      return postStatus === 201
        ? HttpResponse.json(ASSIGNMENT_FIXTURE, { status: 201 })
        : new HttpResponse(null, { status: postStatus });
    }),
    http.delete(
      `${BASE}/trips/${TRIP_ID}/bases/${ASSIGNMENT_FIXTURE.baseAssignmentId}`,
      () => new HttpResponse(null, { status: 204 })
    )
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => server.close());

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime: 0 — 기본값이 만드는 타이머가 테스트 종료 후에도 살아남아 Node 프로세스를
      // 붙잡는다. mutation 기본 gcTime은 5분이라 그쪽도 반드시 0으로 둔다
      // (`useCreateTrip.integration.test.tsx:157-162` 실측).
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

/** 세 조회를 **활성**으로 띄운 관찰용 훅 — 무효화가 실제 재요청으로 이어지는지 보려면 그
 * 쿼리가 활성이어야 한다(활성 쿼리만 무효화 즉시 다시 받는다). */
function useBasesProbe(tripId: string | undefined) {
  return {
    stays: useSavedStays({ enabled: Boolean(tripId) }),
    bases: useTripBases(tripId),
    coverage: useTripCoverage(tripId),
    assign: useAssignBase(),
    unassign: useUnassignBase(),
  };
}

const STAYS_HIT = 'GET /api/v1/saved-stays';
const BASES_HIT = `GET /api/v1/trips/${TRIP_ID}/bases`;
const COVERAGE_HIT = `GET /api/v1/trips/${TRIP_ID}/coverage`;

/** 세 조회가 각각 정확히 1회 다녀온 상태를 만든다 — 증가 단언의 기준선이다. */
async function renderSettledProbe() {
  setAccessToken('valid-access');
  const rendered = renderHook(() => useBasesProbe(TRIP_ID), {
    wrapper: createWrapper(),
  });
  await waitFor(() =>
    expect(rendered.result.current.stays.isSuccess).toBe(true)
  );
  await waitFor(() =>
    expect(rendered.result.current.bases.isSuccess).toBe(true)
  );
  await waitFor(() =>
    expect(rendered.result.current.coverage.isSuccess).toBe(true)
  );

  // 앵커 — 초기 상태가 실제로 "각 1회"다. 이게 없으면 아래 1→2가 무엇에서 무엇으로 늘었는지
  // 말하지 못한다.
  expect(hitCount(STAYS_HIT)).toBe(1);
  expect(hitCount(BASES_HIT)).toBe(1);
  expect(hitCount(COVERAGE_HIT)).toBe(1);

  return rendered;
}

describe('★4 · 01b D11 — 무효화 사정거리는 bases·coverage 둘뿐이다', () => {
  it('🔴 지정에 성공하면 두 쿼리만 다시 받아온다', async () => {
    const { result } = await renderSettledProbe();

    await act(async () => {
      await result.current.assign.mutateAsync({
        tripId: TRIP_ID,
        data: {
          savedStayId: 'stay-a',
          dateFrom: '2026-06-10',
          dateTo: '2026-06-12',
        },
      });
    });

    // 긍정 — 배정 목록과 커버리지가 실제로 다시 왔다. 커버리지를 빼먹으면 방금 지정으로
    // 해소된 공백이 화면에 계속 남아 사용자가 영영 진행하지 못한다.
    await waitFor(() => expect(hitCount(BASES_HIT)).toBe(2));
    await waitFor(() => expect(hitCount(COVERAGE_HIT)).toBe(2));

    // 부정 짝(★4 본체) — 저장 숙소 목록은 이 조작으로 바뀌지 않는다. 이 단언이 없으면
    // 인자 없는 `invalidateQueries()`가 모든 캐시를 날리는 구현도 통과한다.
    expect(hitCount(STAYS_HIT)).toBe(1);
  });

  it('🔴 해제도 같은 두 쿼리만 다시 받아온다', async () => {
    const { result } = await renderSettledProbe();

    await act(async () => {
      await result.current.unassign.mutateAsync({
        tripId: TRIP_ID,
        baseAssignmentId: ASSIGNMENT_FIXTURE.baseAssignmentId,
      });
    });

    await waitFor(() => expect(hitCount(BASES_HIT)).toBe(2));
    await waitFor(() => expect(hitCount(COVERAGE_HIT)).toBe(2));
    expect(hitCount(STAYS_HIT)).toBe(1);
  });

  it('나가는 본문이 AssignBaseRequest 3필드 그대로다 (01b D1)', async () => {
    const { result } = await renderSettledProbe();

    await act(async () => {
      await result.current.assign.mutateAsync({
        tripId: TRIP_ID,
        data: {
          savedStayId: 'stay-a',
          dateFrom: '2026-06-10',
          dateTo: '2026-06-12',
        },
      });
    });

    // 앵커 — 요청이 실제로 나갔다. 없으면 아래 키 단언이 "아무것도 안 보내서" 통과한다.
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toEqual({
      savedStayId: 'stay-a',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-12',
    });
  });
});

describe('01b D13-b — 409는 실패가 아니라 성공이다', () => {
  it('🔴 409를 받아도 거부되지 않고, 두 쿼리를 다시 받아온다', async () => {
    // 목표 상태("이 숙소가 이 여행의 거점이다")와 결과 상태가 같으므로 실패로 세지 않는다.
    // 여기서 거부하면 화면이 "지정하지 못했어요"를 띄우는데, 실제로는 지정돼 있다.
    postStatus = 409;
    const { result } = await renderSettledProbe();

    let rejected = false;
    await act(async () => {
      await result.current.assign
        .mutateAsync({
          tripId: TRIP_ID,
          data: {
            savedStayId: 'stay-a',
            dateFrom: '2026-06-10',
            dateTo: '2026-06-12',
          },
        })
        .catch(() => {
          rejected = true;
        });
    });

    expect(rejected).toBe(false);
    await waitFor(() => expect(hitCount(BASES_HIT)).toBe(2));
    await waitFor(() => expect(hitCount(COVERAGE_HIT)).toBe(2));
  });

  it('🔴 짝 — 그 밖의 실패는 거부되고 재조회도 하지 않는다', async () => {
    // 이 짝이 없으면 "모든 오류를 삼키는" 구현이 위 케이스를 통과하고, 진짜 실패가
    // 조용해진다(BR-U1-55 침묵 실패 금지).
    postStatus = 500;
    const { result } = await renderSettledProbe();

    let rejected = false;
    await act(async () => {
      await result.current.assign
        .mutateAsync({
          tripId: TRIP_ID,
          data: {
            savedStayId: 'stay-a',
            dateFrom: '2026-06-10',
            dateTo: '2026-06-12',
          },
        })
        .catch(() => {
          rejected = true;
        });
    });

    expect(rejected).toBe(true);
    expect(hitCount(BASES_HIT)).toBe(1);
    expect(hitCount(COVERAGE_HIT)).toBe(1);
  });
});

describe('★10 · 01b D7 — tripId가 없으면 요청이 한 건도 안 나간다', () => {
  it('🔴 세 조회 모두 꺼진다', async () => {
    // `trips/new/**`는 `Stack.Protected` 밖이라 딥링크·앱 재시작으로 실제로 열린다. 그때
    // tripId 없이 쏘면 전부 404가 되고, 화면은 그 404를 "불러올 수 없어요"로 오역한다.
    setAccessToken('valid-access');
    const { result } = renderHook(() => useBasesProbe(undefined), {
      wrapper: createWrapper(),
    });

    // 요청이 나갈 시간을 준 뒤에 센다 — 즉시 0인 것은 아직 안 나간 것과 구별되지 않는다.
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.bases.isPending).toBe(true));

    expect(observedHits).toEqual([]);
  });

  it('짝 — tripId가 있으면 세 요청이 모두 나간다', async () => {
    // 이 짝이 없으면 "언제나 꺼 두는" 구현이 위 케이스를 통과하고 화면이 영영 안 뜬다.
    await renderSettledProbe();

    expect(hitCount(STAYS_HIT)).toBe(1);
    expect(hitCount(BASES_HIT)).toBe(1);
    expect(hitCount(COVERAGE_HIT)).toBe(1);
  });
});
