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
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  EditItineraryRequest,
  Itinerary,
  ItineraryDaysItemSlotsItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import {
  EDIT_LIST,
  fireEditDragEnd,
  fireEditDropOnZone,
} from '@/test-support/editDragList';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-921 · AC-9 — h12 직접 짜기(`ManualPlanPage`)가 **h12 편집(`ItineraryEditPage`)과 같은 위젯 편집
 * 뷰**를 소비하고, 그 뷰가 띄우는 표면(드래그·⌄ 시각칩·저장 CTA)이 전부 실제로 동작하는지 실 HTTP(msw)로
 * 태운다. 배선이 없으면 이 티켓이 없애려던 "받기만 하고 아무도 안 부르는" 표면이 직접 짜기 쪽에 재발한다
 * (01b Q3 채택 — 스토어 시드·드래그·시각 시트·저장 PUT·INV-4 안내).
 *
 * 무엇을 보장하나:
 *  - 🔴 M1 위젯 뷰 소비(드래그 리스트 존재) + 헤더 날짜 괄호형 `6월 10일(수)`(옛 `· 수` 중점형 정합).
 *  - 🔴 M2·M3 끌어 바꾼 순서 / 드롭존 삭제가 저장 PUT 에 실린다(INV-U3-02, AC-6·AC-8 의 직접 짜기판).
 *  - 🔴 M4 ⌄ → 시각 시트(`itinerary-manual-time-*`) → 적용값이 PUT 에 실린다.
 *  - 🔴 M5·M6 저장 실패·미지정 제외를 침묵하지 않는다(INV-4) — 페이지 소유 안내 testID 2종.
 *  - 🔴 M7 장소 추가·카드 사이 +·뒤로가 라우터로 이어진다(옛 `itinerary-manual-add-place` 대체).
 *
 * MANUAL 생성 POST 가드(G-a1~a3·I2)는 `ManualPlanPage.integration.test.tsx` 가 계속 잠근다 — 여기선
 * GET 이 기존 초안(days>0)을 돌려줘 POST 가 나가지 않는 경로만 쓴다.
 *
 * ⚠️ 실제 롱프레스·손가락 이동은 jest 사각(목) — 6-b 실기(AC-15, `/itinerary/manual` 입구).
 * 3동작 뼈대: 준비=가짜 서버(MANUAL 초안 한 날) → 실행=끌기·누르기·저장 → 단언=화면·나간 요청·라우터.
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

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  router: { push: mockPush, back: mockBack, replace: mockReplace },
}));

jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const DAY = '2026-06-10';

const k = (poiId: string): string => buildSlotKey(DAY, poiId);
const SAVE = 'sheet-cta-button-0';
const META = 'sheet-header-meta';
const SHEET = 'itinerary-manual-time-sheet';
const SAVE_ERROR = 'itinerary-manual-save-error';
const UNSPECIFIED = 'itinerary-manual-unspecified-notice';

function slot(
  poiId: string,
  startAt: string | null,
  endAt: string
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    // 미지정(null)은 서버 계약상 non-nullable 이라 캐스트로 심는다(unspecified 테스트 선례).
    startAt: startAt as unknown as string,
    endAt,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    tags: [],
    nameKo: `장소-${poiId}`,
  };
}

/** a·b·c — c 는 P2 선례 시각(13:00–14:30)이라 시트에서 14시·15시로 바꾸면 14:00–15:30 이 된다(02a ★11). */
const PLAIN = [
  slot('a', '09:00:00', '10:00:00'),
  slot('b', '11:00:00', '12:00:00'),
  slot('c', '13:00:00', '14:30:00'),
];

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: DAY,
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 직접 짜기 초안 — (MANUAL, MINIMAL, false). days>0 이라 페이지가 생성 POST 를 쏘지 않는다. */
function manualDraft(slots: ItineraryDaysItemSlotsItem[]): Itinerary {
  return {
    itineraryId: 'itin-m',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'MINIMAL',
    generationMode: 'MANUAL',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [{ date: DAY, slots }],
  };
}

let putCalls = 0;
let putBody: unknown = null;
let daySlots: ItineraryDaysItemSlotsItem[] = PLAIN;
let putHandler: () => Response;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  putCalls = 0;
  putBody = null;
  daySlots = PLAIN;
  [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockClear());
  setAccessToken('valid-access');
  useItineraryEditStore.getState().reset();
  putHandler = () => HttpResponse.json(manualDraft(daySlots));

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(manualDraft(daySlots))
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
  return render(<ManualPlanPage tripId={TRIP_ID} />, { wrapper: Wrapper });
}

