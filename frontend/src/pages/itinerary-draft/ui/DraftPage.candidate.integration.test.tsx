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
 * h11(DraftPage) 에 죽은 코드 `SlotCandidateSheetContainer`(h12)를 **트리거 배선**하는 심판을
 * 실 HTTP 로 태운다(TRIP-467). 컨테이너 내부(POST→선택→PUT→닫힘·재조회)는 이미
 * `SlotCandidateSheetContainer.integration.test.tsx` 9케이스로 완결 — 여기선 **트리거만** 잰다.
 *
 * 무엇을 보장하나(전부 페이지 층 배선):
 *  - 🔴 배선 전엔 시트가 없다 — 컨테이너는 **조건부 마운트**라 트리에 없고 POST 도 0(AC-4 · 죽은
 *    코드의 런타임 증거 · DraftPage 가 유일 마운트처).
 *  - 🔴 비고정 슬롯 트리거 press → 시트 마운트 + **그 슬롯의 slotKey** 로 slot-candidates POST 1건
 *    (AC-1 · 02a ★B). 바디는 slotKey 하나뿐(BR-U3-24 와이어).
 *  - 🔴 고정 슬롯은 트리거 부재라 열 방법이 없다(AC-2 · Q1 · 02a ★A).
 *  - 🔴 닫기 → 컨테이너 언마운트(AC-3 · editingSlotKey 클리어).
 *
 * 왜 통합 버킷인가: "시트가 열렸다/닫혔다" 는 조건부 마운트라 목 시트의 마운트/언마운트로만
 * 관찰된다(바텀시트 목=통과 컴포넌트, 02a §1-D). "어느 slotKey 로 POST 가 나갔나" 는 훅을
 * 목킹하면 테스트의 가정이 되므로 **실 요청**으로 잰다(slot-time 통합 선례).
 *
 * ⚠️ 동결 `DraftPage.integration.test.tsx`·`DraftScreen.test.tsx` 는 손대지 않는다(AC-5 무회귀,
 * 02a 함정①·②로 무영향 보장) — 이 파일은 별도 additive 스위트다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=트리거/닫기 press → 단언=시트 마운트·POST slotKey.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다 — 실물 로드
// 회피(DraftPage.integration 선례와 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// DraftPage 가 마운트에 `useRouter()` 를 부른다 — 목이 없으면 렌더가 죽는다. 이 파일은 라우팅을
// 안 누르지만 훅 존재만 필요(동결 파일과 동형 셋업).
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// 지도는 이 칸의 심판 대상이 아니다 — WebView 실물이 뜨지 않게만 막는다. 인라인 팩토리는
// NativeWind babel 호이스트에 걸리므로 모듈을 require(리포 선례와 동형).
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

/** slot-candidates 응답(컨테이너 자기 통합테스트와 같은 형태). */
const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
};

let postCalls = 0;
let postBody: unknown = null;

const SHEET = 'itinerary-candidate-sheet';

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

describe('🔴 I0 · AC-4 — 배선 전엔 시트가 없다 (죽은 코드 · DraftPage 가 유일 마운트처)', () => {
  it('아무 트리거도 누르기 전엔 컨테이너가 트리에 없고 slot-candidates POST 도 0건이다', async () => {
    renderPage();
    // 목록 얼굴이 떴다(긍정 앵커) — 비고정 카드가 실재해야 아래가 공허하지 않다.
    await screen.findByTestId(cardId('poi-a'));

    // 컨테이너는 조건부 마운트라 트리에 없다 — 마운트만으로 시트가 뜨거나 POST 가 새지 않는다.
    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 I1 · AC-1 — 비고정 트리거 press → 시트 마운트 + 그 slotKey 로 POST 1건', () => {
  it('poi-b 트리거를 누르면 시트가 뜨고 slot-candidates POST 가 poi-b 의 slotKey 로 나간다', async () => {
    renderPage();
    // 둘째(poi-b)를 눌러 첫 슬롯 하드코딩을 죽인다(02a ★B).
    fireEvent.press(await screen.findByTestId(altId('poi-b')));

    // 시트가 마운트된다(=조건부 마운트로 열림. 실열림·딤은 6-b 실기 · 02a 함정③).
    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();

    // 마운트된 컨테이너가 POST 를 1건 쏘고, 바디의 slotKey 가 눌린 그 슬롯이다.
    await waitFor(() => expect(postCalls).toBe(1));
    expect((postBody as { slotKey: string }).slotKey).toBe(
      buildSlotKey(DAY1, 'poi-b')
    );
    // 바디는 slotKey 하나뿐 — 제외목록·반경 없음(BR-U3-24 와이어 재확인).
    expect(Object.keys(postBody as object)).toEqual(['slotKey']);
  });
});

describe('🔴 I2 · AC-2 — 고정 슬롯은 트리거 부재라 열 방법이 없다 (Q1)', () => {
  it('고정 카드엔 트리거가 없고(비고정엔 있고) 시트도 안 뜬다', async () => {
    renderPage();
    await screen.findByTestId(cardId('poi-a'));

    // 부정 — 고정 슬롯 트리거 부재. `isFixed` 무관 렌더 뮤테이션은 여기서 red(★A).
    expect(screen.queryByTestId(altId('poi-fixed'))).toBeNull();
    // 긍정 짝 — 비고정엔 트리거가 있다.
    expect(screen.getByTestId(altId('poi-a'))).toBeOnTheScreen();
    // 누를 트리거가 없으니 시트도 없다.
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('🔴 I3 · AC-3 — 닫기 → 컨테이너 언마운트 (editingSlotKey 클리어)', () => {
  it('시트를 열고 닫기 버튼을 누르면 컨테이너가 트리에서 사라진다', async () => {
    renderPage();
    fireEvent.press(await screen.findByTestId(altId('poi-a')));
    await screen.findByTestId(SHEET);

    fireEvent.press(screen.getByTestId('itinerary-candidate-sheet-close'));

    // 조건부 마운트라 닫으면 트리에서 제거된다 — 다시 다른 슬롯을 열 수 있는 상태로 복귀.
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
  });
});
