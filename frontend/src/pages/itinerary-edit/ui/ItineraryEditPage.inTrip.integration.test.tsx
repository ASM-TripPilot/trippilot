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
  ItineraryStatus,
  Trip,
  VisitCheckList,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { fireEditDragEnd } from '@/test-support/editDragList';

import { ItineraryEditPage } from './ItineraryEditPage';

/**
 * TRIP-753 · i07 일정 편집 — 여행 중 [직접 수정] 진입(`planb/manual` 라우트)이 h12 편집 페이지를
 * `inTrip` 으로 그대로 재사용한다. 이 파일은 그 모드에서 페이지 배선이 실제 HTTP 로 도는지 본다.
 *
 * 무엇을 보장하나:
 *  - 🔴 P1 페이지가 `inTrip` 을 뷰까지 내린다 — 카드 사이 + 가 없고 안내가 i07 문구다(AC-7).
 *    방문 기록으로 완료 행이 잠긴다(AC-4, 잠금 배선 자체는 h12 CL1 과 같다).
 *  - P2 예정 행 ⌄ → 시각 시트 → 적용 → 저장 PUT 에 바뀐 시각이 실린다(AC-5).
 *  - 🔴 P3 끌기 결과가 와도 완료 행은 제자리다 — 규칙(`reorderKeepingLocked`)을 거쳐 저장된다(AC-8).
 *  - P4 확정된 일정(여행 중)에 저장하면 409 → "확정된 일정은 수정할 수 없어요" 가 뜨고 화면은
 *    떠나지 않는다(AC-9 · INV-4). 라우터 네 방법(back·push·replace·navigate)을 모두 본다.
 *
 * ⚠️ 드래그 제스처는 jest 사각(traps-draglist) — TRIP-921 부터 편집 뷰가 드래그 리스트를 쥐므로,
 * 목 리스트의 `onDragEnd` 를 라이브러리와 같은 배열 이동으로 발화한다(`@/test-support/editDragList`).
 *
 * 3동작 뼈대: 준비=가짜 서버(일정·방문·저장) → 실행=열고 누르거나 콜백 발화 → 단언=화면·나간 요청.
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
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
  }),
}));

jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY = '2026-06-11';

const k = (poiId: string): string => buildSlotKey(DAY, poiId);
const SAVE = 'sheet-cta-button-0';
const SHEET = 'itinerary-edit-time-sheet';
const I07_GUIDE =
  '방문한 곳은 그대로 두고, 길게 눌러 순서를 바꾸거나 아래로 끌어 삭제해요';

function slot(
  poiId: string,
  startAt: string,
  endAt: string,
  nameKo: string
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    nameKo,
  };
}

const SLOTS: ItineraryDaysItemSlotsItem[] = [
  slot('p1', '09:30:00', '10:30:00', '감천문화마을'),
  slot('p2', '11:00:00', '12:00:00', '광안리 해변'),
  slot('p3', '13:00:00', '14:30:00', '부산시립미술관'),
  slot('p4', '15:00:00', '16:30:00', '전포 카페거리'),
  slot('p5', '17:00:00', '18:30:00', '해운대 해변'),
];

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

function itinerary(status: ItineraryStatus = 'PLANNED'): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [{ date: DAY, slots: SLOTS }],
  };
}

/** p1·p2 는 도착·완료(건너뜀 아님) — `deriveVisitProgress` 가 완료로 잡는다. */
function visits(): VisitCheckList {
  const done = (poiId: string, hour: string) => ({
    visitCheckId: `vc-${poiId}`,
    poiId,
    source: 'MANUAL' as const,
    spontaneous: false,
    updatedAt: `2026-06-11T${hour}:50:00.000Z`,
    arrivedAt: `2026-06-11T${hour}:00:00.000Z`,
    completedAt: `2026-06-11T${hour}:40:00.000Z`,
    skippedAt: null,
  });
  return { visits: [done('p1', '00'), done('p2', '02')] };
}

