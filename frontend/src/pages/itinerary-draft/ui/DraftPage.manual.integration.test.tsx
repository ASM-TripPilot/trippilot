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
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItinerarySolveMode,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1038 — 직접 짠 일정(MANUAL)의 초안 얼굴과 「처음부터 직접 짜기」 비우기 확인을 실 HTTP 로 태운다.
 *
 * 무엇을 보장하나:
 *  - (A) MANUAL 초안은 「내 일정」이고 CTA 가 「편집하기」·「확정하기」다. 어떤 버튼으로도 AI 생성 POST 가
 *    나가지 않는다(QA #040 · BR-U3-18). MANUAL 인데 장소가 0곳이면 AI 빈 얼굴 대신 편집기로 보낸다.
 *    FULLY_AI·CO_PLAN 은 지금 그대로(무회귀).
 *  - (C) 셸 폴백 안내의 「처음부터 직접 짜기」는 곧장 가지 않고 비우기 확인을 먼저 띄운다(QA #036).
 *    계속 → 편집기에 `fresh:'1'` 을 실어 보낸다. 취소 → 셸 그대로. 확정된 일정에선 확인이 안 열린다.
 *    폴백 인터스티셜의 「직접 짜기」는 이번 범위 밖이라 지금 그대로다(01 Q7).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더·버튼 press → 단언=제목·CTA 글자·라우터 호출·POST 건수.
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
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';

/** 첫 조회 대기 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
const WAIT = { timeout: 4000 };

const SHELL = 'map-sheet-shell-root';
const TITLE = 'sheet-header-title';
const CTA0 = 'sheet-cta-button-0';
const CTA1 = 'sheet-cta-button-1';
const BANNER = 'itinerary-draft-fallback-banner';
const STALE = 'itinerary-draft-stale-failed';
const LINK = 'itinerary-draft-manual';
const RESET = 'itinerary-draft-manual-reset-confirm';
const RESET_CONTINUE = 'itinerary-draft-manual-reset-confirm-continue';
const RESET_CANCEL = 'itinerary-draft-manual-reset-confirm-cancel';

const MANUAL_ROUTE = '/trips/[tripId]/itinerary/manual';

const cardId = (poiId: string): string =>
  `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '강릉 2일',
    startDate: DAY1,
    endDate: DAY2,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '강릉', nights: 1 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function slot(
  poiId: string,
  over: Partial<ItineraryDaysItemSlotsItem> = {}
): ItineraryDaysItemSlotsItem {
  return {
    poiId,
    startAt: '09:30:00',
    endAt: '11:00:00',
    isFixed: false,
    endsNextDay: false,
    hasViolation: false,
    alternatives: [],
    tags: [],
    nameKo: `장소-${poiId}`,
    lat: 37.75,
    lng: 128.9,
    ...over,
  };
}

function itinerary(input: {
  generationMode: ItineraryGenerationMode;
  solveMode?: ItinerarySolveMode;
  isFallback?: boolean;
  generationState?: ItineraryGenerationState;
  status?: ItineraryStatus;
  days?: Itinerary['days'];
}): Itinerary {
  return {
    itineraryId: 'itin-1038',
    tripId: TRIP_ID,
    status: input.status ?? 'PLANNED',
    solveMode: input.solveMode ?? 'FULL_AI',
    generationMode: input.generationMode,
    generationState: input.generationState ?? 'COMPLETE',
    isFallback: input.isFallback ?? false,
    days: input.days ?? [
      {
        date: DAY1,
        slots: [
          slot('poi-a'),
          slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
        ],
      },
    ],
  };
}

/** 직접 짠 일정 — MANUAL 은 MINIMAL 인데 isFallback=false 다(실패가 아니라 선택 · traps-itinerary). */
function manual(over: Partial<Parameters<typeof itinerary>[0]> = {}) {
  return itinerary({
    generationMode: 'MANUAL',
    solveMode: 'MINIMAL',
    isFallback: false,
    ...over,
  });
}

/** 폴백 초안 — 인터스티셜이 먼저 잡고, 「기본 일정 보기」 뒤에 셸 폴백 얼굴(링크 있음)이 뜬다. */
function fallback(status: ItineraryStatus = 'PLANNED') {
  return itinerary({
    generationMode: 'FULLY_AI',
    solveMode: 'DETERMINISTIC',
    isFallback: true,
    status,
  });
}

let itineraryScript: () => Itinerary;
/** POST /trips/{tripId}/itinerary(생성·재생성) 건수 — 이 파일의 금지 단언 대부분이 이 값이다. */
let generatePosts = 0;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  generatePosts = 0;
  [mockPush, mockReplace, mockBack].forEach((fn) => fn.mockClear());
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryScript())
    ),
    http.post(`${BASE}/trips/:tripId/itinerary`, () => {
      generatePosts += 1;
      return HttpResponse.json(itineraryScript(), { status: 201 });
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

/** 누름 → mutate → fetch → msw 는 비동기다 — 흘려 보낸 뒤에 세야 "0건"이 뜻을 갖는다(02a ★4). */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

async function openFallbackShell(): Promise<void> {
  renderPage();
  fireEvent.press(
    await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
  );
  await screen.findByTestId(SHELL, {}, WAIT);
}

// ─── (A) MANUAL 초안 얼굴 ────────────────────────────────────────────────

describe('🔴 A1 · #040 — MANUAL 초안은 「내 일정」이고 CTA 가 「편집하기」·「확정하기」다 (US-SCHED-10 · BR-U3-11)', () => {
  it('제목 내 일정 · CTA 편집하기/확정하기 · AI 추천안·다시 짜기·기본 일정 글자 0 · 폴백 안내 0', async () => {
    itineraryScript = () => manual();

    renderPage();

    // 긍정 앵커 — 셸 카드가 떴다(로딩 중 공허 통과 방지).
    expect(
      await screen.findByTestId(cardId('poi-a'), {}, WAIT)
    ).toBeOnTheScreen();
    expect(screen.getByTestId(TITLE)).toHaveTextContent('내 일정');
    expect(screen.getByTestId(CTA0)).toHaveTextContent('편집하기');
    expect(screen.getByTestId(CTA1)).toHaveTextContent('확정하기');
    expect(screen.queryByText('AI 추천안')).toBeNull();
    expect(screen.queryByText('다시 짜기')).toBeNull();
    expect(screen.queryByText('기본 일정')).toBeNull();
    expect(screen.queryByTestId(BANNER)).toBeNull();
  });

  it('A1b · 일부 조회 실패(FAILED)여도 MANUAL 이면 「내 일정」·「편집하기」다 — 실패 안내는 그대로 붙는다', async () => {
    itineraryScript = () => manual({ generationState: 'FAILED' });

    renderPage();

    // 짝 — 실패 안내가 떠 있다(이 얼굴이 staleFailed 셸임을 확인).
    expect(await screen.findByTestId(STALE, {}, WAIT)).toBeOnTheScreen();
    expect(screen.getByTestId(TITLE)).toHaveTextContent('내 일정');
    expect(screen.getByTestId(CTA0)).toHaveTextContent('편집하기');
    expect(screen.queryByText('다시 짜기')).toBeNull();
  });
});

describe('🔴 A2 · 「편집하기」 — 기존 일정을 이어 편집하는 편집기로 간다 (POST 0 · TRIP-601 가드 a)', () => {
  it('push 1회 · 경로 manual · params 에 fresh 없음 · 생성 POST 0', async () => {
    itineraryScript = () => manual();
    renderPage();
    await screen.findByTestId(cardId('poi-a'), {}, WAIT);

    fireEvent.press(screen.getByTestId(CTA0));
    await flush();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: MANUAL_ROUTE,
      params: { tripId: TRIP_ID },
    });
    // toHaveBeenCalledWith 는 undefined 속성을 없는 것으로 본다 — fresh 가 어떤 값으로도 실리지 않았는지 따로 본다(02a ★2).
    expect(mockPush.mock.calls[0][0].params.fresh).toBeUndefined();
    expect(generatePosts).toBe(0);
  });
});

