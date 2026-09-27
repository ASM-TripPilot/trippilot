import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { server } from '@/mocks/server';
import { buildSlotKey } from '@/entities/itinerary-slot/lib/slotKey';
import type {
  Itinerary,
  ItineraryCandidatesSummary,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationState,
  ItinerarySolveMode,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-1008 · 폴백 목록 얼굴과 위반 표식을 **실 HTTP 로** 태우는 심판(B1~B5 · C1·C2 · 티켓 금지 조항).
 *
 * 무엇을 보장하나:
 *  - 🔴 폴백 인터스티셜을 "기본 일정 보기"로 넘긴 목록(`DraftScreen`)이 폴백임을 드러낸다 — 제목·reason
 *    제목·배지가 "기본 일정" 결이고 "AI 추천"·"취향·거리로 채운" 은 0건이다(BR-U3-11 · D6). 폴백 3종
 *    (minimal·deterministic·demoted) 모두 같다(Q2).
 *  - 폴백이 아닌 staleFailed 목록은 그대로 "AI 추천" 이다(무회귀 짝 — 무조건 바꾼 구현을 죽인다).
 *  - 🔴 위반 슬롯에 표식이 h08 셸(깨끗한 COMPLETE)과 폴백 목록 **둘 다** 뜨고, 문구는 서버 사유와 무관한
 *    고정 라벨이다(02c) — 사유 원문에 소요시간("이동 54분 필요")이 섞여 와 그리면 INV-3 위반이라서다.
 *    FE 는 원문을 파싱해 거르지 않는다(D5).
 *
 * 라우팅은 픽스처가 정한다(traps-itinerary) — 각 describe 가 어느 갈래를 태우는지 픽스처 옆에 적었다.
 *   인터스티셜 = fallbackNotice≠null · h08 셸 = listed·!PARTIAL·!staleFailed·fallbackNotice=null ·
 *   DraftScreen = 그 밖(폴백 dismiss 뒤, staleFailed).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 → 실행=렌더(+기본 일정 보기 press) → 단언=testID 텍스트·0건 스캔.
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
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const DAY1 = '2026-06-10';
const DAY3 = '2026-06-12';

/** 서버 사유 — HC2(소요시간 섞임) · HC1(원시 분 범위)을 ` · ` 로 이은 실제 결합 형태. */
const RAW_REASON = '이동 54분 필요, 간격 -60분 · 영업시간 밖: 543~618';
const VIOLATION_LABEL = '일정 확인이 필요해요';
/** 소요시간 탐지기 — 리포 INV-3 스캐너들과 같은 식(`DraftScreen.test.tsx` 등). */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;
/** 원시 분 범위 탐지기(티켓 금지 조항). 치환된 `09:03~10:18` 은 앞이 2자리라 안 걸린다(02a §5-2). */
const RAW_RANGE = /\d{3,4}~\d{3,4}/;

const k = (poiId: string): string => buildSlotKey(DAY1, poiId);

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
    lat: 33.458,
    lng: 126.942,
    ...over,
  };
}

/** day1 비고정 2장 — `poi-a` 는 위반(HC2 소요시간 + HC1 원시 분값), `poi-b` 는 위반 없음. */
function daySlots(): ItineraryDaysItemSlotsItem[] {
  return [
    slot('poi-a', {
      hasViolation: true,
      violationReason: RAW_REASON,
    }),
    slot('poi-b', { startAt: '13:00:00', endAt: '14:00:00' }),
  ];
}

function itinerary(input: {
  solveMode: ItinerarySolveMode;
  isFallback: boolean;
  generationState?: ItineraryGenerationState;
  candidatesSummary?: ItineraryCandidatesSummary;
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: input.solveMode,
    generationMode: 'FULLY_AI',
    generationState: input.generationState ?? 'COMPLETE',
    isFallback: input.isFallback,
    candidatesSummary: input.candidatesSummary,
    days: [{ date: DAY1, slots: daySlots() }],
  };
}