let putCalls = 0;
let putBody: unknown = null;
let getHandler: () => Response;
let putHandler: () => Response;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putCalls = 0;
  putBody = null;
  [mockBack, mockPush, mockReplace, mockNavigate].forEach((fn) =>
    fn.mockClear()
  );
  setAccessToken('valid-access');
  // 편집 스토어는 모듈 싱글턴 — 앞 케이스의 재정렬이 새지 않게 비운다(02a ★19).
  useItineraryEditStore.getState().reset();
  getHandler = () => HttpResponse.json(itinerary());
  putHandler = () => HttpResponse.json(itinerary());

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => getHandler()),
    http.get(`${BASE}/trips/:tripId/visits/days/:day`, () =>
      HttpResponse.json(visits())
    ),
    http.put(`${BASE}/trips/:tripId/itinerary`, async ({ request }) => {
      putCalls += 1;
      putBody = await request.json();
      return putHandler();
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
  return render(<ItineraryEditPage tripId={TRIP_ID} inTrip />, {
    wrapper: Wrapper,
  });
}

/** 방문 기록이 도착해 완료 행이 잠길 때까지 기다린다 — 잠금 목록은 비동기 조회에서 온다(02a ★9). */
async function waitForLocked(): Promise<void> {
  await screen.findByTestId(`slot-stopcard-locked-${k('p1')}`);
}

function putOrder(): string[] {
  const body = putBody as EditItineraryRequest;
  return body.days[0].slots.map((s) => s.poiId);
}

describe('🔴 P1 · AC-7·4 — 페이지가 inTrip 을 뷰로 내리고, 완료 행은 잠긴다', () => {
  it('카드 사이 + 0개 · i07 안내 문구 · 5곳 · 완료 p1·p2 는 누름 칩 없음 · 예정 p3 는 있음', async () => {
    renderPage();
    await waitForLocked();

    expect(screen.queryAllByTestId(/^itinerary-edit-insert-/)).toHaveLength(0);
    expect(screen.getByTestId('itinerary-edit-guide')).toHaveTextContent(
      I07_GUIDE
    );
    expect(screen.getByTestId('sheet-header-meta')).toHaveTextContent('5곳');

    expect(
      screen.queryByTestId(`slot-stopcard-timechip-${k('p1')}`)
    ).toBeNull();
    expect(
      screen.queryByTestId(`slot-stopcard-timechip-${k('p2')}`)
    ).toBeNull();
    expect(
      screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`)
    ).toBeOnTheScreen();

    // 완료 알약을 눌러도 시각 시트가 열리지 않는다(03b 경고-1 — press 불가를 직접 잠근다).
    fireEvent.press(screen.getByTestId(`slot-stopcard-locked-${k('p1')}`));
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('P2 · AC-5 — 예정 행 ⌄ → 시각 시트 → 적용값이 저장 PUT 에 실린다', () => {
  it('p3 를 14:00–15:30 으로 바꿔 저장하면 PUT 의 p3 시각이 바뀌고 완료 p1 은 그대로다', async () => {
    renderPage();
    await waitForLocked();

    // 열기 전엔 시트가 없다(조건부 마운트).
    expect(screen.queryByTestId(SHEET)).toBeNull();
    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('p3')}`));
    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-14'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-end-h-15'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

    expect(
      screen.getByTestId(`slot-stopcard-time-${k('p3')}`)
    ).toHaveTextContent('14:00–15:30');

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    const body = putBody as EditItineraryRequest;
    const p3 = body.days[0].slots.find((s) => s.poiId === 'p3');
    const p1 = body.days[0].slots.find((s) => s.poiId === 'p1');
    expect(p3?.startAt).toBe('14:00:00');
    expect(p3?.endAt).toBe('15:30:00');
    expect(p1?.startAt).toBe('09:30:00');
  });
});

describe('🔴 P3 · AC-8 — 끌기 결과가 와도 방문 완료 행은 제자리로 저장된다', () => {
  it('p5 를 맨 앞으로 끌면(4→0) 리스트는 [p5,p1,p2,p3,p4] 지만 저장 PUT 순서는 [p1,p2,p5,p3,p4]', async () => {
    renderPage();
    await waitForLocked();

    // TRIP-921 — 뷰 콜백을 꺼내 직접 부르던 옛 방식 대신 **리스트 onDragEnd 경유**(실제 배선 경로).
    // 한 번의 끌기로 나올 수 있는 배열만 쓴다(옛 임의 순열은 실경로에서 안 나온다, 02 기존 테스트 변경).
    fireEditDragEnd(4, 0);

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    // 완료 p1·p2 는 index 0·1 그대로, 나머지 칸이 끌기 순서(p5,p3,p4)로 채워진다.
    expect(putOrder()).toEqual(['p1', 'p2', 'p5', 'p3', 'p4']);
  });
});

describe('P4 · AC-9 — 확정된 일정에 저장하면 409 안내가 뜨고 화면은 떠나지 않는다', () => {
  it('PUT 409 + 재조회 CONFIRMED → save-error 완전일치 · 라우터 네 방법 0회', async () => {
    getHandler = () => HttpResponse.json(itinerary('CONFIRMED'));
    putHandler = () => new HttpResponse(null, { status: 409 });

    renderPage();
    await waitForLocked();

    fireEvent.press(screen.getByTestId(SAVE));
    await waitFor(() => expect(putCalls).toBe(1));

    expect(
      await screen.findByTestId('itinerary-edit-save-error')
    ).toHaveTextContent('확정된 일정은 수정할 수 없어요');

    // 누른 뒤에도, 실패 뒤에도 어디로도 가지 않는다(752 경고-1 — navigate 포함 네 방법).
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
