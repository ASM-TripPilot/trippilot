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
import type {
  GenerationSession,
  Itinerary,
  ItineraryDaysItem,
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1032 · 초안 화면(h11)의 재생성 — 사용자 결정(2026-09-27) "이미 생성 중이면 새 생성을 못 하게,
 * 다시 만들려면 기존 것을 취소하게".
 *
 * 무엇을 보장하나:
 *  - 🔴 D1~D3 **이 여행이 생성 중**(PARTIAL + 세션 있음)이면 [다시 시도]가 곧장 생성 화면으로 가지 않고
 *    확인을 먼저 연다. [계속]이어야 생성 화면으로 replace 1회(따로 cancel 하지 않는다 — 01b Q4),
 *    [취소]면 이동 0(AC-7).
 *  - 🔴 D4 세션 없는 PARTIAL 은 생성 중이 아니다 — 확인 없이 곧장 생성 화면으로(01b Q3).
 *  - TRIP-1037 플립: 재생성 POST 는 이제 생성 화면(GeneratingPage)이 마운트될 때 1회 보낸다 — 초안 화면의
 *    POST 는 어느 케이스에서도 0이다. 옛 D5~D7(초안 화면 위 409 안내)은 대상이 사라져 지웠다. 같은 계약은
 *    `GeneratingPage.busy.integration.test.tsx` G1~G8 이 진다(1037 01b Q1).
 *
 * ★ D1~D4 의 `days: []` 는 억지가 아니다 — PARTIAL 에 슬롯이 있으면 h07 지도+시트 셸로 가고 그 셸엔
 * 재생성 버튼이 없다. [다시 시도](DraftScreen 앱바)에 닿는 PARTIAL 은 빈 얼굴일 때뿐이다(02a ★4).
 *
 * 3동작: 준비 = 가짜 서버 응답 → 실행 = 화면을 열고 [다시 시도]·확인·안내 버튼을 누른다 → 단언 = 얼굴·요청.
 */

// 생성 클라이언트의 인증 계층이 `@/shared/storage`(expo-secure-store)를 정적으로 문다(선례 동형).
jest.mock('@/shared/storage', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  getTokens: jest.fn().mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
  }),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  hasStoredToken: jest.fn().mockResolvedValue(true),
}));

// jest.mock 팩토리는 파일 맨 위로 끌어올려져 바깥 변수를 못 본다 — `mock` 접두 변수만 예외(02a ★11).
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

// 지도는 이 파일의 관심사가 아니다 — 관찰 마커(map-root)로 바꾼다(형제 DraftPage 테스트 동형).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
/** 이 화면의 여행(T1)과 그 생성 세션(S1). */
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const OWN_SESSION_ID = '44444444-4444-4444-4444-444444444444';

const LABEL: Record<string, string> = {
  [TRIP_ID]: 'T1',
  [OWN_SESSION_ID]: 'S1',
};
const label = (id: unknown): string => LABEL[String(id)] ?? String(id);

/** 생성 화면 이동 계약 — successRoute 없이 mode=FULLY_AI(TRIP-1037 결정 A). */
const EXPECTED_ROUTE = {
  pathname: '/trips/[tripId]/itinerary/generating',
  params: { tripId: TRIP_ID, mode: 'FULLY_AI' },
};

const DAY1 = '2026-06-10';
const DAY3 = '2026-06-12';

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

function itinerary(input: {
  generationState: ItineraryGenerationState;
  generationSessionId?: string | null;
  days: ItineraryDaysItem[];
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState,
    generationSessionId: input.generationSessionId,
    isFallback: false,
    days: input.days,
  };
}

/** 이 여행이 생성 중 — 1일차도 아직 안 와 빈 얼굴(★4). */
const ownGenerating = (): Itinerary =>
  itinerary({
    generationState: 'PARTIAL',
    generationSessionId: OWN_SESSION_ID,
    days: [],
  });
/** 깨끗한 COMPLETE 3일 — h08 셸, 하단 [다시 짜기]. */
const completeThreeDays = (): Itinerary =>
  itinerary({
    generationState: 'COMPLETE',
    generationSessionId: null,
    days: [oneDay(DAY1), oneDay('2026-06-11'), oneDay(DAY3)],
  });

const created = (): Response =>
  HttpResponse.json(
    itinerary({
      generationState: 'PARTIAL',
      generationSessionId: OWN_SESSION_ID,
      days: [oneDay(DAY1)],
    }),
    { status: 201 }
  );

function canceledSession(): GenerationSession {
  return {
    sessionId: OWN_SESSION_ID,
    status: 'CANCELED',
    mode: 'FULLY_AI',
    isFallback: false,
    startedAt: '2026-09-27T10:00:00.000Z',
    finishedAt: '2026-09-27T10:03:00.000Z',
  };
}

