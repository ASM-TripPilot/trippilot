import type { ReactNode } from 'react';
import { Text } from 'react-native';
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
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryGenerationMode,
  ItineraryGenerationState,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1037 · 재생성 버튼은 생성 화면으로 **한 번만** 보낸다 (QA #028 · BR-U3-19 · INV-4).
 *
 * 무엇을 보장하나:
 *  - 🔴 L1 누르면 그 자리에서 생성 화면(`/trips/[tripId]/itinerary/generating`, mode=FULLY_AI)으로 replace 한다.
 *    초안 화면은 생성 POST 를 보내지 않는다 — POST 는 생성 화면이 마운트될 때 한 번 보낸다(결정 A).
 *  - 🔴 L2~L5 몇 번을 눌러도(1초 넘는 간격 · 같은 순간 두 탭 · 조회를 기다리는 동안) 이동은 1회다.
 *  - 🔴 L6·L7 조회 전 누름: 404(일정 없음)면 이동, 5xx 면 멈춤 — 멈춘 뒤엔 다시 누를 수 있다(AC-6).
 *  - 🟢 L8 확정 일정은 이동 0 · L9 생성 중 확인을 취소하면 다시 누를 때 확인이 또 뜬다.
 *  - 🔴 L10 확인의 「계속」도 같은 순간 두 탭에 이동 1회 · L11 409 안내는 초안 화면이 그리지 않는다.
 *  - 🟢 L12 직접 짠(MANUAL) 일정은 어떤 버튼으로도 생성 화면에 가지 않는다(TRIP-1038 무회귀).
 *  - 🔴 L13 조회를 기다리는 동안 화면을 떠나면, 조회가 도착해도 생성 화면으로 끌고 가지 않는다(5-b 경고-1).
 *
 * jest 의 라우터 목은 화면을 내리지 않는다 — 실기에선 replace 가 초안 화면을 없애지만 여기선 그대로 남아
 * 같은 버튼을 몇 번이고 누를 수 있다. 그래서 "여러 번 눌러도 1회"를 잴 수 있다(02a ★1).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=화면을 열고 누른다 → 단언=라우터 호출·나간 요청.
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

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외(02a ★12).
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
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const SESSION_ID = '44444444-4444-4444-4444-444444444444';
const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';
const WAIT = { timeout: 4000 };

const GENERATING = '/trips/[tripId]/itinerary/generating';
/** 이동 계약 — successRoute 는 싣지 않는다(기본 draft). CO_PLAN 일정도 FULLY_AI 로 간다(01b). */
const EXPECTED_ROUTE = {
  pathname: GENERATING,
  params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
};

const CTA0 = 'sheet-cta-button-0';
const HEADER_RETRY = 'itinerary-draft-retry';
const CONFIRM = 'itinerary-draft-inprogress-confirm';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 3일',
    startDate: DAY1,
    endDate: DAY3,
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function oneDay(date: string): ItineraryDaysItem {
  return {
    date,
    slots: [
      {
        poiId: 'poi-a',
        startAt: '09:30:00',
        endAt: '11:00:00',
        isFixed: false,
        endsNextDay: false,
        hasViolation: false,
        alternatives: [],
        tags: [],
        nameKo: '광안리 해변',
        category: '자연',
        imageUrl: null,
        distanceRange: null,
        lat: 33.458,
        lng: 126.942,
      },
    ],
  };
}

function itinerary(
  input: {
    status?: ItineraryStatus;
    generationMode?: ItineraryGenerationMode;
    generationState?: ItineraryGenerationState;
    generationSessionId?: string | null;
    days?: ItineraryDaysItem[];
  } = {}
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: input.status ?? 'PLANNED',
    solveMode: input.generationMode === 'MANUAL' ? 'MINIMAL' : 'FULL_AI',
    generationMode: input.generationMode ?? 'FULLY_AI',
    generationState: input.generationState ?? 'COMPLETE',
    generationSessionId: input.generationSessionId ?? null,
    isFallback: false,
    days: input.days ?? [oneDay(DAY1), oneDay(DAY2), oneDay(DAY3)],
  };
}

