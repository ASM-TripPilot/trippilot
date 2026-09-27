import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryDaysItem,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * h08(DraftPage)에 슬롯 교체 **시트**를 배선하는 심판(TRIP-467→483→793 이관). 컨테이너 내부
 * (POST→라디오→확정 PUT→닫힘·재조회)는 `SlotCandidatePanelContainer.integration.test.tsx` 가 완결 —
 * 여기선 **트리거·토글·조건부 마운트** 페이지 층 배선만 잰다.
 *
 * TRIP-793 변경: 인라인 패널(`itinerary-candidate-panel`)이 바텀시트(`itinerary-candidate-sheet` +
 * scrim)로 바뀌었고, **h08 지도+시트 셸의 슬롯 "다른 후보 ›" 트리거(옛 no-op)를 처음 실배선**한다.
 * 세 얼굴 모두 이제 h08 지도+시트 셸이다(TRIP-1039 — 폴백·staleFailed 목록이 옛 `DraftScreen` 에서 셸로
 * 옮겨 왔다). 시트는 `DraftPage` 가 **셸의 형제(뒤)** 로 마운트한다(TRIP-983):
 *  - 경로1(h08 셸 · staleFailed) — `SlotStopCard` 의 `slot-stopcard-alt-{slotKey}` 가 시트를 연다.
 *    (옛 DraftScreen 트리거 `itinerary-draft-alt-*` 의 "같은 트리거 재press 로 접힘"(D5)은 DraftScreen
 *    전용 토글이라 프로덕션 도달 경로가 사라져 삭제했다 — 02a J5.)
 *  - 경로2(h08 셸 · clean COMPLETE) — 같은 트리거(첫 실배선, D7~D9).
 *  - 경로3(폴백 dismiss → 셸 · TRIP-983 QA #024 재현 · TRIP-1039 AC-11) — 시트가 셸 **밖**에, 트리 순서상
 *    모든 카드·「처음부터 직접 짜기」·CTA 두 버튼 **뒤**에 산다(F1·F2 짝). 실제 겹침·딤 터치 차단은 6-b 몫.
 *  - D6 — 「직접 고르기」는 DraftScreen 에 남는 empty 얼굴 헤더에서 manual 로 간다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=트리거/닫기/manual press → 단언=마운트·POST·push.
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
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';

/** 1일 여행 — 탭 흔들림·폴링을 피한다. */
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
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

/** day1 = [고정 숙소(21:00) · 비고정 a · 비고정 b]. 고정은 트리거가 없어야 한다. */
function days(): ItineraryDaysItem[] {
  return [
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
          alternatives: [],
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
          alternatives: [],
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
          alternatives: [],
          tags: [],
          nameKo: '광안리',
        },
      ],
    },
  ];
}

/** 경로1 — staleFailed(FAILED+슬롯). fallbackNotice=null(FULL_AI·isFallback false)이라 인터스티셜을
 * 건너뛰고 h08 셸로 간다(TRIP-1039 — 옛 계약은 DraftScreen). staleFailed 안내가 시트 안에 붙지만
 * alt 트리거·시트 계약엔 영향 없다. */
function staleFailedItinerary(): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'FAILED',
    isFallback: false,
    days: days(),
  };
}

/** 경로2 — 깨끗한 COMPLETE. isPartial=false·staleFailed=false·fallbackNotice=null 이라 h08 지도+시트
 * 셸(MapSheetShell) 분기로 떨어진다(SlotStopCard 의 alt 트리거가 시트를 여는 유일 경로). */
function cleanItinerary(): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: 'COMPLETE',
    isFallback: false,
    days: days(),
  };
}

const CANDIDATES = {
  candidates: [
    { poiId: 'X', distanceRange: '420m', rationale: '가장 가까운 실내 전시' },
    { poiId: 'Y', distanceRange: '1.1km', rationale: '조용한 카페' },
  ],
  radiusMUsed: 1100,
  degraded: false,
};

let postCalls = 0;
let postBody: unknown = null;

const SHEET = 'itinerary-candidate-sheet';

/** 네트워크 응답을 기다리는 첫 조회 한도 — 로컬 기본 1000ms 의 CI 러너(약 4배 느림) 환산. */
const WAIT = { timeout: 4000 };