let itineraryScript: () => Itinerary;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockClear();
  mockCanGoBack.mockReturnValue(true);
  setAccessToken('valid-access');
  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryScript())
    ),
    http.post(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(itineraryScript(), { status: 201 })
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 동결 DraftPage 통합 테스트와 같은 클라이언트. */
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

/** 인터스티셜에서 "기본 일정 보기" → 폴백 목록(`DraftScreen`) 도착까지. */
async function openFallbackList(): Promise<void> {
  renderPage();
  fireEvent.press(await screen.findByTestId('itinerary-fallback-view-plan'));
  await screen.findByTestId('itinerary-draft-scroll');
}

/** 폴백 3종 — 인터스티셜이 세 kind 모두에 "취향 반영 (건너뜀)" 이라 목록도 같이 말한다(Q2). */
const FALLBACK_ROWS: {
  kind: string;
  solveMode: ItinerarySolveMode;
  isFallback: boolean;
  summary?: ItineraryCandidatesSummary;
}[] = [
  { kind: 'minimal', solveMode: 'MINIMAL', isFallback: true },
  { kind: 'deterministic', solveMode: 'DETERMINISTIC', isFallback: true },
  {
    kind: 'demoted',
    solveMode: 'FULL_AI',
    isFallback: false,
    summary: { level: 'LOW' },
  },
];

describe('🔴 B1~B3·B5 · 폴백 목록은 "기본 일정" 이다 — AI 추천·취향·거리 문구 0건 (BR-U3-11 · D6)', () => {
  it.each(FALLBACK_ROWS)(
    '$kind — 배지·제목·reason 제목이 기본 일정 결이다',
    async ({ solveMode, isFallback, summary }) => {
      itineraryScript = () =>
        itinerary({ solveMode, isFallback, candidatesSummary: summary });

      await openFallbackList();

      // 긍정 앵커 — 비고정 카드 2장이 목록에 떠 있다(빈 화면이 아래 0건을 공짜로 통과하지 못하게).
      const cardA = screen.getByTestId(`itinerary-draft-slot-${k('poi-a')}`);
      const cardB = screen.getByTestId(`itinerary-draft-slot-${k('poi-b')}`);

      // B1 — 비고정 카드마다 배지가 **있고** 텍스트가 "기본 일정" 이다(배지를 지운 구현은 여기서 죽는다).
      [cardA, cardB].forEach((card, i) => {
        const key = k(i === 0 ? 'poi-a' : 'poi-b');
        expect(
          within(card).getByTestId(`itinerary-draft-slot-badge-${key}`)
        ).toHaveTextContent('기본 일정');
      });
      expect(
        screen.queryAllByTestId(/^itinerary-draft-slot-badge-/).length
      ).toBe(2);

      // B3 — 폴백 표식 문구와 화면 제목.
      expect(
        screen.getByTestId('itinerary-draft-reason-title')
      ).toHaveTextContent('취향 반영 없이 만든 기본 일정이에요');
      expect(screen.getByTestId('itinerary-draft-title')).toHaveTextContent(
        '기본 일정'
      );

      // B2 — 사실과 다른 문구가 화면 어디에도 없다.
      expect(screen.queryAllByText(/취향·거리로 채운/).length).toBe(0);
      expect(screen.queryAllByText(/AI 추천/).length).toBe(0);
    }
  );
});

describe('B4a · 폴백 아닌 staleFailed 목록의 배지는 그대로 "AI 추천" 이다 (선제 green · 무회귀 짝)', () => {
  it('FULL_AI·FAILED·isFallback=false → 인터스티셜 없이 DraftScreen, 배지 AI 추천', async () => {
    // 갈래: fallbackNotice=null 이라 인터스티셜 없음 · staleFailed 라 셸도 아님 → DraftScreen 직행(02a ★7).
    itineraryScript = () =>
      itinerary({
        solveMode: 'FULL_AI',
        isFallback: false,
        generationState: 'FAILED',
      });

    renderPage();
    await screen.findByTestId('itinerary-draft-stale-failed');

    expect(
      screen.getByTestId(`itinerary-draft-slot-badge-${k('poi-a')}`)
    ).toHaveTextContent('AI 추천');
    expect(
      screen.getByTestId(`itinerary-draft-slot-badge-${k('poi-b')}`)
    ).toHaveTextContent('AI 추천');
  });
});

describe('🔴 B4b · 폴백 아닌 staleFailed 목록의 제목·reason 제목은 그대로다 (무회귀 짝 · 새 testID)', () => {
  it('제목 "AI 추천안" · reason 제목 "취향·거리로 채운 추천안이에요"', async () => {
    itineraryScript = () =>
      itinerary({
        solveMode: 'FULL_AI',
        isFallback: false,
        generationState: 'FAILED',
      });

    renderPage();
    await screen.findByTestId('itinerary-draft-stale-failed');

    expect(screen.getByTestId('itinerary-draft-title')).toHaveTextContent(
      'AI 추천안'
    );
    expect(
      screen.getByTestId('itinerary-draft-reason-title')
    ).toHaveTextContent('취향·거리로 채운 추천안이에요');
  });
});

describe('🔴 C1·C2 · h08 셸(깨끗한 COMPLETE) — 위반 슬롯 카드에만 고정 라벨 표식, 사유 원문·소요시간 0건 (INV-3)', () => {
  it('poi-a 카드 안에 "일정 확인이 필요해요" 표식, 전체 1개, 소요시간·사유 원문·원시 분 범위 0건', async () => {
    // 갈래: FULL_AI·COMPLETE·isFallback=false·요약 없음 → fallbackNotice=null·!staleFailed → h08 셸.
    itineraryScript = () =>
      itinerary({ solveMode: 'FULL_AI', isFallback: false });

    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const cardA = screen.getByTestId(`slot-stopcard-${k('poi-a')}`);
    expect(
      within(cardA).getByTestId(`slot-stopcard-violation-${k('poi-a')}`)
    ).toHaveTextContent(VIOLATION_LABEL);
    // C2 — 위반 없는 poi-b 에는 없다(전체 1개).
    expect(screen.getByTestId(`slot-stopcard-${k('poi-b')}`)).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^slot-stopcard-violation-/).length).toBe(1);
    // INV-3 — 위 긍정 짝(표식이 카드 안에 있다)이 선 뒤라 이 0건은 빈 화면 공짜 통과가 아니다.
    expect(screen.queryAllByText(DURATION_TEXT).length).toBe(0);
    expect(screen.queryAllByText(/영업시간 밖/).length).toBe(0);
    expect(screen.queryAllByText(RAW_RANGE).length).toBe(0);
  });
});