/** 이 여행이 생성 중 — 세션 있음 · 1일차도 아직 없어 빈 얼굴(헤더 버튼이 닿는 유일한 PARTIAL). */
const ownGenerating = (): Itinerary =>
  itinerary({
    generationState: 'PARTIAL',
    generationSessionId: SESSION_ID,
    days: [],
  });

/** 일정 GET 응답. 문자열이면 그 상태 코드의 오류 응답이다. */
let itineraryScript: () => Itinerary | 404 | 500;
let itineraryGets = 0;
/** 초안 화면이 보낸 생성 POST 수 — 이 파일 전부에서 0 이어야 한다. */
let postCount = 0;
let postResponse: () => Response;
/** 일정 GET 을 붙잡는 문. null 이면 곧장 응답한다(02a ★5). */
let gate: Promise<void> | null = null;
let releaseGate: (() => void) | null = null;

function holdItineraryGet(): void {
  gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  [mockPush, mockReplace, mockBack].forEach((fn) => fn.mockClear());
  itineraryScript = () => itinerary();
  itineraryGets = 0;
  postCount = 0;
  postResponse = () =>
    HttpResponse.json(
      itinerary({ generationState: 'PARTIAL', days: [oneDay(DAY1)] }),
      { status: 201 }
    );
  gate = null;
  releaseGate = null;
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, async () => {
      itineraryGets += 1;
      if (gate !== null) await gate;
      const body = itineraryScript();
      if (body === 404 || body === 500) {
        return HttpResponse.json(
          { error: { code: body === 404 ? 'NOT_FOUND' : 'INTERNAL' } },
          { status: body }
        );
      }
      return HttpResponse.json(body);
    }),
    http.post(`${BASE}/trips/:tripId/itinerary`, () => {
      postCount += 1;
      return postResponse();
    })
  );
});

