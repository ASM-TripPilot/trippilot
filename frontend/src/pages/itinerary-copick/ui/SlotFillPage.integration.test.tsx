import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItem,
  SlotCandidatesRequest,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { SlotFillPage } from './SlotFillPage';

/**
 * h13→h14/h15 슬롯 채우기 배선 — 슬라이스1 코어(POST 후보 → swapSlotPoi 치환 → PUT 전체교체)를
 * 컨셉/반경 앞단과 잇는다. 찬 슬롯 "변경" 경로로 잰다(빈 슬롯 스켈레톤은 계약 미결 · 코드 경로 동일).
 *
 * 무엇을 보장하나:
 *  - AC-1: 후보 조회는 usePostTripsTripIdItinerarySlotCandidates(slotKey+concept+radiusM)만.
 *  - AC-2: 컨셉 라벨이 concept 로 실림 · 스킵=concept 미전송(undefined).
 *  - AC-3: 라디오 → "A로 선택" → swapSlotPoi+PUT 1건(같은 치환) → 성공만 이동.
 *  - AC-4: 반경 max → radiusM=null 재요청 · 서버 radiusMUsed → 화면 포맷 표시.
 *  - AC-5: 후보 0건 → 반경확대(재조회)·컨셉변경(h13 복귀) CTA 배선.
 *  - AC-8: 저장 실패 인라인(resolveSlotSwapError).
 *  - E1: 콜드캐시 가드(GET 미도착 중 확정 → PUT 0). firedRef: 같은 틱 연타 → PUT 1.
 *
 * 3동작: 준비=MSW 응답 → 실행=컨셉·반경·라디오·확정 → 단언=나간 요청 바디·이동.
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

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
}));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY1 = '2026-06-10';
const SLOT_KEY = buildSlotKey(DAY1, 'a');

function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
    {
      date: DAY1,
      slots: [
        {
          poiId: 'a',
          nameKo: '경복궁',
          startAt: '09:30:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
        {
          poiId: 'b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
  ];
  return {
    itineraryId: 'itin-2',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'CO_PLAN',
    generationState: 'COMPLETE',
    isFallback: false,
    days,
  };
}

// 테스트별로 바꿔 끼우는 후보 응답(핸들러 클로저가 요청 시점에 읽는다).
let candidatesResponse: {
  candidates: { poiId: string; distanceRange: string; rationale: string }[];
  radiusMUsed: number;
};
let postCalls = 0;
let postBody: SlotCandidatesRequest | null = null;
let putCalls = 0;
let putBody: unknown = null;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postCalls = 0;
  postBody = null;
  putCalls = 0;
  putBody = null;
  mockBack.mockClear();
  mockPush.mockClear();
  candidatesResponse = {
    candidates: [
      { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
      { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
    ],
    radiusMUsed: 11300,
  };
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary())
    ),
    http.post(
      `${BASE}/trips/:tripId/itinerary/slot-candidates`,
      async ({ request }) => {
        postCalls += 1;
        postBody = (await request.json()) as SlotCandidatesRequest;
        return HttpResponse.json(candidatesResponse);
      }
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return HttpResponse.json(itinerary());
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<SlotFillPage tripId={TRIP_ID} slotKey={SLOT_KEY} />, {
    wrapper: Wrapper,
  });
}

async function pickConcept(key = 'culture') {
  await screen.findByTestId(`itinerary-copick-concept-${key}`);
  fireEvent.press(screen.getByTestId(`itinerary-copick-concept-${key}`));
}

describe('🔴 SlotFillPage (h13→h14/h15) 배선', () => {
  it('C1 · 마운트=컨셉 화면, 조회 POST 는 아직 0', async () => {
    renderPage();

    await screen.findByTestId('itinerary-copick-concept-root');
    expect(postCalls).toBe(0);
  });

  it('C2 · AC-1·AC-2 컨셉 탭 → slot-candidates POST 1건 · 바디에 slotKey·concept·radiusM', async () => {
    renderPage();
    await pickConcept('culture');

    await waitFor(() => expect(postCalls).toBe(1));
    expect(postBody?.slotKey).toBe(SLOT_KEY);
    expect(postBody?.concept).toBe('전시·문화');
    expect(postBody?.radiusM).toBe(1100); // 기본 mid 단계
  });

  it('C3 · AC-2 스킵 → concept 미전송(undefined)', async () => {
    renderPage();
    await screen.findByTestId('itinerary-copick-concept-skip');
    fireEvent.press(screen.getByTestId('itinerary-copick-concept-skip'));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(postBody?.concept).toBeUndefined();
    expect(postBody?.radiusM).toBe(1100);
  });

  it('C4 · AC-1·INV-1 렌더 후보 집합 = 응답 poiId 집합', async () => {
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    const poiIds = screen
      .getAllByTestId(
        /^itinerary-candidate-(?!radio-|name-|image-|distance-|rationale-|current$|select-)/
      )
      .map((node) => node.props.testID.replace('itinerary-candidate-', ''))
      .sort();
    expect(poiIds).toEqual(['X', 'Y']);
  });

  it('C5 · AC-3 라디오 → "A로 선택" → PUT 1건(같은 치환 a→X) → 성공만 이동', async () => {
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(putCalls).toBe(1));
    // 같은 치환 = swapSlotPoi 코어 재사용(BR-U3-23).
    expect((putBody as EditItineraryRequest).days[0].slots[0].poiId).toBe('X');
    // 성공만 이동(허브 복귀).
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it('C6 · AC-4 반경 max → radiusM=null 재요청', async () => {
    renderPage();
    await pickConcept('culture');
    await waitFor(() => expect(postCalls).toBe(1));

    fireEvent.press(screen.getByTestId('itinerary-copick-radius-seg-max'));

    await waitFor(() => expect(postCalls).toBe(2));
    expect(postBody?.radiusM).toBeNull(); // 3단째 = 명시적 null
  });

  it('C7 · AC-4 서버 radiusMUsed(11300) → 화면 "약 11.3km" 표시', async () => {
    renderPage();
    await pickConcept('culture');

    const used = await screen.findByTestId('itinerary-copick-radius-used');
    expect(used).toHaveTextContent('약 11.3km');
  });

  it('C8 · AC-5 후보 0건 → 반경확대(재조회)·컨셉변경(h13 복귀) 배선', async () => {
    candidatesResponse = { candidates: [], radiusMUsed: 1100 };
    renderPage();
    await pickConcept('culture');
    await waitFor(() => expect(postCalls).toBe(1));

    // 반경 확대 → 다음 단으로 재조회.
    fireEvent.press(await screen.findByTestId('itinerary-copick-zero-radius'));
    await waitFor(() => expect(postCalls).toBe(2));

    // 컨셉 변경 → h13 컨셉 화면 복귀.
    fireEvent.press(screen.getByTestId('itinerary-copick-zero-concept'));
    await screen.findByTestId('itinerary-copick-concept-root');
  });

  it('C9 · E1 콜드캐시 가드 — GET 미도착 중 확정 → PUT 0(빈 days 전체교체 방지)', async () => {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
        await delay('infinite');
        return HttpResponse.json(itinerary());
      })
    );
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X'); // POST 는 도착

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await waitFor(() => expect(postCalls).toBe(1));
    expect(putCalls).toBe(0);
    expect(mockBack).toHaveBeenCalledTimes(0);
  });

  it('C10 · firedRef — 같은 틱 확정 2회 연타여도 PUT 1건', async () => {
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    const confirm = await screen.findByTestId(
      'itinerary-copick-slotfill-confirm'
    );
    await waitFor(() =>
      expect(confirm.props.accessibilityState?.disabled).not.toBe(true)
    );

    act(() => {
      fireEvent.press(confirm);
      fireEvent.press(confirm);
    });

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(putCalls).toBe(1);
  });

  it('C11 · AC-8 저장 실패 → 인라인 오류 · 이동 0', async () => {
    server.use(
      http.put(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(
          { error: { code: 'X', message: 'x' } },
          { status: 500 }
        )
      )
    );
    renderPage();
    await pickConcept('culture');
    await screen.findByTestId('itinerary-candidate-radio-X');

    fireEvent.press(screen.getByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-copick-slotfill-confirm'));

    await screen.findByTestId('itinerary-copick-slotfill-error');
    expect(mockBack).toHaveBeenCalledTimes(0);
  });
});
