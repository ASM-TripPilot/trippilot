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
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import { getGetTripsTripIdItineraryQueryKey } from '@/shared/api/generated/trips/trips';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';
import { WithToastHost, resetToast } from '@/test-support/toastHarness';

import { ManualPlanPage } from './ManualPlanPage';

/**
 * TRIP-1038 B (#032 · US-SCHED-12 · 결정 1=(ii)) — 직접 짜기 편집기의 CTA 는 「저장하고 확정하기」다.
 * 누르면 저장(PUT) → 확정(POST /confirm) → 확정 화면(h16, /trips/[tripId]/itinerary)으로 바꿔 간다.
 *
 * 무엇을 보장하나:
 *  - 🔴 B1 라벨 · B2 순서(PUT 성공 뒤에만 확정)·확정 응답을 캐시에 써넣기·위저드 비우기·h16 replace.
 *  - B3 PUT 이 실패하면 확정을 부르지 않고 제자리에서 저장 실패를 알린다(INV-4).
 *  - 🔴 B4 확정이 실패하면 이동하지 않고 확정 실패를 알린다. 저장은 됐으니 저장 토스트는 뜬다(01 Q3).
 *    409 면 서버 상태가 바뀌었을 수 있어 일정을 한 번 다시 조회하고, 500 이면 다시 조회하지 않는다.
 *  - 🔴 B5 2왕복 동안 연타해도 PUT·확정은 1번씩이다.
 *  - 🔴 B8 확정 응답이 오기 전에 화면을 떠나도 확정 결과는 캐시에 남고, 떠난 사람을 h16 으로 끌고 가지 않는다
 *    (호출별 콜백은 언마운트 뒤 안 불린다 — traps-itinerary).
 *
 * 3동작 뼈대: 준비=가짜 서버(MANUAL 초안 a·b, PUT·확정 핸들러) → 실행=CTA press → 단언=요청 순서·라우터·캐시·안내.
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '55555555-5555-5555-5555-555555555555';
const DAY = '2026-06-10';

/** 첫 조회·2왕복 사슬 대기 한도 — 로컬 1000ms 의 CI 러너(약 4배 느림) 환산. */
const WAIT = { timeout: 4000 };

const CTA = 'sheet-cta-button-0';
const SAVE_ERROR = 'itinerary-manual-save-error';
const CONFIRM_ERROR = 'itinerary-manual-confirm-error';
const SAVED_TOAST = 'itinerary-manual-saved';
/** TRIP-1047 — 확정 토스트(h16 `ItineraryPlanPage` 와 같은 testID·문구). */
const CONFIRMED_TOAST = 'itinerary-confirmed-toast';
const H16 = {
  pathname: '/trips/[tripId]/itinerary',
  params: { tripId: TRIP_ID },
};

function slot(poiId: string, startAt: string): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt,
    endAt: `${String(Number(startAt.slice(0, 2)) + 1).padStart(2, '0')}:00:00`,
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
  };
}

function manualDraft(status: Itinerary['status'] = 'PLANNED'): Itinerary {
  return {
    itineraryId: 'itin-m',
    tripId: TRIP_ID,
    status,
    solveMode: 'MINIMAL',
    generationMode: 'MANUAL',
    generationState: 'COMPLETE',
    isFallback: false,
    days: [
      { date: DAY, slots: [slot('a', '09:00:00'), slot('b', '11:00:00')] },
    ],
  };
}

/** 요청 도착 순서 — PUT 이 먼저 끝나야 확정이 나간다(B2). */
let requestLog: string[] = [];
let itineraryGets = 0;
let putCalls = 0;
let confirmCalls = 0;
let putHandler: () => Response;
let confirmHandler: () => Response | Promise<Response>;

/** 확정 응답을 붙잡아 두는 문 — "서버엔 도착했고 응답은 아직" 인 순간을 만든다(02a ★5). */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  requestLog = [];
  itineraryGets = 0;
  putCalls = 0;
  confirmCalls = 0;
  [mockPush, mockBack, mockReplace].forEach((fn) => fn.mockClear());
  setAccessToken('valid-access');
  // 모듈 싱글턴 두 개 — 편집 스토어(시드)와 위저드 스토어(B2 가 비워졌는지 본다).
  useItineraryEditStore.getState().reset();
  useTripWizardStore.getState().reset();
  putHandler = () => HttpResponse.json(manualDraft());
  confirmHandler = () => HttpResponse.json(manualDraft('CONFIRMED'));

  server.use(
    http.get(`${BASE}/trips/:tripId/itinerary`, () => {
      itineraryGets += 1;
      return HttpResponse.json(manualDraft());
    }),
    http.get(`${BASE}/trips/:tripId/bases`, () => HttpResponse.json([])),
    http.put(`${BASE}/trips/:tripId/itinerary`, () => {
      putCalls += 1;
      requestLog.push('PUT');
      return putHandler();
    }),
    http.post(`${BASE}/trips/:tripId/itinerary/confirm`, () => {
      confirmCalls += 1;
      requestLog.push('CONFIRM');
      return confirmHandler();
    })
  );
});

