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
import { useItineraryEditStore } from '@/features/itinerary/model/itineraryEditStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  fireEditDragEnd,
  fireEditDropOnZone,
} from '@/test-support/editDragList';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-921 · h12 편집기 드래그 실배선 — 페이지가 **리스트 onDragEnd 한 번**을 받아 저장 PUT 까지
 * 싣는지를 실 HTTP(msw)로 태우는 심판. 옛 R2 는 드래그 UI 가 없어 스토어를 직접 재정렬했지만, 이제
 * 편집 뷰(위젯)가 `react-native-draggable-flatlist` 를 쥐므로 **리스트 경유**로 발화한다.
 *
 * 무엇을 보장하나:
 *  - 🟢 E0 헤더 날짜 괄호형 `6월 10일(수)` — 뷰가 widgets 로 가며 포맷을 못 하게 돼(features 금지)
 *    페이지가 문자열을 만든다. 뷰 V1 이 재던 포맷 판정의 이관처(02a ★8, 현재 green 이 유지돼야 한다).
 *  - 🔴 E1 AC-6 끌어 바꾼 순서가 PUT `days[0].slots` 순서가 된다(INV-U3-02).
 *  - 🔴 E2·E3 AC-7 고정 슬롯은 끌기 결과가 어떻든 원래 절대 index 에 남는다(TRIP-302 엣지1 —
 *    `reorderKeepingLocked` → 스토어 `reorderKeepingFixed` 사슬).
 *  - 🔴 E4 AC-8 드롭존(리스트 끝 센티널 뒤)에 놓은 곳은 곳수에서 빠지고 PUT 에 없다.
 *  - 🔴 E5 AC-3 ② 고정 카드는 드롭존에 억지로 놓여도 안 지워진다(뷰 심층 방어 → 저장까지).
 *
 * ⚠️ 실제 롱프레스·손가락 이동·놓을 자리 계산은 jest 사각(목) — 6-b 실기(AC-15).
 * 3동작 뼈대: 준비=가짜 서버(GET 한 날) → 실행=리스트 onDragEnd·저장 press → 단언=곳수·PUT 순서.
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

// 편집 뷰가 조립하는 MapSheetShell → MapView(네이버 네이티브)는 jest 에서 못 뜬다 — 관찰 목.
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY = '2026-06-10';

const SAVE = 'sheet-cta-button-0';
const META = 'sheet-header-meta';

function slot(
  poiId: string,
  startAt: string,
  isFixed = false
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt: `${String(Number(startAt.slice(0, 2)) + 1).padStart(2, '0')}:00:00`,
    isFixed,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    nameKo: `장소-${poiId}`,
  };
}

/** a·b·c 비고정 3곳. */
const PLAIN = [
  slot('a', '09:00:00'),
  slot('b', '11:00:00'),
  slot('c', '13:00:00'),
];
/** a · F(고정, 숙소 등) · b · c — 고정이 index 1 에 있다. */
const WITH_FIXED = [
  slot('a', '09:00:00'),
  slot('F', '11:00:00', true),
  slot('b', '13:00:00'),
  slot('c', '15:00:00'),
];

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: DAY,
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

function itinerary(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [{ date: DAY, slots }],
  };
}

let putCalls = 0;
let putBody: unknown = null;
let daySlots: ItineraryDaysItemSlotsItem[] = PLAIN;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putCalls = 0;
  putBody = null;
  daySlots = PLAIN;
  setAccessToken('valid-access');
  // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 재정렬·삭제가 새지 않게 비운다(02a ★10).
  useItineraryEditStore.getState().reset();

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itinerary(daySlots))
    ),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json({ visits: [] })
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return HttpResponse.json(itinerary(daySlots));
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

/** 첫 슬롯 카드가 뜰 때까지 기다린다 — 시드는 GET 도착 뒤다. */
async function ready(): Promise<void> {
  await screen.findByTestId(`slot-stopcard-${buildSlotKey(DAY, 'a')}`);
}

async function saveAndReadOrder(): Promise<string[]> {
  fireEvent.press(screen.getByTestId(SAVE));
  await waitFor(() => expect(putCalls).toBe(1));
  return (putBody as EditItineraryRequest).days[0].slots.map((s) => s.poiId);
}

describe('E0 · 그물 이관 — 헤더 날짜는 페이지가 괄호형으로 만든다 (TRIP-921 AC-12 · 02a ★8)', () => {
  it('2026-06-10 활성 일자의 헤더 날짜가 "6월 10일(수)" 이다', async () => {
    renderPage();
    await ready();

    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 10일(수)'
    );
  });
});

describe('🔴 E1 · AC-6 — 끌어서 바꾼 순서가 저장 PUT 순서가 된다 (INV-U3-02)', () => {
  it('c 를 맨 앞으로(2→0) 끌고 저장하면 PUT 순서가 [c,a,b] 다', async () => {
    renderPage();
    await ready();

    fireEditDragEnd(2, 0);

    expect(await saveAndReadOrder()).toEqual(['c', 'a', 'b']);
  });
});

describe('🔴 E2·E3 · AC-7 — 고정 슬롯은 원래 절대 index 에 남는다 (TRIP-302 엣지1)', () => {
  it('c 를 맨 앞으로(3→0) 끌면 [c,a,F,b] 가 오지만 저장은 F 를 index 1 로 되돌린 [c,F,a,b] 다', async () => {
    daySlots = WITH_FIXED;
    renderPage();
    await ready();

    fireEditDragEnd(3, 0);

    const order = await saveAndReadOrder();
    expect(order).toEqual(['c', 'F', 'a', 'b']);
    expect(order.indexOf('F')).toBe(1);
  });

  it('고정 F 를 억지로 맨 앞(1→0)에 놓아도 저장 순서는 원래 [a,F,b,c] 다', async () => {
    daySlots = WITH_FIXED;
    renderPage();
    await ready();

    fireEditDragEnd(1, 0);

    expect(await saveAndReadOrder()).toEqual(['a', 'F', 'b', 'c']);
  });
});

describe('🔴 E4 · AC-8 — 드롭존에 놓은 곳은 곳수에서 빠지고 PUT 에 없다', () => {
  it('b 를 드롭존에 놓으면 헤더가 2곳이 되고 저장 PUT 은 [a,c] 다', async () => {
    renderPage();
    await ready();
    expect(screen.getByTestId(META)).toHaveTextContent('3곳');

    fireEditDropOnZone(1);

    expect(screen.getByTestId(META)).toHaveTextContent('2곳');
    expect(await saveAndReadOrder()).toEqual(['a', 'c']);
  });
});

describe('🔴 E5 · AC-3 ② — 고정 카드는 드롭존에 억지로 놓여도 안 지워진다', () => {
  it('F 를 드롭존에 강제로 놓아도 헤더는 4곳 그대로고 저장 PUT 에 F 가 있다', async () => {
    daySlots = WITH_FIXED;
    renderPage();
    await ready();

    fireEditDropOnZone(1);

    expect(screen.getByTestId(META)).toHaveTextContent('4곳');
    expect(await saveAndReadOrder()).toEqual(['a', 'F', 'b', 'c']);
  });
});