describe('🔴 A3 · BR-U3-18 — MANUAL 셸의 어떤 버튼을 눌러도 AI 생성 POST 가 나가지 않는다', () => {
  it('CTA 두 개와 ‹ 를 모두 눌러도 POST /trips/{tripId}/itinerary 는 0건이다', async () => {
    itineraryScript = () => manual();
    renderPage();
    await screen.findByTestId(cardId('poi-a'), {}, WAIT);

    fireEvent.press(screen.getByTestId(CTA0));
    fireEvent.press(screen.getByTestId(CTA1));
    fireEvent.press(screen.getByTestId('sheet-daychip-back'));
    await flush();

    expect(generatePosts).toBe(0);
  });
});

describe('A4 · 무회귀 — FULLY_AI·CO_PLAN 깨끗한 초안은 지금 그대로다 (선제 green)', () => {
  it.each<ItineraryGenerationMode>(['FULLY_AI', 'CO_PLAN'])(
    '%s — 제목 AI 추천안 · CTA 다시 짜기/확정하기',
    async (generationMode) => {
      itineraryScript = () => itinerary({ generationMode });

      renderPage();

      expect(
        await screen.findByTestId(cardId('poi-a'), {}, WAIT)
      ).toBeOnTheScreen();
      expect(screen.getByTestId(TITLE)).toHaveTextContent('AI 추천안');
      expect(screen.getByTestId(CTA0)).toHaveTextContent('다시 짜기');
      expect(screen.getByTestId(CTA1)).toHaveTextContent('확정하기');
    }
  );
});

