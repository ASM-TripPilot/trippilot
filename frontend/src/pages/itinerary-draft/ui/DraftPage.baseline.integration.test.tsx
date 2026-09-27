import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { DRAFT_POLL_INTERVAL_MS } from '@/features/itinerary/model/draftView';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/generated/schemas';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1006 (C) · 초안 화면의 폴링 상한을 **이번 마운트부터** 센다(#084).
 *
 * 무엇이 문제였나: 폴링 횟수(`dataUpdateCount`)는 화면 것이 아니라 **캐시 속 쿼리 하나의 것**이라, 같은
 * 일정을 보는 모든 화면이 함께 올린다. 같이 짜기 화면이 생성 중(PARTIAL) 일정을 2초마다 수백 번 부른
 * 뒤 초안 화면이 새로 열리면, 카운터는 이미 상한(30)을 넘어 있다. 초안 화면이 0부터 셌기 때문에 열자마자
 * "상한 도달"로 판정해 **폴링을 아예 시작하지 않았고**, 서버가 생성을 끝내도 화면은 "생성 중"에 멈췄다.
 *
 * 무엇을 보장하나:
 *  - 🔴 C1 캐시 카운터가 이미 31인 상태에서 열려도 폴링을 시작하고, 서버가 COMPLETE 를 내면 결과
 *    얼굴(h08 — 확정 CTA 바)로 넘어간다.
 *  - 🟢 C2 (회귀) 이번 마운트 뒤 PARTIAL 이 30회 쌓이면 여전히 멈춘다 — 상한을 없애는 식으로 C1 을
 *    고치면 여기서 red(02a ★9).
 *
 * *(개념)* `setQueryData` — 서버를 안 거치고 캐시에 응답을 직접 넣는다. 넣을 때마다 그 쿼리의
 *   `dataUpdateCount` 가 1씩 오른다(02a §5). 다른 화면이 폴링으로 올린 카운터를 이걸로 흉내 낸다.
 *
 * 3동작: 준비 = 캐시 카운터를 미리 올리고 서버 응답 순서를 정한다 → 실행 = 초안 화면을 연다 →
 *   단언 = 얼굴이 넘어가는가 / 요청 수가 멈췄는가.
 */

jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

// 지도는 심판 대상이 아니다 — 관찰 마커로 바꾼다(DraftPage.partial 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '66666666-6666-6666-6666-666666666666';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const ITINERARY_KEY = getGetTripsTripIdItineraryQueryKey(TRIP_ID);

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 2일',
    startDate: DAY1,
    endDate: DAY2,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function day(date: string): ItineraryDaysItem {
  return {
    date,
    slots: [
      {
        poiId: `poi-${date}`,
        nameKo: '광안리 해변',
        category: '자연',
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: [],
        imageUrl: null,
        distanceRange: null,
        lat: 35.153,
        lng: 129.118,
      },
    ],
  };
}

/** PARTIAL 은 1일차만, COMPLETE 는 2일 전부. */
function itinerary(generationState: ItineraryGenerationState): Itinerary {
  return {
    itineraryId: 'itin-baseline',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState,
    isFallback: false,
    days: generationState === 'PARTIAL' ? [day(DAY1)] : [day(DAY1), day(DAY2)],
  };
}

let getCalls = 0;
/** GET 번호(1부터)를 받아 응답할 생성 상태를 정한다. */
let stateForCall: (call: number) => ItineraryGenerationState;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  getCalls = 0;
  stateForCall = () => 'PARTIAL';
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      getCalls += 1;
      return HttpResponse.json(itinerary(stateForCall(getCalls)));
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `gcTime: Infinity` — 마운트 전에 채운 캐시가 관찰자 없이 다음 틱에 지워지면 카운터가 0부터
 * 다시 시작해 옛 코드도 통과한다(거짓 green, 02a ★7). */
function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: 0 },
    },
  });
}

function renderDraft(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('🔴 C1 · 다른 화면이 이미 올린 카운터 위에서 열려도 폴링한다 (#084)', () => {
  it('캐시 카운터 31에서 열려도 다시 조회해 COMPLETE 를 받고 결과 얼굴로 넘어간다', async () => {
    // 준비 ① 같이 짜기 화면이 PARTIAL 을 31번 받아 둔 캐시를 흉내 낸다.
    const client = newClient();
    for (let i = 0; i < 31; i += 1) {
      client.setQueryData(ITINERARY_KEY, itinerary('PARTIAL'));
    }
    // 준비 자가검사 — 카운터가 정말 상한(30)을 넘었다(아니면 이 테스트는 아무것도 못 가른다).
    expect(client.getQueryState(ITINERARY_KEY)?.dataUpdateCount).toBe(31);
    // 준비 ② 서버는 첫 조회엔 아직 PARTIAL, 그다음부터 COMPLETE.
    stateForCall = (call) => (call === 1 ? 'PARTIAL' : 'COMPLETE');

    // 실행
    renderDraft(client);

    // 단언 ① 처음엔 캐시의 "생성 중" 얼굴(h07 진행 카드).
    await screen.findByTestId('generation-progress-card');
    // 단언 ② 폴링이 돌아 COMPLETE 를 받고 결과 얼굴(h08 확정 CTA 바)로 넘어간다.
    await waitFor(
      () => expect(screen.queryByTestId('sheet-cta-root')).not.toBeNull(),
      { timeout: DRAFT_POLL_INTERVAL_MS * 3 }
    );
    expect(screen.queryByTestId('generation-progress-card')).toBeNull();
    expect(getCalls).toBeGreaterThanOrEqual(2);
  }, 20000);
});

describe('🟢 C2 · (회귀) 이번 마운트 뒤 30회가 쌓이면 여전히 멈춘다', () => {
  it('마운트 뒤 PARTIAL 응답이 30회를 넘기면 한 간격이 지나도 GET 이 더 나가지 않는다', async () => {
    // 준비 — 빈 캐시에서 연다. 서버는 영영 PARTIAL(2차 생성이 멈춘 상황).
    const client = newClient();
    renderDraft(client);
    await screen.findByTestId('generation-progress-card');
    await waitFor(() => expect(getCalls).toBeGreaterThanOrEqual(1));

    // 실행 — 이번 마운트 뒤 30회 더 받은 것으로 만든다(60초를 기다리지 않으려고, 02a ★8).
    act(() => {
      for (let i = 0; i < 30; i += 1) {
        client.setQueryData(ITINERARY_KEY, itinerary('PARTIAL'));
      }
    });
    const callsAtCap = getCalls;

    // 단언 — 한 간격 넘게 흘려도 조회가 늘지 않는다(상한이 살아 있다).
    // act 로 감싸는 이유: 캐시 변경 알림이 다음 틱에 도착해 화면을 다시 그린다 — act 밖이면 경고가 난다.
    await act(async () => {
      await sleep(DRAFT_POLL_INTERVAL_MS + 400);
    });
    expect(getCalls).toBe(callsAtCap);
  }, 20000);
});
