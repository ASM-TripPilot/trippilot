import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/features/itinerary/model/slotKey';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * h24 편집 배선을 **실 HTTP 로** 태우는 심판(슬라이스1).
 *
 * 무엇을 보장하나:
 *  - GET → **편집 스토어 시드** → 활성 날 슬롯을 카드로 나열(AC1·AC5).
 *  - 🔴 **삭제·재정렬은 로컬 편집 스토어만 갱신한다 — mutation 0**(엣지5 · AC3·AC4). "서버·GET 캐시를
 *    안 건드림"을 훅 호출수가 아니라 **HTTP 실건수**로 잰다(리렌더마다 훅은 다시 불린다, 02a ★7):
 *    `PUT /itinerary` 실건수 0 · `GET /itinerary` 재조회 없음(첫 1건 그대로).
 *  - 🔴 **저장 press 는 슬라이스1에서 무동작**(AC6) — PUT 이 나가지 않는다(배선은 슬라이스2).
 *
 * 왜 통합 버킷인가: 심판의 핵심이 **어떤 요청이 몇 건 나갔나**다. 훅을 목킹하면 "편집이 서버를
 * 안 건드린다"가 테스트의 *가정*이 되어, 그 가정이 틀려도 아무도 모른다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=열고 삭제/재정렬/저장 → 단언=나간 요청·보이는 것.
 */

// 생성 클라이언트의 인증 계층이 expo-secure-store 를 정적으로 문다 — 실물 로드를 피해 목킹(h25 선례).
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

// 드래그 리스트는 네이티브 런타임 의존 → 수동 목 활성(카드 렌더 + onDragEnd 호스트 노출, 02a ★5).
jest.mock('react-native-draggable-flatlist');

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

const cardId = (date: string, poiId: string) =>
  `itinerary-edit-slot-${buildSlotKey(date, poiId)}`;

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY1,
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** day1 = [a, b](둘 다 비고정), day2 = [c]. */
function itinerary(): Itinerary {
  const days: ItineraryDaysItem[] = [
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
        },
        {
          poiId: 'poi-b',
          startAt: '13:00:00',
          endAt: '14:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
        },
      ],
    },
    {
      date: DAY2,
      slots: [
        {
          poiId: 'poi-c',
          startAt: '10:00:00',
          endAt: '11:00:00',
          isFixed: false,
          endsNextDay: false,
          hasViolation: false,
          tags: [],
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

/** GET /itinerary 처리 횟수 — 편집(삭제·재정렬) 뒤에도 안 늘어야 한다(재조회 0). */
let itineraryGetCalls = 0;
/** PUT /itinerary 처리 횟수 — 슬라이스1은 저장 미배선이라 **항상 0**이어야 한다(엣지5 mutation 0). */
let putCalls = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  itineraryGetCalls = 0;
  putCalls = 0;
  mockBack.mockClear();
  setAccessToken('valid-access');
  // 편집 스토어는 모듈 싱글턴 — 테스트 사이 값이 새므로 초기화(store 선례).
  useItineraryEditStore.getState().reset();

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      itineraryGetCalls += 1;
      return HttpResponse.json(itinerary());
    }),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => {
      putCalls += 1;
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
  return render(<ItineraryEditPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

/** 카드 래퍼만 트리 순서로 — 하위 testID(no-·time-·name-·delete-·handle-·alt-·fixed-)는 제외(02a ★6). */
function cardOrder(): string[] {
  return screen
    .getAllByTestId(
      /^itinerary-edit-slot-(?!no-|time-|name-|delete-|handle-|alt-|fixed-)/
    )
    .map((node) => String(node.props.testID));
}

describe('🔴 II1 · AC1·AC5 — GET → 스토어 시드 → 활성 날 렌더', () => {
  it('day1 슬롯이 카드로 뜨고 곳 수가 나오며, 첫 조회는 1건이다', async () => {
    renderPage();

    await screen.findByTestId(cardId(DAY1, 'poi-a'));
    expect(screen.getByTestId(cardId(DAY1, 'poi-b'))).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-day-count')).toHaveTextContent(
      /2곳/
    );

    await waitFor(() => expect(itineraryGetCalls).toBe(1));
    // 짝 — 저장은 나가지 않았다.
    expect(putCalls).toBe(0);
  });
});

describe('🔴 II2 · AC3·엣지5 — 삭제는 로컬만 갱신한다 (mutation 0)', () => {
  it('휴지통 press → 카드·곳수가 즉시 갱신되고, PUT 0 · GET 재조회 없음', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-b'));

    fireEvent.press(
      screen.getByTestId(
        `itinerary-edit-slot-delete-${buildSlotKey(DAY1, 'poi-b')}`
      )
    );

    // 카드가 사라지고 곳 수가 줄어든다(로컬 편집 스토어 갱신).
    await waitFor(() =>
      expect(screen.queryAllByTestId(cardId(DAY1, 'poi-b'))).toEqual([])
    );
    expect(screen.getByTestId('itinerary-edit-day-count')).toHaveTextContent(
      /1곳/
    );

    // ★7 — 서버·GET 캐시를 안 건드린다: PUT 0, GET 재조회 없음(첫 1건 그대로).
    expect(putCalls).toBe(0);
    expect(itineraryGetCalls).toBe(1);
  });
});

describe('🔴 II3 · AC4·엣지5 — 재정렬은 로컬만 갱신한다 (mutation 0)', () => {
  it('onDragEnd({data:[b,a]}) → 카드 순서가 [b,a] 로 바뀌고, PUT 0 · GET 재조회 없음', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));

    // 처음엔 [a, b] 순서.
    expect(cardOrder()).toEqual([cardId(DAY1, 'poi-a'), cardId(DAY1, 'poi-b')]);

    const days = itinerary().days[0].slots;
    const reordered = [days[1], days[0]]; // [b, a]
    const list = screen.getByTestId('itinerary-edit-list');
    act(() => {
      (list.props as { onDragEnd: (p: unknown) => void }).onDragEnd({
        data: reordered,
        from: 1,
        to: 0,
      });
    });

    // 배열 순서 = 슬롯 순서(INV-U3-02) — [b, a] 로 재정렬.
    await waitFor(() =>
      expect(cardOrder()).toEqual([
        cardId(DAY1, 'poi-b'),
        cardId(DAY1, 'poi-a'),
      ])
    );

    expect(putCalls).toBe(0);
    expect(itineraryGetCalls).toBe(1);
  });
});

describe('🔴 II4 · AC6·엣지5 — 저장 press 는 슬라이스1에서 무동작', () => {
  it('저장하기 press 후에도 PUT 0 이고 카드 목록은 불변이다', async () => {
    renderPage();
    await screen.findByTestId(cardId(DAY1, 'poi-a'));

    fireEvent.press(screen.getByTestId('itinerary-edit-save'));

    // 미배선이라 저장이 나가지 않고(엣지5), 편집 상태도 그대로다.
    expect(putCalls).toBe(0);
    expect(cardOrder()).toEqual([cardId(DAY1, 'poi-a'), cardId(DAY1, 'poi-b')]);
  });
});