// 문을 안 열고 끝나면 붙잡힌 요청이 열린 핸들로 남는다 — describe 밖 최상위에서 항상 연다.
afterEach(() => {
  releaseGate?.();
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

/** 생성 화면으로 간 라우터 호출 수 — replace 든 push 든(push 로 가도 여기서 잡힌다). */
function toGenerating(): number {
  return [...mockReplace.mock.calls, ...mockPush.mock.calls].filter(
    ([arg]) =>
      typeof arg === 'object' &&
      arg !== null &&
      (arg as { pathname?: string }).pathname === GENERATING
  ).length;
}

/** "그대로 1건/0건"은 흘려 보낸 뒤에야 뜻을 갖는다(누름 → fetch → msw 는 비동기). */
async function settle(ms = 300): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe('🔴 L1 · AC-1 — 누르면 그 자리에서 생성 화면으로 replace 하고, 초안 화면은 POST 하지 않는다', () => {
  it.each<ItineraryGenerationMode>(['FULLY_AI', 'CO_PLAN'])(
    '%s 초안 — 다시 짜기 press 직후 replace 1회(mode=FULLY_AI) · POST 0',
    async (generationMode) => {
      itineraryScript = () => itinerary({ generationMode });
      renderPage();
      const retry = await screen.findByTestId(CTA0, {}, WAIT);
      expect(retry).toHaveTextContent('다시 짜기');

      fireEvent.press(retry);

      // ★ 기다리지 않고 곧바로 — 응답을 기다린 뒤 이동하면 그동안 화면이 아무 말도 안 한다(INV-4 · 02a ★9).
      expect(mockReplace).toHaveBeenCalledTimes(1);
      expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);

      await settle();
      expect(postCount).toBe(0);
      expect(mockPush).not.toHaveBeenCalled();
    }
  );
});

describe('🔴 L2 · AC-2 — 1초 넘는 간격을 두고 세 번 눌러도 생성 화면 이동은 1회', () => {
  it('press → 1.1초 → press → press 뒤 이동 1 · POST 0 (400ms 공용 가드로는 못 막는 간격)', async () => {
    renderPage();
    const retry = await screen.findByTestId(CTA0, {}, WAIT);

    fireEvent.press(retry);
    await settle(1100);
    fireEvent.press(retry);
    fireEvent.press(retry);
    await settle();

    expect(toGenerating()).toBe(1);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L3 · AC-2 — 같은 순간 두 탭(한 렌더 사본)에도 이동은 1회', () => {
  it('바깥 act 하나 안의 press 두 번 → 이동 1 · POST 0', async () => {
    renderPage();
    const retry = await screen.findByTestId(CTA0, {}, WAIT);

    // ★ 바깥 act 가 끝날 때까지 다시 그리지 않는다 — 두 누름이 같은 핸들러를 본다(02a ★3).
    await act(async () => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await settle();

    expect(toGenerating()).toBe(1);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L4 · AC-2 — 헤더 「다시 만들기」(빈 얼굴)도 세 번 눌러 이동 1회', () => {
  it('itinerary-draft-retry press 3번 → 이동 1 · POST 0', async () => {
    itineraryScript = () => itinerary({ days: [] });
    renderPage();
    await screen.findByTestId('itinerary-draft-empty', {}, WAIT);
    const retry = screen.getByTestId(HEADER_RETRY);

    fireEvent.press(retry);
    fireEvent.press(retry);
    fireEvent.press(retry);
    await settle();

    expect(toGenerating()).toBe(1);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L5 · AC-2·AC-3 — 조회를 기다리는 동안 세 번 눌러도, 조회가 끝나면 이동은 1회', () => {
  it('로딩 중 press 3번 → 조회 도착 뒤 이동 1 · 일정 GET 1건 · POST 0', async () => {
    holdItineraryGet();
    renderPage();
    await screen.findByTestId('itinerary-draft-loading', {}, WAIT);
    const retry = screen.getByTestId(HEADER_RETRY);

    fireEvent.press(retry);
    fireEvent.press(retry);
    fireEvent.press(retry);
    await settle(100);
    // 앵커 — 조회가 안 끝났으니 아직 아무 데도 안 갔다(status 를 모르면 보내지 않는다).
    expect(toGenerating()).toBe(0);

    await act(async () => {
      releaseGate?.();
    });
    await waitFor(() => expect(toGenerating()).toBeGreaterThanOrEqual(1), WAIT);
    await settle();

    expect(toGenerating()).toBe(1);
    expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
    // 세 누름이 조회를 늘리지 않고 이미 도는 조회 하나에 올라탔다(cancelRefetch:false 무회귀 · 02a ★4).
    expect(itineraryGets).toBe(1);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L6 · AC-3 — 조회가 404(일정 없음)면 만들어도 안전하니 생성 화면으로 간다', () => {
  it('실패 얼굴 헤더 retry → 재조회 404 → replace 1(mode=FULLY_AI) · POST 0', async () => {
    itineraryScript = () => 404;
    renderPage();
    await screen.findByTestId('itinerary-draft-failed', {}, WAIT);

    fireEvent.press(screen.getByTestId(HEADER_RETRY));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
    await settle();
    expect(toGenerating()).toBe(1);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L7 · AC-3·AC-6 — 5xx 면 멈추고, 멈춘 뒤엔 다시 누를 수 있다 (잠금이 영구히 남지 않는다)', () => {
  it('500 → 이동 0 → 다시 누르면(이번엔 PLANNED) 이동 1 · POST 0', async () => {
    itineraryScript = () => 500;
    renderPage();
    await screen.findByTestId('itinerary-draft-failed', {}, WAIT);
    const getsBefore = itineraryGets;

    fireEvent.press(screen.getByTestId(HEADER_RETRY));
    // 앵커 — 재조회가 실제로 돌았다(안 돌아도 이동 0 이라 공허해진다 · 02a ★7).
    await waitFor(() => expect(itineraryGets).toBe(getsBefore + 1), WAIT);
    await settle();
    expect(toGenerating()).toBe(0);

    itineraryScript = () => itinerary();
    fireEvent.press(screen.getByTestId(HEADER_RETRY));

    await waitFor(() => expect(toGenerating()).toBe(1), WAIT);
    expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
    await settle();
    expect(toGenerating()).toBe(1);
    expect(postCount).toBe(0);
  });
});

describe('🟢 L8 · AC-4 — 조회 전 누른 뒤 도착한 일정이 확정(CONFIRMED)이면 이동 0 (선제 green · 무회귀)', () => {
  it('로딩 중 press → CONFIRMED 도착 → 셸이 떠도 이동 0 · POST 0', async () => {
    holdItineraryGet();
    itineraryScript = () => itinerary({ status: 'CONFIRMED' });
    renderPage();
    await screen.findByTestId('itinerary-draft-loading', {}, WAIT);

    fireEvent.press(screen.getByTestId(HEADER_RETRY));
    await act(async () => {
      releaseGate?.();
    });
    // 앵커 — 조회가 도착해 화면이 셸로 바뀌었다(판정 재료가 손에 들어왔다).
    await screen.findByTestId(CTA0, {}, WAIT);
    await settle();

    expect(toGenerating()).toBe(0);
    expect(postCount).toBe(0);
  });
});

describe('🟢 L9 · AC-5·AC-6 — 생성 중 확인을 「취소」하면, 다시 누를 때 확인이 또 뜬다 (선제 green · 잠금 해제 회귀 방지)', () => {
  it('retry → 확인 → 취소 → retry → 확인 다시 · 이동 0 · POST 0', async () => {
    itineraryScript = ownGenerating;
    renderPage();
    await screen.findByTestId('itinerary-draft-empty', {}, WAIT);

    fireEvent.press(screen.getByTestId(HEADER_RETRY));
    fireEvent.press(await screen.findByTestId(`${CONFIRM}-cancel`, {}, WAIT));
    await screen.findByTestId('itinerary-draft-empty', {}, WAIT);
    expect(screen.queryByTestId(CONFIRM)).toBeNull();

    fireEvent.press(screen.getByTestId(HEADER_RETRY));

    expect(await screen.findByTestId(CONFIRM, {}, WAIT)).toBeOnTheScreen();
    await settle();
    expect(toGenerating()).toBe(0);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L10 · AC-5·AC-2 — 확인의 「계속」을 같은 순간 두 번 눌러도 이동은 1회', () => {
  it('retry → 확인 → 바깥 act 안 「계속」 두 번 → replace 1(mode=FULLY_AI) · POST 0', async () => {
    itineraryScript = ownGenerating;
    renderPage();
    await screen.findByTestId('itinerary-draft-empty', {}, WAIT);

    fireEvent.press(screen.getByTestId(HEADER_RETRY));
    const cont = await screen.findByTestId(`${CONFIRM}-continue`, {}, WAIT);
    await act(async () => {
      fireEvent.press(cont);
      fireEvent.press(cont);
    });
    await settle();

    expect(toGenerating()).toBe(1);
    expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
    expect(postCount).toBe(0);
  });
});

describe('🔴 L11 · AC-7 — 다른 여행이 생성 중(409)이어도 초안 화면은 안내를 그리지 않고 생성 화면으로 보낸다', () => {
  it('POST 가 409 로 준비돼 있어도 → 이동 1 · 409 안내 없음 · POST 0', async () => {
    postResponse = () =>
      HttpResponse.json(
        {
          error: {
            code: 'GENERATION_IN_PROGRESS',
            message: '다른 여행의 일정을 만들고 있어요',
            activeTripId: '22222222-2222-2222-2222-222222222222',
          },
        },
        { status: 409 }
      );
    renderPage();

    fireEvent.press(await screen.findByTestId(CTA0, {}, WAIT));
    await settle();

    expect(toGenerating()).toBe(1);
    // 409 안내는 생성 화면이 말한다(GeneratingPage.busy G1~G8) — 초안 화면엔 뜰 길이 없다.
    expect(screen.queryByTestId('itinerary-generation-busy')).toBeNull();
    expect(postCount).toBe(0);
  });
});

describe('🟢 L12 · AC-9 — 직접 짠(MANUAL) 일정은 어떤 버튼으로도 생성 화면에 가지 않는다 (선제 green · TRIP-1038 무회귀)', () => {
  it('MANUAL 셸의 첫 CTA(편집하기) press → 생성 화면 이동 0 · POST 0', async () => {
    itineraryScript = () => itinerary({ generationMode: 'MANUAL' });
    renderPage();
    const cta = await screen.findByTestId(CTA0, {}, WAIT);
    expect(cta).toHaveTextContent('편집하기');

    fireEvent.press(cta);
    await settle();

    expect(toGenerating()).toBe(0);
    expect(postCount).toBe(0);
  });

  it('조회 실패 얼굴에서 retry → 재조회가 MANUAL 이면 생성 화면 이동 0 · POST 0', async () => {
    itineraryScript = () => 500;
    renderPage();
    await screen.findByTestId('itinerary-draft-failed', {}, WAIT);

    itineraryScript = () => itinerary({ generationMode: 'MANUAL' });
    fireEvent.press(screen.getByTestId(HEADER_RETRY));
    // 앵커 — 재조회가 도착해 MANUAL 셸(「내 일정」)로 바뀌었다(판정 재료가 손에 있었다).
    expect(
      await screen.findByTestId('sheet-header-title', {}, WAIT)
    ).toHaveTextContent('내 일정');
    await settle();

    expect(toGenerating()).toBe(0);
    expect(postCount).toBe(0);
  });
});

/**
 * 같은 일정 캐시 키를 구독하는 **다른 화면**의 대역 — 실기에선 탭 아래 홈(`PlanningHome`)·카드가 이 키를
 * 계속 들고 있다. 이 관찰자가 없으면 초안 화면이 내려갈 때 react-query 가 조회를 abort 해 "모름"으로 멈추므로
 * 결함이 재현되지 않는다(03b 경고-1 탐침 실측). 조회 결과는 상태 글자로 드러내 "조회가 실제로 도착했다" 앵커로 쓴다.
 */
function SiblingObserver(): ReactNode {
  const query = useGetTripsTripIdItinerary(TRIP_ID);
  return <Text testID="sibling-itinerary-status">{query.status}</Text>;
}

function renderWithSibling() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
  function Tree({ showDraft }: { showDraft: boolean }) {
    return (
      <QueryClientProvider client={client}>
        <SiblingObserver />
        {showDraft ? <DraftPage tripId={TRIP_ID} /> : null}
      </QueryClientProvider>
    );
  }
  const utils = render(<Tree showDraft />);
  return {
    ...utils,
    unmountDraft: () => utils.rerender(<Tree showDraft={false} />),
  };
}

describe('🔴 L13 · 5-b 경고-1 — 조회를 기다리는 동안 초안 화면을 떠나면, 조회가 도착해도 생성 화면으로 보내지 않는다', () => {
  it.each<{ name: string; arrives: () => Itinerary | 404; settled: string }>([
    { name: 'PLANNED 도착', arrives: () => itinerary(), settled: 'success' },
    { name: '404(일정 없음) 도착', arrives: () => 404, settled: 'error' },
  ])(
    '로딩 중 다시 만들기 → 응답 전 초안 화면만 언마운트 → $name → 생성 화면 이동 0 · POST 0',
    async ({ arrives, settled }) => {
      holdItineraryGet();
      itineraryScript = arrives;
      const { unmountDraft } = renderWithSibling();
      await screen.findByTestId('itinerary-draft-loading', {}, WAIT);

      fireEvent.press(screen.getByTestId(HEADER_RETRY));
      // 사용자가 ‹·스와이프로 떠났다 — 초안 화면만 내려가고 같은 키의 다른 관찰자는 남는다.
      unmountDraft();
      expect(screen.queryByTestId('itinerary-draft-loading')).toBeNull();

      await act(async () => {
        releaseGate?.();
      });
      // 앵커 — 조회가 abort 되지 않고 실제로 도착했다(안 오면 "이동 0"이 공허하다).
      await waitFor(
        () =>
          expect(
            screen.getByTestId('sibling-itinerary-status')
          ).toHaveTextContent(settled),
        WAIT
      );
      await settle();

      expect(toGenerating()).toBe(0);
      expect(postCount).toBe(0);
    }
  );
});