async function ready(): Promise<void> {
  await screen.findByTestId(`slot-stopcard-${k('a')}`);
}

async function save(): Promise<EditItineraryRequest> {
  fireEvent.press(screen.getByTestId(SAVE));
  await waitFor(() => expect(putCalls).toBe(1));
  return putBody as EditItineraryRequest;
}

const ids = (body: EditItineraryRequest): string[] =>
  body.days[0].slots.map((s) => s.poiId);

describe('🔴 M1 · AC-9 — 직접 짜기가 위젯 편집 뷰를 소비하고 헤더 날짜가 괄호형이다', () => {
  it('드래그 리스트가 있고 헤더가 "일정 편집 · 6월 10일(수) · 3곳" 조각이다', async () => {
    renderPage();
    await ready();

    expect(screen.getByTestId(EDIT_LIST)).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      '일정 편집'
    );
    expect(screen.getByTestId('sheet-header-date')).toHaveTextContent(
      '6월 10일(수)'
    );
    expect(screen.getByTestId(META)).toHaveTextContent('3곳');
  });
});

describe('🔴 M2 · AC-9 — 끌어서 바꾼 순서가 저장 PUT 순서가 된다 (INV-U3-02)', () => {
  it('c 를 맨 앞으로(2→0) 끌고 저장하면 PUT 순서가 [c,a,b] 다', async () => {
    renderPage();
    await ready();

    fireEditDragEnd(2, 0);

    expect(ids(await save())).toEqual(['c', 'a', 'b']);
  });
});

describe('🔴 M3 · AC-9 — 드롭존에 놓은 곳은 곳수에서 빠지고 PUT 에 없다', () => {
  it('b 를 드롭존에 놓으면 2곳이 되고 저장 PUT 은 [a,c] 다', async () => {
    renderPage();
    await ready();

    fireEditDropOnZone(1);

    expect(screen.getByTestId(META)).toHaveTextContent('2곳');
    expect(ids(await save())).toEqual(['a', 'c']);
  });
});

describe('🔴 M4 · AC-9 — ⌄ 시각칩 → 시각 시트 → 적용값이 저장 PUT 에 실린다', () => {
  it('c 를 14:00–15:30 으로 바꿔 저장하면 PUT 의 c 시각이 바뀌고 a 는 그대로다', async () => {
    renderPage();
    await ready();

    expect(screen.queryByTestId(SHEET)).toBeNull();
    fireEvent.press(screen.getByTestId(`slot-stopcard-timechip-${k('c')}`));
    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('itinerary-manual-time-start-h-14'));
    fireEvent.press(screen.getByTestId('itinerary-manual-time-end-h-15'));
    fireEvent.press(screen.getByTestId('itinerary-manual-time-apply'));
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());

    const body = await save();
    const c = body.days[0].slots.find((s) => s.poiId === 'c');
    const a = body.days[0].slots.find((s) => s.poiId === 'a');
    expect(c?.startAt).toBe('14:00:00');
    expect(c?.endAt).toBe('15:30:00');
    expect(a?.startAt).toBe('09:00:00');
  });
});

