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
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * h11(DraftPage) 에 h12 슬롯 교체를 **인라인 패널**로 배선하는 심판(TRIP-467→483 이관). 컨테이너
 * 내부(POST→선택→PUT→닫힘·재조회)는 `SlotCandidatePanelContainer.integration.test.tsx` 가
 * 완결 — 여기선 **트리거·토글·인라인 배치·manual 어포던스** 페이지 층 배선만 잰다.
 *
 * 무엇을 보장하나(전부 페이지 층 배선):
 *  - 🔴 배선 전엔 패널이 없다 — 조건부 마운트라 트리에 없고 POST 0(AC-1).
 *  - 🔴 비고정 트리거 press → **인라인 패널 마운트**(`itinerary-candidate-panel`) + 그 slotKey 로
 *    slot-candidates POST 1건(AC-1 · ★B). 바디는 slotKey 하나뿐(BR-U3-24).
 *  - 🔴 고정 슬롯은 트리거 부재라 열 방법이 없다(AC-2).
 *  - 🔴 X 로 닫힘 · **같은 트리거 재press 로 토글 접힘**(AC-1 · ★C).
 *  - 🔴 「처음부터 직접」·「직접 고르기」 → manual 라우트 push(AC-4).
 *
 * 왜 통합 버킷인가: "패널이 열렸다/닫혔다" 는 조건부 마운트라 마운트/언마운트로 관찰된다(인라인
 * 패널은 일반 View 라 열림/접힘이 jest 로 보인다 · 02a §1-D). "어느 slotKey 로 POST 가 나갔나" 는
 * 훅을 목킹하면 테스트의 가정이 되므로 **실 요청**으로 잰다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=트리거/닫기/manual press → 단언=마운트·POST·push.
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

// manual 라우트 push 를 관찰하려면 모듈 스코프 목이 필요하다(호이스트 가드 회피 위해 `mock` 접두).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/kakaoMapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

/** 1일 여행 — 탭 흔들림·폴링을 피한다(generationState COMPLETE 라 폴링 없음). */
function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 하루',
    startDate: DAY1,
    endDate: DAY1,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 0 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** day1 = [고정 숙소(21:00) · 비고정 a · 비고정 b]. 고정은 트리거가 없어야 한다. */
function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'poi-fixed',
          startAt: '21:00:00',
          endAt: '22:00:00',
          isFixed: true,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
          nameKo: '제주 신라스테이',
        },
        {
          poiId: 'poi-a',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: ['바다'],
          nameKo: '성산일출봉',
        },
        {
          poiId: 'poi-b',
          startAt: '12:30:00',
          endAt: '13:30:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
          nameKo: '광안리',
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
  degraded: false,
};

let postCalls = 0;
let postBody: unknown = null;

const PANEL = 'itinerary-candidate-panel';

function altId(poiId: string): string {
  return `itinerary-draft-alt-${buildSlotKey(DAY1, poiId)}`;
}
function cardId(poiId: string): string {
  return `itinerary-draft-slot-${buildSlotKey(DAY1, poiId)}`;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postCalls = 0;
  postBody = null;
  mockPush.mockClear();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        postCalls += 1;
        postBody = await request.json();
        return HttpResponse.json(CANDIDATES);
      }
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

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
  return render(<DraftPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

describe('🔴 D1 · AC-1 — 배선 전엔 패널이 없다 (조건부 마운트 · DraftPage 가 유일 마운트처)', () => {
  it('아무 트리거도 누르기 전엔 패널이 트리에 없고 slot-candidates POST 도 0건이다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    expect(screen.queryByTestId(PANEL)).toBeNull();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 D2 · AC-1 — 비고정 트리거 press → 인라인 패널 마운트 + 그 slotKey 로 POST 1건', () => {
  it('poi-b 트리거를 누르면 패널이 뜨고 slot-candidates POST 가 poi-b 의 slotKey 로 나간다', async () => {
    renderPage();
    fireEvent.press(await screen.findByTestId(altId('poi-b')));

    expect(await screen.findByTestId(PANEL)).toBeOnTheScreen();

    await waitFor(() => expect(postCalls).toBe(1));
    expect((postBody as { slotKey: string }).slotKey).toBe(
      buildSlotKey(DAY1, 'poi-b')
    );
    expect(Object.keys(postBody as object)).toEqual(['slotKey']);
  });
});

describe('🔴 D3 · AC-2 — 고정 슬롯은 트리거 부재라 열 방법이 없다', () => {
  it('고정 카드엔 트리거가 없고(비고정엔 있고) 패널도 안 뜬다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    expect(screen.queryByTestId(altId('poi-fixed'))).toBeNull();
    expect(screen.getByTestId(altId('poi-a'))).toBeOnTheScreen();
    expect(screen.queryByTestId(PANEL)).toBeNull();
  });
});

describe('🔴 D4 · AC-1 — 닫기 X → 패널 언마운트 (editingSlotKey 클리어)', () => {
  it('패널을 열고 닫기 버튼을 누르면 패널이 트리에서 사라진다', async () => {
    renderPage();
    fireEvent.press(await screen.findByTestId(altId('poi-a')));
    await screen.findByTestId(PANEL);

    fireEvent.press(screen.getByTestId('itinerary-candidate-panel-close'));

    await waitFor(() => expect(screen.queryByTestId(PANEL)).toBeNull());
  });
});

describe('🔴 D5 · AC-1 — 같은 트리거 재press 로 토글 접힘 (한 번에 한 슬롯 · ★C)', () => {
  it('poi-a 트리거를 눌러 열고, 다시 눌러 접는다', async () => {
    renderPage();
    const trigger = await screen.findByTestId(altId('poi-a'));

    fireEvent.press(trigger);
    await screen.findByTestId(PANEL);

    // 같은 트리거 재press → 접힘. `setEditingSlotKey(k)`(재대입) 구현은 안 닫혀 여기서 red.
    fireEvent.press(screen.getByTestId(altId('poi-a')));
    await waitFor(() => expect(screen.queryByTestId(PANEL)).toBeNull());
  });
});

describe('🔴 D6 · AC-4 — 「처음부터 직접」·「직접 고르기」 → manual 라우트 push', () => {
  it('두 어포던스 모두 /trips/[tripId]/itinerary/manual 로 push 한다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    const expected = {
      pathname: '/trips/[tripId]/itinerary/manual',
      params: { tripId: TRIP_ID },
    };

    fireEvent.press(screen.getByTestId('itinerary-draft-manual'));
    expect(mockPush).toHaveBeenLastCalledWith(expected);

    fireEvent.press(screen.getByTestId('itinerary-draft-pick-manual'));
    expect(mockPush).toHaveBeenLastCalledWith(expected);
    expect(mockPush).toHaveBeenCalledTimes(2);
  });
});