// 토스트 스토어는 모듈 싱글턴이다 — describe 안이 아니라 파일 최상위에서 비운다(02a ★11).
afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
  resetToast();
  useTripWizardStore.getState().reset();
});

afterAll(() => server.close());

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      // gcTime 을 0 으로 두면 B8 에서 언마운트(관찰자 0) 뒤 캐시 항목이 곧바로 치워져 "캐시에 남았다"를
      // 잴 수 없다. Infinity 는 치우기 타이머 자체를 안 건다(테스트마다 새 클라이언트라 새지 않는다).
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: 0 },
    },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <WithToastHost>
        <ManualPlanPage tripId={TRIP_ID} />
      </WithToastHost>
    </QueryClientProvider>
  );
  return { ...utils, client };
}

async function ready(): Promise<void> {
  await screen.findByTestId(
    `slot-stopcard-${buildSlotKey(DAY, 'a')}`,
    {},
    WAIT
  );
}

/** 요청은 비동기다 — 흘려 보낸 뒤에 세야 "더 안 나갔다"가 뜻을 갖는다(02a ★4). */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe('🔴 B1 · #032 — 직접 짜기 편집기의 CTA 는 「저장하고 확정하기」다', () => {
  it('슬롯이 있으면 CTA 글자가 저장하고 확정하기(완전일치)이고 누를 수 있다', async () => {
    renderPage();
    await ready();

    expect(screen.getByTestId(CTA)).toHaveTextContent('저장하고 확정하기');
    expect(screen.getByTestId(CTA)).toBeEnabled();
  });
});

