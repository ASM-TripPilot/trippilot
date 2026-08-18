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
import { useTripBases, useTripCoverage } from './useTripBases';
import { useExtendTripPeriod, useFixSavedStay } from './useBaseFix';

/**
 * TRIP-226 보완·확장 쓰기 훅이 **실제로 나간 요청**으로 계약을 지킨다.
 *
 * 무엇을 보장하나:
 *  - **★15** 숙소를 고치면 `saved-stays`**만** 다시 받아온다. 배정은 안 바뀌었으므로
 *    `bases`·`coverage`를 다시 받을 이유가 없다.
 *  - **기간을 늘리면 `coverage`가 다시 온다.** 날짜가 늘면 커버리지 판정(`blocked`·`days`)이
 *    바뀌는데, 안 받아오면 방금 늘린 날들이 화면에 반영되지 않고 `blocked`가 낡은 값으로 남는다.
 *  - 나가는 본문이 `EditSavedStayRequest`·`EditTripRequest` 계약 그대로다.
 *
 * 왜 통합 버킷인가: 심판 대상이 "**실제로 나간 요청**"이다. 재요청 횟수와 최종 본문은 msw만
 * 관찰할 수 있다(`useTripBases.integration.test.tsx`와 같은 이유).
 *
 * ⚠️ **부정 짝이 이 파일의 본체다.** 인자 없는 `invalidateQueries()`는 **모든** 쿼리를
 * 무효화하는데, 긍정 단언("목록이 다시 왔다")만 두면 그 난폭한 구현도 통과한다. 무엇이
 * **안 왔는지**를 같이 재야 사정거리가 잠긴다(TRIP-203 ★5 · T4 ★4 선례).
 *
 * > *(개념)* **쿼리 무효화(invalidate)** — 캐시를 지우는 것이 아니라 "이 캐시는 이제 못 믿는다"는
 * > 상한 표시를 붙이는 동작. 화면에 떠 있는(=활성) 쿼리는 그 표시가 붙는 즉시 다시 요청한다.
 */

// authedClient(생성 클라이언트가 타는 mutator의 인증 계층)가 @/shared/storage 를 정적으로
// 물고 있다. expo-secure-store 실물 로드를 피하려면 목킹해야 한다
// (`useTripBases.integration.test.tsx:49` 와 같은 형태).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = 'trip-1';
const STAY_ID = 'stay-a';

const STAY_FIXTURE: SavedStay = {
  savedStayId: STAY_ID,
  name: '해운대 오션 호텔',
  coordConfirmed: false,
  checkIn: null,
  checkOut: null,
  registerRoute: 'LINK_PASTE',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

const ASSIGNMENT_FIXTURE: BaseAssignment = {
  baseAssignmentId: 'ba-1',
  savedStayId: STAY_ID,
  dateFrom: '2026-06-10',
  dateTo: '2026-06-12',
};

const COVERAGE_FIXTURE: Coverage = {
  blocked: false,
  days: [
    {
      date: '2026-06-10',
      status: 'AUTO',
      savedStayId: STAY_ID,
      candidates: [],
    },
  ],
};

/** 나간 요청의 `METHOD /경로` 누적 — 재요청 횟수를 세는 데 쓴다. */
let observedHits: string[] = [];
/** PATCH가 실제로 실어 보낸 본문(JSON 직렬화 **이후**). */
let capturedStayBody: Record<string, unknown> | null = null;
let capturedTripBody: Record<string, unknown> | null = null;
/** 다음 PATCH /saved-stays 가 돌려줄 상태 코드 — 케이스마다 갈아 끼운다. */
let patchStayStatus = 200;

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
  capturedStayBody = null;
  capturedTripBody = null;
  patchStayStatus = 200;
  clearAccessToken();
  server.use(
    http.get(`${BASE}/saved-stays`, () => HttpResponse.json([STAY_FIXTURE])),
    http.get(`${BASE}/trips/${TRIP_ID}/bases`, () =>
      HttpResponse.json([ASSIGNMENT_FIXTURE])
    ),
    http.get(`${BASE}/trips/${TRIP_ID}/coverage`, () =>
      HttpResponse.json(COVERAGE_FIXTURE)
    ),
    http.patch(`${BASE}/saved-stays/${STAY_ID}`, async ({ request }) => {
      capturedStayBody = (await request.json()) as Record<string, unknown>;
      return patchStayStatus === 200
        ? HttpResponse.json({ ...STAY_FIXTURE, coordConfirmed: true })
        : new HttpResponse(null, { status: patchStayStatus });
    }),
    http.patch(`${BASE}/trips/${TRIP_ID}`, async ({ request }) => {
      capturedTripBody = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        tripId: TRIP_ID,
        startDate: '2026-06-10',
        endDate: '2026-06-16',
        destinations: [{ seq: 1, region: '부산', nights: 3 }],
        party: 1,
      });
    })
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
      // 붙잡는다. mutation 기본 gcTime은 5분이라 그쪽도 반드시 0으로 둔다.
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
function useFixProbe() {
  return {
    stays: useSavedStays({ enabled: true }),
    bases: useTripBases(TRIP_ID),
    coverage: useTripCoverage(TRIP_ID),
    fix: useFixSavedStay(),
    extend: useExtendTripPeriod(),
  };
}