describe('A5 · MANUAL 「확정하기」는 지금처럼 완성 일정(h14)으로 간다 (선제 green)', () => {
  it('push 1회 · 경로 /trips/[tripId]/itinerary · POST 0', async () => {
    itineraryScript = () => manual();
    renderPage();
    await screen.findByTestId(cardId('poi-a'), {}, WAIT);

    fireEvent.press(screen.getByTestId(CTA1));
    await flush();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/itinerary',
      params: { tripId: TRIP_ID },
    });
    expect(generatePosts).toBe(0);
  });
});

describe('🔴 A6 · 01 Q1 — MANUAL 인데 장소가 0곳이면 AI 빈 얼굴 대신 편집기로 보낸다', () => {
  it('replace 1회(manual · fresh 없음) · POST 0 · 「추천안」·「다시 만들기」·「AI가 일정을 짜요」 글자 0', async () => {
    itineraryScript = () =>
      manual({
        days: [
          { date: DAY1, slots: [] },
          { date: DAY2, slots: [] },
        ],
      });

    renderPage();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: MANUAL_ROUTE,
      params: { tripId: TRIP_ID },
    });
    expect(mockReplace.mock.calls[0][0].params.fresh).toBeUndefined();
    await flush();
    // 한 번만 보낸다(렌더마다 다시 부르지 않는다).
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(generatePosts).toBe(0);
    // 부분 일치는 정규식으로 — 문자열이면 완전 일치라 「아직 만들어진 추천안이 없어요」를 못 잡는다(02a ★1).
    expect(screen.queryByText(/추천안/)).toBeNull();
    expect(screen.queryByText('다시 만들기')).toBeNull();
    expect(screen.queryByText(/AI가 일정을 짜요/)).toBeNull();
  });
});

// ─── (C) 「처음부터 직접 짜기」 비우기 확인 ─────────────────────────────────

describe('🔴 C1 · #036 — 「처음부터 직접 짜기」는 곧장 가지 않고 비우기 확인을 먼저 띄운다 (BR-U3-18)', () => {
  it('확인 얼굴(제목·비우고 시작·취소)이 셸 대신 뜨고, 이 시점까지 라우터·POST 는 0이다', async () => {
    itineraryScript = () => fallback();
    await openFallbackShell();

    fireEvent.press(screen.getByTestId(LINK));

    expect(screen.getByTestId(RESET)).toBeOnTheScreen();
    expect(
      screen.getByText('지금 일정을 비우고 새로 짤까요?')
    ).toBeOnTheScreen();
    expect(screen.getByTestId(RESET_CONTINUE)).toHaveTextContent('비우고 시작');
    expect(screen.getByTestId(RESET_CANCEL)).toHaveTextContent('취소');
    // 얼굴 교체형 — 확인하는 동안 셸은 트리에 없다(조건부 오버레이는 jest 사각 · 02a ★14).
    expect(screen.queryByTestId(SHELL)).toBeNull();
    // 앱에 복원 화면이 없다 — 되돌릴 수 있다고 약속하지 않는다(01b).
    expect(screen.queryByText(/되돌릴 수/)).toBeNull();

    await flush();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(generatePosts).toBe(0);
  });
});