describe('🔴 B2 · 결정 1(ii) — 저장 성공 뒤에만 확정하고, 확정되면 확정 화면(h16)으로 바꿔 간다 (US-SCHED-12)', () => {
  it('PUT → 확정 순서 · replace h16 1회 · 캐시가 CONFIRMED · 위저드가 비워진다 · push/back 0', async () => {
    // 준비 — 위저드에 이 여행의 흔적을 남겨 둔다(원래 빈 값이면 "비웠다"가 공허 — 02a ★12).
    useTripWizardStore.setState({ budgetText: '50만원' });
    const { client } = renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(H16);
    expect(requestLog).toEqual(['PUT', 'CONFIRM']);
    expect(
      client.getQueryData<Itinerary>(
        getGetTripsTripIdItineraryQueryKey(TRIP_ID)
      )?.status
    ).toBe('CONFIRMED');
    expect(useTripWizardStore.getState().budgetText).toBe('');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('B3 · INV-4 — 저장(PUT)이 실패하면 확정을 부르지 않고 제자리에서 알린다 (선제 green · 사슬 회귀 트립와이어)', () => {
  it('PUT 500 → 저장 실패 안내 · 확정 0 · 라우터 0 · 확정 실패 안내 없음', async () => {
    putHandler = () => new HttpResponse(null, { status: 500 });
    renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));

    expect(await screen.findByTestId(SAVE_ERROR, {}, WAIT)).toBeOnTheScreen();
    await flush();
    expect(confirmCalls).toBe(0);
    expect(screen.queryByTestId(CONFIRM_ERROR)).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('🔴 B4 · INV-4 — 확정이 실패하면 이동하지 않고 확정 실패를 알린다', () => {
  it('확정 500 → 확정 실패 안내(비공백) · 저장 토스트는 뜬다 · 라우터 0 · 재조회 0 · 저장 실패 안내 없음', async () => {
    confirmHandler = () => new HttpResponse(null, { status: 500 });
    renderPage();
    await ready();
    // 앵커 — 저장 전엔 토스트가 없다(뒤의 토스트가 이번 저장 몫임을 가른다).
    expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();

    fireEvent.press(screen.getByTestId(CTA));

    expect(
      await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
    ).toHaveTextContent(/\S/);
    expect(screen.getByTestId(SAVED_TOAST)).toBeOnTheScreen();
    // TRIP-1047 AC-5 — 확정이 실패했으니 확정 토스트는 없다(INV-4).
    expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
    expect(screen.queryByTestId(SAVE_ERROR)).toBeNull();
    await flush();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(1);
    // 500 은 상태가 안 바뀌었다 — 다시 조회하지 않는다(첫 조회 1건 그대로 · ItineraryPlanPage 선례).
    expect(itineraryGets).toBe(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('확정 409 → 확정 실패 안내 · 라우터 0 · 일정을 한 번 다시 조회한다(서버 상태가 바뀌었을 수 있다)', async () => {
    confirmHandler = () =>
      HttpResponse.json(
        { code: 'CONFLICT', message: '이미 확정됨' },
        { status: 409 }
      );
    renderPage();
    await ready();
    expect(itineraryGets).toBe(1);

    fireEvent.press(screen.getByTestId(CTA));

    expect(
      await screen.findByTestId(CONFIRM_ERROR, {}, WAIT)
    ).toBeOnTheScreen();
    await waitFor(() => expect(itineraryGets).toBe(2), WAIT);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    // TRIP-1047 AC-5 — 409 는 확정 실패다. 재조회 뒤에도 확정 토스트는 없다.
    expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();
  });
});

/**
 * TRIP-1047 AC-1 (편집기 경로 · 01b) — 편집기의 「저장하고 확정하기」도 "확정한 그 순간"이다. 확정 POST 가
 * 성공하면 h16 으로 떠나기 전에 같은 확정 토스트를 띄운다. 토스트는 루트 호스트가 그리므로 화면이 바뀌어도
 * 남는다. h16(`ItineraryPlanPage`)은 캐시에 이미 CONFIRMED 가 든 채 새로 열려 재진입과 구별이 안 되므로,
 * 여기서 안 띄우면 이 경로엔 확정 알림이 없다. 한 번에 하나라 앞서 뜬 저장 토스트는 확정 토스트로 바뀐다.
 *
 * 3동작 뼈대: 준비=PUT 200·확정 200 → 실행=CTA press → 단언=replace·확정 토스트 문구·저장 토스트 교체.
 */
describe('🔴 T1 · TRIP-1047 AC-1 — 편집기에서 저장하고 확정하면 확정 토스트가 뜬다', () => {
  it('확정 성공 → h16 replace 1회 · "일정이 확정됐어요" 토스트 · 저장 토스트는 확정 토스트로 바뀐다', async () => {
    renderPage();
    await ready();
    // 앵커 — 확정 전엔 확정 토스트가 없다.
    expect(screen.queryByTestId(CONFIRMED_TOAST)).toBeNull();

    fireEvent.press(screen.getByTestId(CTA));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(H16);
    expect(await screen.findByTestId(CONFIRMED_TOAST)).toHaveTextContent(
      '일정이 확정됐어요'
    );
    expect(screen.queryByTestId(SAVED_TOAST)).toBeNull();
    expect(confirmCalls).toBe(1);
  });
});

describe('🔴 B5 · 01 맹점 ⑥ — 저장+확정 2왕복 동안 연타해도 PUT·확정은 1번씩이다', () => {
  it('같은 틱에 두 번 누르면 PUT 1 · 확정 1 · replace 1', async () => {
    renderPage();
    await ready();

    // await 없이 연달아 — isPending 은 다음 렌더에야 true 라 이 창을 못 막는다(02a ★6).
    fireEvent.press(screen.getByTestId(CTA));
    fireEvent.press(screen.getByTestId(CTA));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    await flush();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('저장이 끝나고 확정 응답을 기다리는 동안 다시 눌러도 PUT·확정이 더 나가지 않는다', async () => {
    const door = gate();
    confirmHandler = async () => {
      await door.wait;
      return HttpResponse.json(manualDraft('CONFIRMED'));
    };
    renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));
    // 확정 요청이 서버에 도착했다 = PUT 은 끝났다. 이 틈이 "저장만 끝난" 창이다.
    await waitFor(() => expect(confirmCalls).toBe(1), WAIT);

    fireEvent.press(screen.getByTestId(CTA));
    fireEvent.press(screen.getByTestId(CTA));
    await flush();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(1);

    door.open();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    await flush();
    expect(putCalls).toBe(1);
    expect(confirmCalls).toBe(1);
  });
});

describe('🔴 B8 · traps-itinerary — 확정 응답 전에 화면을 떠나도 확정 결과는 캐시에 남고, 떠난 사람을 끌고 가지 않는다', () => {
  it('확정 대기 중 언마운트 → 응답 도착 뒤 캐시 status CONFIRMED · replace 0', async () => {
    const door = gate();
    confirmHandler = async () => {
      await door.wait;
      return HttpResponse.json(manualDraft('CONFIRMED'));
    };
    const { client, unmount } = renderPage();
    await ready();

    fireEvent.press(screen.getByTestId(CTA));
    await waitFor(() => expect(confirmCalls).toBe(1), WAIT);

    // 실행 — 확정 응답을 기다리는 사이 사용자가 떠났다(‹·스와이프 뒤로).
    unmount();
    door.open();

    // 캐시 쓰기는 훅 옵션(mutation.onSuccess)이라 언마운트 뒤에도 돈다 — 일정 탭 카드가 확정을 안다.
    await waitFor(
      () =>
        expect(
          client.getQueryData<Itinerary>(
            getGetTripsTripIdItineraryQueryKey(TRIP_ID)
          )?.status
        ).toBe('CONFIRMED'),
      WAIT
    );
    // 이동은 화면에 딸린 일이다 — 이미 떠난 사람을 h16 으로 끌고 가지 않는다(02a ★5).
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
