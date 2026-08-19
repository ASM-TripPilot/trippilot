import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryGenerationState,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryPlanPage } from './ItineraryPlanPage';

/**
 * TRIP-337 · AC-4 확정 예방 잠금을 **실 HTTP 로** 태우는 심판.
 *
 * 무엇을 보장하나:
 *  - 🔴 `generationState==='PARTIAL'` 이면 확정 CTA 가 **비활성**이고 "만드는 중" 사유가 뜨며,
 *    **눌러도 확정 요청이 한 건도 안 나간다**(계약: PARTIAL 동안 확정은 409 — 눌러 409 받는
 *    죽은 활성 버튼을 미리 막는다). 지금은 `ItineraryPlanPage` 가 generationState 를 화면에
 *    넘기지도 않아 CTA 가 무조건 활성이다 — 이 간극이 AC-4 다.
 *  - `COMPLETE` 면 CTA 가 다시 활성이고 눌리면 요청이 실제로 나간다(잠금은 PARTIAL 에서만).
 *
 * 왜 통합 버킷인가: 핵심 단언이 **"눌러도 확정 요청이 안 나갔다"**(POST 0건)다 — 순수함수·화면
 * 단독으로는 못 잰다. 훅을 목킹하면 그 계수가 테스트의 *가정*이 되어 틀려도 아무도 모른다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고 확정 CTA 를 누른다 → 단언=비활성·사유·나간 요청.
 */

// 지도는 이 칸의 심판 대상이 아니다 — WebView 실물이 뜨지 않게만 막는다(선례 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물
// 로드를 피하려면 목킹한다(선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

/** 3일 여행(06-10 → 06-12). status 는 항상 PLANNED — 확정 CTA 가 뜨는 조건. */
function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/**
 * 확정 CTA 가 뜨려면 `resolvePlanState` 가 'listed' 여야 하고(=슬롯 있는 days), status 가
 * CONFIRMED 가 아니어야 한다. day1 슬롯 하나만 담아 그 조건을 만든다 — 곳 수·카드 모양은
 * 이 칸의 심판이 아니다. `generationState`·`status` 는 케이스가 정한다.
 */
function itinerary(input: {
  generationState: ItineraryGenerationState;
  status?: ItineraryStatus;
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: input.status ?? 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState,
    isFallback: false,
    days: [
      {
        date: DAY1,
        slots: [
          {
            poiId: 'poi-a',
            startAt: '09:30:00',
            endAt: '11:00:00',
            isFixed: false,
            endsNextDay: false,
            hasViolation: false,
            tags: [],
            nameKo: '성산일출봉',
          },
        ],
      },
    ],
  };
}

/** POST /confirm 이 몇 번 처리됐나 — press 가 확정 요청을 발화시켰는지의 유일한 심판. */
let confirmPostCalls = 0;
/** GET /itinerary 응답을 케이스가 정한다(PARTIAL · COMPLETE). */
let itineraryHandler: () => Response;
/** POST /confirm 응답을 케이스가 정한다(계약: PARTIAL 이면 409, 정상 확정이면 200 CONFIRMED). */
let confirmHandler: () => Response;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  confirmPostCalls = 0;
  mockBack.mockClear();
  setAccessToken('valid-access');
  itineraryHandler = () =>
    HttpResponse.json(itinerary({ generationState: 'COMPLETE' }));
  confirmHandler = () =>
    HttpResponse.json(
      itinerary({ generationState: 'COMPLETE', status: 'CONFIRMED' })
    );

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
      confirmPostCalls += 1;
      return confirmHandler();
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false` — 실패를 즉시 실패로(재시도가 돌면 요청 개수 단언이 흔들린다).
 * `gcTime:0` — 기본 타이머가 테스트 종료 후에도 프로세스를 붙잡는 것 방지. */
function renderPage() {
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
  return render(<ItineraryPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** press(동기) 후 mutate(비동기) 가 한 틱 돌 시간을 준다 — "그래도 요청이 안 나갔다"를 재려면 필요. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('🔴 A4-1 · AC-4 — PARTIAL 이면 확정이 잠긴다 (D2·D3 · 계약 409 · ★2·★4)', () => {
  it('확정 CTA 가 비활성이고 "만드는 중" 사유가 뜨며, 눌러도 확정 요청이 0건이다', async () => {
    // 준비 — 생성 진행 중(PARTIAL)인데 확정 상태축은 아직 PLANNED. 계약상 확정은 409.
    itineraryHandler = () =>
      HttpResponse.json(
        itinerary({ generationState: 'PARTIAL', status: 'PLANNED' })
      );
    confirmHandler = () => new HttpResponse(null, { status: 409 });

    renderPage();

    // ① 비활성 — `toBeDisabled()` 는 accessibilityState 만 켜도 통과하므로(02a M1) 단독으로는
    //    "회색인데 눌리는" 구현을 통과시킨다. 아래 ③(요청 0건)과 짝을 이뤄야 심판이 된다(★2).
    const cta = await screen.findByTestId('itinerary-confirm-cta');
    await waitFor(() => expect(cta).toBeDisabled());

    // ② 침묵 잠금 아님(INV-4) — 사유가 뜬다. 문안은 정본에 없어 정규식(계열)으로만 잠근다
    //    (문자열로 걸면 완전 일치라 정당한 문안이 red — 02a M4).
    const notice = await screen.findByTestId('itinerary-confirm-locked-notice');
    expect(notice).toHaveTextContent(/만드는 중/);

    // ③ ★ 핵심 — 눌러도 확정 요청이 **한 건도 안 나간다**. 죽은 활성 버튼(눌러 409만 받음)이
    //    아니다. accessibilityState 만 켠 가짜 비활성은 press 가 살아 있어 여기서 red 가 된다.
    fireEvent.press(cta);
    await sleep(50);
    expect(confirmPostCalls).toBe(0);
  });
});

describe('🔴 A4-2 · AC-4 — COMPLETE 면 확정이 다시 활성이다 (필수 짝 · ★1·★4)', () => {
  it('확정 CTA 가 활성이고 사유가 없으며, 누르면 확정 요청이 1건 나간다', async () => {
    // 준비 — status 는 A4-1 과 **똑같이 PLANNED**, generationState 만 COMPLETE 로 바뀐다.
    // 이 대조가 "잠금은 generationState 축에서만 갈린다"를 못박는다(★4).
    itineraryHandler = () =>
      HttpResponse.json(
        itinerary({ generationState: 'COMPLETE', status: 'PLANNED' })
      );
    confirmHandler = () =>
      HttpResponse.json(
        itinerary({ generationState: 'COMPLETE', status: 'CONFIRMED' })
      );

    renderPage();

    // ① 활성 — A4-1 을 만족시키려 CTA 를 무조건 비활성화하는 과잉 구현을 여기서 죽인다.
    const cta = await screen.findByTestId('itinerary-confirm-cta');
    await waitFor(() => expect(cta).toBeEnabled());

    // ② 잠금 사유는 없다(COMPLETE 는 잠글 이유가 없다).
    expect(screen.queryAllByTestId('itinerary-confirm-locked-notice')).toEqual(
      []
    );

    // ③ 실제로 눌리면 확정 요청이 나간다 — 항상 비활성인 구현을 죽인다.
    fireEvent.press(cta);
    await waitFor(() => expect(confirmPostCalls).toBe(1));
  });
});