describe('🔴 C2 · 확인 「비우고 시작」 → 편집기에 비우기 신호(fresh=1)를 실어 보낸다', () => {
  it('push 1회 · { pathname: manual, params: { tripId, fresh: "1" } } · 초안 화면은 POST 0', async () => {
    itineraryScript = () => fallback();
    await openFallbackShell();
    fireEvent.press(screen.getByTestId(LINK));

    fireEvent.press(screen.getByTestId(RESET_CONTINUE));
    await flush();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: MANUAL_ROUTE,
      params: { tripId: TRIP_ID, fresh: '1' },
    });
    // 비우는 POST 는 편집기 몫이다(ManualPlanPage.fresh C3) — 초안 화면이 쏘지 않는다.
    expect(generatePosts).toBe(0);
  });
});

describe('🔴 C5 · 확인 「취소」 → 셸 그대로 (인터스티셜로 돌아가지 않는다)', () => {
  it('확인 얼굴이 사라지고 셸·폴백 안내가 보이며 인터스티셜은 없다 · 라우터·POST 0', async () => {
    itineraryScript = () => fallback();
    await openFallbackShell();
    fireEvent.press(screen.getByTestId(LINK));
    expect(screen.getByTestId(RESET)).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(RESET_CANCEL));

    expect(screen.queryByTestId(RESET)).toBeNull();
    expect(screen.getByTestId(SHELL)).toBeOnTheScreen();
    expect(screen.getByTestId(BANNER)).toBeOnTheScreen();
    expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();
    expect(screen.queryByTestId('itinerary-fallback-root')).toBeNull();
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
    expect(generatePosts).toBe(0);
  });
});

describe('C6 · 01 Q7 — 폴백 인터스티셜의 「직접 짜기」는 이번 범위 밖이라 지금 그대로다 (선제 green)', () => {
  it('확인 없이 fresh 없는 manual push 1회', async () => {
    itineraryScript = () => fallback();
    renderPage();

    fireEvent.press(
      await screen.findByTestId('itinerary-fallback-manual', {}, WAIT)
    );

    expect(screen.queryByTestId(RESET)).toBeNull();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: MANUAL_ROUTE,
      params: { tripId: TRIP_ID },
    });
    expect(mockPush.mock.calls[0][0].params.fresh).toBeUndefined();
  });
});

describe('🔴 C7 · 확정된 일정에선 비우기 확인이 열리지 않는다 (확정 해제 API 없음)', () => {
  it('CONFIRMED 폴백 셸 — 링크가 있어도 눌러서 확인이 안 뜨고 fresh 를 실은 이동이 0이다', async () => {
    itineraryScript = () => fallback('CONFIRMED');
    await openFallbackShell();
    // 짝 — 셸 카드가 떠 있다.
    expect(screen.getByTestId(cardId('poi-a'))).toBeOnTheScreen();

    // 링크를 숨기든 눌러도 무반응이든 둘 다 허용한다 — 있으면 누른다(02a ★15).
    screen.queryAllByTestId(LINK).forEach((link) => fireEvent.press(link));
    await flush();

    expect(screen.queryByTestId(RESET)).toBeNull();
    const freshMoves = [
      ...mockPush.mock.calls,
      ...mockReplace.mock.calls,
    ].filter(
      ([arg]) =>
        typeof arg === 'object' &&
        arg !== null &&
        (arg as { params?: { fresh?: string } }).params?.fresh !== undefined
    );
    expect(freshMoves).toEqual([]);
    expect(generatePosts).toBe(0);
  });
});