describe('🔴 C1·C2 · 폴백 목록(DraftScreen) — 위반 슬롯 카드에만 고정 라벨 표식, 사유 원문·소요시간 0건 (INV-3)', () => {
  it('인터스티셜을 넘긴 목록의 poi-a 카드 안에 표식, 전체 1개, 소요시간·사유 원문·원시 분 범위 0건', async () => {
    // 갈래: MINIMAL+isFallback=true → 인터스티셜 → "기본 일정 보기" → DraftScreen.
    itineraryScript = () =>
      itinerary({ solveMode: 'MINIMAL', isFallback: true });

    await openFallbackList();

    const cardA = screen.getByTestId(`itinerary-draft-slot-${k('poi-a')}`);
    // testID 는 카드 접두(`itinerary-draft-slot-`) **밖** — 카드 세는 셀렉터 오계수 방지(02a ★1).
    expect(
      within(cardA).getByTestId(`itinerary-draft-violation-${k('poi-a')}`)
    ).toHaveTextContent(VIOLATION_LABEL);
    expect(
      screen.getByTestId(`itinerary-draft-slot-${k('poi-b')}`)
    ).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^itinerary-draft-violation-/).length).toBe(
      1
    );
    // INV-3 — 위 긍정 짝(표식이 카드 안에 있다)이 선 뒤라 이 0건은 빈 화면 공짜 통과가 아니다.
    expect(screen.queryAllByText(DURATION_TEXT).length).toBe(0);
    expect(screen.queryAllByText(/영업시간 밖/).length).toBe(0);
    expect(screen.queryAllByText(RAW_RANGE).length).toBe(0);
  });
});