/** h08 셸 SlotStopCard 트리거 — fieldId 규약 `slot-stopcard-${role}-${slotKey}`(role 이 앞). */
function stopcardAltId(poiId: string): string {
  return `slot-stopcard-alt-${buildSlotKey(DAY1, poiId)}`;
}
function stopcardId(poiId: string): string {
  return `slot-stopcard-${buildSlotKey(DAY1, poiId)}`;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  postCalls = 0;
  postBody = null;
  mockPush.mockClear();
  setAccessToken('valid-access');

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    // 기본은 경로1(staleFailed). 경로2 는 각 it 에서 server.use 로 덮는다.
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(staleFailedItinerary())
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

// ─── 경로1: h08 셸(staleFailed) · 형제 마운트 (TRIP-1039 — 옛 DraftScreen 경로) ───────────
describe('🔴 D1 · AC-1 — 배선 전엔 시트가 없다 (조건부 마운트 · staleFailed 셸 경로)', () => {
  it('아무 트리거도 누르기 전엔 시트가 트리에 없고 slot-candidates POST 도 0건이다', async () => {
    renderPage();
    await screen.findByTestId(stopcardId('poi-a'), {}, WAIT);

    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(postCalls).toBe(0);
  });
});

describe('🔴 D2 · AC-1 — 비고정 트리거 press → 시트 마운트(+scrim) + 그 slotKey 로 POST 1건', () => {
  it('poi-b 트리거를 누르면 시트+scrim 이 뜨고 slot-candidates POST 가 poi-b 의 slotKey 로 나간다', async () => {
    renderPage();
    fireEvent.press(
      await screen.findByTestId(stopcardAltId('poi-b'), {}, WAIT)
    );

    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    // scrim 존재는 심판(구조) — 실 딤 커버·터치 차단은 6-b 실기 몫(바텀시트 목 사각).
    expect(screen.getByTestId('itinerary-candidate-scrim')).toBeOnTheScreen();

    await waitFor(() => expect(postCalls).toBe(1));
    expect((postBody as { slotKey: string }).slotKey).toBe(
      buildSlotKey(DAY1, 'poi-b')
    );
    expect(Object.keys(postBody as object)).toEqual(['slotKey']);
  });
});

describe('🔴 D3 · AC-2 — 고정 슬롯은 트리거 부재라 열 방법이 없다', () => {
  it('고정 카드엔 트리거가 없고(비고정엔 있고) 시트도 안 뜬다', async () => {
    renderPage();
    await screen.findByTestId(stopcardId('poi-a'), {}, WAIT);

    expect(screen.queryByTestId(stopcardAltId('poi-fixed'))).toBeNull();
    expect(screen.getByTestId(stopcardAltId('poi-a'))).toBeOnTheScreen();
    expect(screen.queryByTestId(SHEET)).toBeNull();
  });
});

describe('🔴 D4 · AC-1 — scrim press → 시트 언마운트 (X 버튼 없음, scrim onClose)', () => {
  it('시트를 열고 scrim 을 누르면 시트가 트리에서 사라진다', async () => {
    renderPage();
    fireEvent.press(
      await screen.findByTestId(stopcardAltId('poi-a'), {}, WAIT)
    );
    await screen.findByTestId(SHEET);

    fireEvent.press(screen.getByTestId('itinerary-candidate-scrim'));

    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
  });
});

describe('🔴 D6 · AC-4 — DraftScreen 에 남는 empty 얼굴의 「직접 고르기」 → manual 라우트 push', () => {
  it('일자 없는 COMPLETE(empty 얼굴)에서 직접 고르기를 누르면 /trips/[tripId]/itinerary/manual 로 push 한다', async () => {
    // 갈래: COMPLETE·FULL_AI·days 0 → empty 얼굴(DraftScreen 잔류, TRIP-1039 D1-i). 셸 폴백 얼굴의
    // 「처음부터 직접 짜기」는 `DraftPage.fallbackShell.integration.test.tsx` S7 이 맡는다.
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json({ ...cleanItinerary(), days: [] })
      )
    );
    renderPage();
    await screen.findByTestId('itinerary-draft-empty', {}, WAIT);

    fireEvent.press(screen.getByTestId('itinerary-draft-pick-manual'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/trips/[tripId]/itinerary/manual',
      params: { tripId: TRIP_ID },
    });
  });
});

// ─── 경로2: h08 지도+시트 셸(clean COMPLETE) · SlotStopCard 트리거 첫 실배선 ──────
describe('🔴 D7~D9 · h08 셸 트리거 실배선 (no-op → 실배선 · clean COMPLETE)', () => {
  function renderShell() {
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(cleanItinerary())
      )
    );
    return renderPage();
  }

  it('D7 · AC-1 — 셸 트리거 누르기 전엔 시트가 없고 POST 0건이다', async () => {
    renderShell();
    await screen.findByTestId(stopcardAltId('poi-a'));

    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(postCalls).toBe(0);
  });

  it('D8 · AC-1·D9(첫 실배선) — 비고정 슬롯 alt press → 시트 마운트 + 그 slotKey 로 POST 1건', async () => {
    renderShell();
    fireEvent.press(await screen.findByTestId(stopcardAltId('poi-a')));

    // 셸의 onPressAlt 가 옛 no-op 이면 시트도 POST 도 없다 → 여기서 red.
    expect(await screen.findByTestId(SHEET)).toBeOnTheScreen();
    await waitFor(() => expect(postCalls).toBe(1));
    expect((postBody as { slotKey: string }).slotKey).toBe(
      buildSlotKey(DAY1, 'poi-a')
    );
  });

  it('D9 · AC-2 — 고정 슬롯은 alt 트리거 부재(비고정엔 있음)', async () => {
    renderShell();
    await screen.findByTestId(stopcardAltId('poi-a'));

    expect(screen.queryByTestId(stopcardAltId('poi-fixed'))).toBeNull();
    expect(screen.getByTestId(stopcardAltId('poi-a'))).toBeOnTheScreen();
  });
});