describe('🔴 M5 · AC-9 · INV-4 — 저장 실패는 침묵하지 않고 화면을 떠나지 않는다', () => {
  it('PUT 500 이면 저장 실패 안내가 완전일치 문구로 뜨고 라우터는 0회다', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderPage();
    await ready();

    await save();

    expect(await screen.findByTestId(SAVE_ERROR)).toHaveTextContent(
      '일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요'
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('🔴 M6 · AC-9 · INV-4 — 시간대 미지정 곳은 저장에서 빠진다고 알린다', () => {
  it('a + 미지정 u 를 저장하면 "1곳은 저장에서 빠졌어요" 안내가 뜨고 PUT 에 u 가 없다', async () => {
    daySlots = [slot('a', '09:00:00', '10:00:00'), slot('u', null, '11:00:00')];
    renderPage();
    await ready();

    const body = await save();

    expect(ids(body)).toEqual(['a']);
    expect(await screen.findByTestId(UNSPECIFIED)).toHaveTextContent(
      '시간대를 정하지 않은 1곳은 저장에서 빠졌어요'
    );
  });
});

describe('🔴 M6-2 · TRIP-923 · INV-4 — 안내의 개수는 실제로 빠진 곳 수다', () => {
  it('두 날에 걸친 미지정 u1·u2 를 저장하면 PUT 은 [[a],[]] 이고 안내가 "2곳" 문장과 완전 일치한다', async () => {
    // 1곳(M6)이면 개수를 상수 1 로 박아도 통과한다 — 2곳이 구별되는 최소값.
    // 두 날에 흩는다 — 한 날에만 두면 "보이는 날만 세기" 회귀(1곳)를 못 잡는다(편집 UN3 과 같은 장치).
    const twoDays: Itinerary = {
      ...manualDraft([]),
      days: [
        {
          date: DAY,
          slots: [
            slot('u1', null, '09:00:00'),
            slot('a', '10:00:00', '11:00:00'),
          ],
        },
        { date: '2026-06-11', slots: [slot('u2', null, '12:00:00')] },
      ],
    };
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(twoDays)
      )
    );
    putHandler = () => HttpResponse.json(twoDays);
    renderPage();
    await ready();

    const body = await save();

    // ids() 는 days[0] 만 본다 — 두 날 모두 확인한다(빈 날도 날짜는 남는다).
    expect(body.days.map((d) => d.slots.map((s) => s.poiId))).toEqual([
      ['a'],
      [],
    ]);
    expect(await screen.findByTestId(UNSPECIFIED)).toHaveTextContent(
      '시간대를 정하지 않은 2곳은 저장에서 빠졌어요'
    );
  });
});

describe('🔴 M6-0 · TRIP-923 · INV-4 — 미지정 0 이면 저장해도 안내가 없다 (짝)', () => {
  it('전부 지정된 a·b·c 를 저장하면 PUT 은 그대로 나가고 제외 안내는 뜨지 않는다', async () => {
    renderPage();
    await ready();

    // 저장을 끝낸 뒤에 부재를 본다 — 저장 전 부재는 아무것도 증명하지 않는다.
    expect(ids(await save())).toEqual(['a', 'b', 'c']);
    expect(screen.queryByTestId(UNSPECIFIED)).toBeNull();
  });
});

describe('🔴 M7 · AC-9 — 장소 추가·카드 사이 +·뒤로가 라우터로 이어진다', () => {
  it('장소 추가는 h13 말미, 카드 사이 + 는 선행 index, 뒤로는 back 을 부른다', async () => {
    renderPage();
    await ready();

    fireEvent.press(screen.getByTestId('itinerary-edit-add-place'));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/trips/[tripId]/itinerary/manual/add',
      params: { tripId: TRIP_ID },
    });

    fireEvent.press(screen.getByTestId('itinerary-edit-insert-0'));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/trips/[tripId]/itinerary/manual/add',
      params: { tripId: TRIP_ID, insertAfter: '0' },
    });

    fireEvent.press(screen.getByTestId('itinerary-edit-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 M8 · AC-9 · 5-b 경고-4 — 다른 여행의 남은 드래프트를 이 여행 편집기에 그리지 않는다', () => {
  it('여행 A 드래프트가 스토어에 남은 채 B(일정 없음 404)에 들어오면 A 카드 0 · 0곳 · 저장 눌러도 PUT 0', async () => {
    // 준비 — 편집 스토어는 모듈 싱글턴이고 프로덕션 어디서도 reset 하지 않는다. A 를 고치다 저장 없이
    //   나간 상태를 스토어에 직접 심는다(다른 날짜·다른 장소).
    useItineraryEditStore
      .getState()
      .seed([
        { date: '2026-07-01', slots: [slot('ax', '10:00:00', '11:00:00')] },
      ]);
    let postCalls = 0;
    server.use(
      http.get(
        `${BASE}/trips/:tripId/itinerary`,
        () => new HttpResponse(null, { status: 404 })
      ),
      http.post(`${BASE}/trips/:tripId/itinerary`, () => {
        postCalls += 1;
        return HttpResponse.json(manualDraft([]), { status: 201 });
      })
    );

    // 실행 — B 의 직접 짜기 진입(GET 404 → 조회 데이터가 끝내 없다 → 시드가 안 돈다).
    renderPage();
    await waitFor(() => expect(postCalls).toBe(1)); // GET 정착(404) 확인 — MANUAL POST 가 나갔다.

    // 단언 — A 의 카드가 안 보이고 곳수는 0, 저장을 눌러도 A 의 장소가 B 로 PUT 되지 않는다.
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen(); // 짝: 편집기는 떠 있다
    expect(screen.queryByText('장소-ax')).toBeNull();
    expect(screen.getByTestId(META)).toHaveTextContent('0곳');
    expect(screen.getByTestId(SAVE)).toBeDisabled();
    fireEvent.press(screen.getByTestId(SAVE));
    // PUT 은 비동기라 한 번 흘려 보낸 뒤 센다(누름이 요청을 냈다면 여기서 잡힌다).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(putCalls).toBe(0);
  });
});