/** 관심 요청만 순서대로: `POST T1` · `CANCEL T1/S1` (자기 조회·폴링은 적지 않는다). 이 파일 전부에서 비어야 한다. */
let log: string[] = [];
/** T1 일정 GET 응답(케이스가 정한다). */
let ownItinerary: () => Itinerary;

const count = (prefix: string): number =>
  log.filter((line) => line.startsWith(prefix)).length;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  log = [];
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  setAccessToken('valid-access');
  ownItinerary = completeThreeDays;

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(ownItinerary())
    ),
    http.post(`${BASE}/trips/:tripId/itinerary`, ({ params }) => {
      log.push(`POST ${label(params.tripId)}`);
      return created();
    }),
    http.post(
      `${BASE}/trips/:tripId/generation-sessions/:sessionId/cancel`,
      ({ params }) => {
        log.push(`CANCEL ${label(params.tripId)}/${label(params.sessionId)}`);
        return HttpResponse.json(canceledSession());
      }
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 형제 DraftPage 통합 테스트와 같은 클라이언트. */
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

/** "안 나갔다"는 나갈 시간을 준 뒤에야 의미가 있다(02a ★5). */
function settle(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 렌더된 문자열 전부(소요시간 부정 스캔의 모집단 — DraftPage.default 선례). */
function renderedText(): string {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out.join(' ');
}

/** 빈 얼굴(DraftScreen)이 뜬 뒤 앱바 [다시 시도]를 누른다. */
async function pressDraftRetry(): Promise<void> {
  await screen.findByTestId('itinerary-draft-empty');
  fireEvent.press(screen.getByTestId('itinerary-draft-retry'));
}

describe('🔴 D1 · AC-7 — 이 여행이 생성 중이면 [다시 시도]가 확인을 먼저 연다', () => {
  it('확인 얼굴·제목이 뜨고, 확인 전엔 생성 화면 이동·POST 가 0이다', async () => {
    ownItinerary = ownGenerating;

    renderPage();
    await pressDraftRetry();

    expect(
      await screen.findByTestId('itinerary-draft-inprogress-confirm')
    ).toBeOnTheScreen();
    // 01b Q7 채택 문구 — 정확 일치(02a ★7).
    expect(
      screen.getByText('지금 만들고 있는 일정이 있어요')
    ).toBeOnTheScreen();

    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(count('POST')).toBe(0);
    expect(renderedText()).not.toMatch(/\d+\s*(분|초|시간)|소요|%/);
  });
});

describe('🔴 D2 · AC-7·Q4 — 확인의 [계속]이어야 생성 화면으로 1회 (cancel 은 따로 안 부른다)', () => {
  it('계속 → replace 1(mode=FULLY_AI) · 초안 화면 POST 0 · cancel 0', async () => {
    ownItinerary = ownGenerating;

    renderPage();
    await pressDraftRetry();
    fireEvent.press(
      await screen.findByTestId('itinerary-draft-inprogress-confirm-continue')
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
    await settle();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    // POST 는 생성 화면이 마운트될 때 보낸다(TRIP-1037). 같은 여행 POST 는 서버가 이전 세션을 스스로
    // 닫는다 — 명시 cancel 은 실패 지점만 늘린다(01b Q4).
    expect(count('POST')).toBe(0);
    expect(count('CANCEL')).toBe(0);
  });
});

describe('🔴 D3 · AC-7 — 확인의 [취소]면 아무것도 안 나간다', () => {
  it('취소 → 확인 닫힘 · 생성 화면 이동 0 · POST 0', async () => {
    ownItinerary = ownGenerating;

    renderPage();
    await pressDraftRetry();
    fireEvent.press(
      await screen.findByTestId('itinerary-draft-inprogress-confirm-cancel')
    );

    await waitFor(() =>
      expect(
        screen.queryByTestId('itinerary-draft-inprogress-confirm')
      ).toBeNull()
    );
    await settle();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(count('POST')).toBe(0);
  });
});

describe('🔴 D4 · 01b Q3 — 세션 없는 PARTIAL 은 생성 중이 아니다 (TRIP-1037 플립)', () => {
  it('generationSessionId=null 이면 확인 없이 곧장 생성 화면으로 replace 1 · POST 0', async () => {
    ownItinerary = () =>
      itinerary({
        generationState: 'PARTIAL',
        generationSessionId: null,
        days: [],
      });

    renderPage();
    await pressDraftRetry();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith(EXPECTED_ROUTE);
    expect(
      screen.queryByTestId('itinerary-draft-inprogress-confirm')
    ).toBeNull();
    await settle();
    expect(count('POST')).toBe(0);
  });
});