// ─── 경로3: 폴백 dismiss → 셸 (TRIP-983 · QA #024 재현 · TRIP-1039 AC-11) ─────────────
describe('🔴 F1~F3 · TRIP-983·TRIP-1039 — 폴백 셸의 "다른 후보" 시트는 셸 밖, 셸 뒤에 산다', () => {
  const SCRIM = 'itinerary-candidate-scrim';
  const SHELL = 'map-sheet-shell-root';
  const LIST_IDS = [
    stopcardId('poi-fixed'),
    stopcardId('poi-a'),
    stopcardId('poi-b'),
    'itinerary-draft-manual',
    'sheet-cta-button-0',
    'sheet-cta-button-1',
  ];
  const SHEET_IDS = [SCRIM, SHEET];

  /** 폴백 추천안 — COMPLETE + DETERMINISTIC + isFallback 이라 `deterministic` 인터스티셜이 먼저 뜨고,
   * "기본 일정 보기"(로컬 dismiss)를 눌러야 셸 폴백 얼굴에 닿는다(TRIP-1039). */
  function fallbackItinerary(): Itinerary {
    return {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'DETERMINISTIC',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: true,
      days: days(),
    };
  }

  let putCalls = 0;

  beforeEach(() => {
    putCalls = 0;
    server.use(
      http.get(`${BASE}/trips/:tripId/itinerary`, () =>
        HttpResponse.json(fallbackItinerary())
      ),
      http.put(`${BASE}/trips/:tripId/itinerary`, () => {
        putCalls += 1;
        return HttpResponse.json(fallbackItinerary());
      })
    );
  });

  /** 인터스티셜 "기본 일정 보기" → 그 슬롯 "다른 후보 ›" → 시트가 뜰 때까지. */
  async function openFallbackSheet(poiId: string): Promise<void> {
    renderPage();
    fireEvent.press(
      await screen.findByTestId('itinerary-fallback-view-plan', {}, WAIT)
    );
    fireEvent.press(await screen.findByTestId(stopcardAltId(poiId), {}, WAIT));
    await screen.findByTestId(SHEET);
  }

  function escapeRe(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  it('F1 · AC-1 — 시트·딤이 뜨고, 둘 다 셸(map-sheet-shell-root)의 자손이 아니다', async () => {
    await openFallbackSheet('poi-a');

    expect(screen.getByTestId(SHEET)).toBeOnTheScreen();
    expect(screen.getByTestId(SCRIM)).toBeOnTheScreen();

    const shell = screen.getByTestId(SHELL);
    // 손잡이 검증 — 카드는 이 셸 안에 있다(빈 손잡이면 아래 부재 단언이 공허하게 통과한다).
    expect(within(shell).getByTestId(stopcardId('poi-a'))).toBeOnTheScreen();
    expect(within(shell).queryByTestId(SHEET)).toBeNull();
    expect(within(shell).queryByTestId(SCRIM)).toBeNull();
  });

  it('F2 · AC-2 — 트리 순서상 딤·시트가 모든 카드·「처음부터 직접 짜기」·CTA 두 버튼보다 뒤에 온다', async () => {
    // poi-a 는 첫 비고정 슬롯이라 뒤에 poi-b 카드·CTA 두 버튼이 더 있다.
    await openFallbackSheet('poi-a');

    const pattern = new RegExp(
      `^(${[...LIST_IDS, ...SHEET_IDS].map(escapeRe).join('|')})$`
    );
    // getAllByTestId 는 호스트 요소를 트리 pre-order(부모→자식, 형→아우)로 돌려준다.
    const order = screen
      .getAllByTestId(pattern)
      .map((node) => String(node.props.testID));

    expect(order).toHaveLength(LIST_IDS.length + SHEET_IDS.length);
    expect([...order.slice(0, LIST_IDS.length)].sort()).toEqual(
      [...LIST_IDS].sort()
    );
    expect([...order.slice(LIST_IDS.length)].sort()).toEqual(
      [...SHEET_IDS].sort()
    );
  });

  it('F3 · AC-3 — 후보 라디오 → 「교체하기」 → PUT 1회 + 시트 닫힘 (폴백 경로 무회귀)', async () => {
    await openFallbackSheet('poi-a');

    fireEvent.press(await screen.findByTestId('itinerary-candidate-radio-X'));
    fireEvent.press(screen.getByTestId('itinerary-candidate-confirm'));

    await waitFor(() => expect(putCalls).toBe(1));
    await waitFor(() => expect(screen.queryByTestId(SHEET)).toBeNull());
  });
});