const STAYS_HIT = 'GET /api/v1/saved-stays';
const BASES_HIT = `GET /api/v1/trips/${TRIP_ID}/bases`;
const COVERAGE_HIT = `GET /api/v1/trips/${TRIP_ID}/coverage`;

/** 세 조회가 각각 정확히 1회 다녀온 상태를 만든다 — 증가 단언의 기준선이다. */
async function renderSettledProbe() {
  setAccessToken('valid-access');
  const rendered = renderHook(() => useFixProbe(), {
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

const FIX_BODY = {
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  coordConfirmed: true,
  checkIn: '2026-06-10',
  checkOut: '2026-06-12',
};

describe('★15 · useFixSavedStay — 무효화 사정거리는 saved-stays 하나다', () => {
  it('🔴 보완에 성공하면 목록만 다시 받아온다', async () => {
    const { result } = await renderSettledProbe();

    await act(async () => {
      await result.current.fix.mutateAsync({
        savedStayId: STAY_ID,
        data: FIX_BODY,
      });
    });

    // 긍정 — 고친 값이 화면에 반영되려면 목록이 다시 와야 한다. 안 오면 사용자가 저장에
    // 성공하고도 카드가 잠긴 채로 남는다(01b D3가 없애려던 바로 그 증상).
    await waitFor(() => expect(hitCount(STAYS_HIT)).toBe(2));

    // 부정 짝(본체) — 배정은 이 조작으로 안 바뀐다. 이 단언이 없으면 인자 없는
    // `invalidateQueries()`가 모든 캐시를 날리는 구현도 통과하고, 멀쩡히 그려진 구간과
    // 커버리지가 통째로 다시 로딩된다.
    expect(hitCount(BASES_HIT)).toBe(1);
    expect(hitCount(COVERAGE_HIT)).toBe(1);
  });

  it('🔴 나가는 본문이 EditSavedStayRequest 그대로다', async () => {
    const { result } = await renderSettledProbe();

    await act(async () => {
      await result.current.fix.mutateAsync({
        savedStayId: STAY_ID,
        data: FIX_BODY,
      });
    });

    // 앵커 — 요청이 실제로 나갔다. 없으면 아래 키 단언이 "아무것도 안 보내서" 통과한다.
    expect(capturedStayBody).not.toBeNull();
    // 계약 필수 필드 `name`이 빠지면 서버가 400을 준다(생성물 실측 — `name`만 required).
    expect(capturedStayBody).toEqual(FIX_BODY);
  });

  it('🔴 실패는 거부되고 재조회도 하지 않는다', async () => {
    // 이 짝이 없으면 "모든 오류를 삼키는" 구현이 위 케이스를 통과하고, 저장에 실패했는데
    // 목록만 다시 받아와 화면이 "성공한 것처럼" 보인다(BR-U1-55 침묵 실패 금지).
    patchStayStatus = 400;
    const { result } = await renderSettledProbe();

    let rejected = false;
    await act(async () => {
      await result.current.fix
        .mutateAsync({ savedStayId: STAY_ID, data: FIX_BODY })
        .catch(() => {
          rejected = true;
        });
    });

    expect(rejected).toBe(true);
    expect(hitCount(STAYS_HIT)).toBe(1);
    expect(hitCount(BASES_HIT)).toBe(1);
    expect(hitCount(COVERAGE_HIT)).toBe(1);
  });
});

describe('useExtendTripPeriod — 기간을 늘리면 커버리지가 다시 온다 (01b D4)', () => {
  it('🔴 coverage만 다시 받아오고, 본문은 EditTripRequest 3필드다', async () => {
    // 날짜가 늘면 커버리지 판정이 바뀐다(늘어난 날들이 공백으로 잡힌다). 안 받아오면
    // `blocked`가 낡은 값으로 남아 주 CTA가 거짓 상태를 보인다 — INV-2의 "보이는 판정은
    // 서버 검증값" 원칙이 여기서 깨진다.
    const { result } = await renderSettledProbe();

    await act(async () => {
      await result.current.extend.mutateAsync({
        tripId: TRIP_ID,
        data: {
          startDate: '2026-06-10',
          endDate: '2026-06-16',
          destinations: [{ seq: 1, region: '부산', nights: 3 }],
        },
      });
    });

    await waitFor(() => expect(hitCount(COVERAGE_HIT)).toBe(2));

    // 부정 짝 — 배정 목록과 저장 숙소는 기간 변경으로 바뀌지 않는다.
    expect(hitCount(BASES_HIT)).toBe(1);
    expect(hitCount(STAYS_HIT)).toBe(1);

    expect(capturedTripBody).not.toBeNull();
    expect(capturedTripBody).toEqual({
      startDate: '2026-06-10',
      endDate: '2026-06-16',
      destinations: [{ seq: 1, region: '부산', nights: 3 }],
    });
  });
});
