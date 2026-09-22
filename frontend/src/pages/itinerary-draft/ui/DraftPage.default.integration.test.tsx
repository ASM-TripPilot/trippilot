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
  Itinerary,
  ItineraryCandidatesSummary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationState,
  ItinerarySolveMode,
  ItineraryStatus,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-792 · AC-1~7 h08 "AI 추천안 default(완성 초안)" 얼굴을 **실 HTTP 로** 태우는 심판
 * (01b D1-R NARROW · 계약 플립 두 번째 — 같은 `listed` 응답에 옛 DraftScreen 대신 공용 지도+시트 셸).
 *
 * 무엇을 보장하나 (draft 라우트의 **깨끗한 COMPLETE**(listed·!generating·!staleFailed·!fallback) 분기):
 *  - 🔴 셸 얼굴이 뜬다 — 전면 지도(`map-root`) + 좌상단 day-chip 오버레이(`sheet-daychip-*`) +
 *    시트 헤더(`sheet-header-*`) + 슬롯 카드(`slot-stopcard-*`) + 하단 CTA 바(`sheet-cta-root`).
 *    옛 DraftScreen 앱바(`itinerary-draft-back`·`-retry`·`-complete`·일차 탭)는 사라진다(AC-1).
 *  - 🟢 **narrow 가 INV-4 를 지킨다** — staleFailed 응답은 셸이 아니라 DraftScreen(staleFailed 배너)으로,
 *    fallback 응답은 전용 인터스티셜로 간다(AC-1b · INV-4 · TRIP-791 — broad 로 회귀하면 셸이 삼켜 red).
 *  - 🔴 확정하기 → h14(index 라우트) push 완전일치 / 다시 짜기 → 재생성 POST 1건(AC-2).
 *  - 🔴 전 슬롯 시각 칩(isFixed 무관, en-dash) · 제거요소 부재 · 헤더 "N곳 · X.Xkm" · INV-3 0 ·
 *    다른 후보 ›는 비고정만(AC-3~7).
 *
 * ⚠️ 함정(02a §4):
 *  - ★3 "AI 추천안" 텍스트는 **셸 헤더(`sheet-header-title`)에도 있다** → DraftScreen 앱바 부재는
 *    `queryByText('AI 추천안')` 이 아니라 **testID**(`itinerary-draft-back`)로 잰다.
 *  - ★2 "1일차"는 day-chip 과 헤더 dayLabel 둘 다 그린다 → `getByText('1일차')` 완전일치는 두 노드를
 *    잡아 throw. 여기선 셸 골격을 testID 로만 잰다.
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 열고/누른다 → 단언=보이는 얼굴·testID·나간 요청.
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

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: jest.fn(),
    canGoBack: () => true,
  }),
}));

// 지도는 이 칸의 심판 대상이 아니다 — 남는 props 를 통과시키는 관찰 마커(map-root)로 바꾼다.
// 셸이 `center` 를 반드시 넘겨야 이 목이 `center.lat` 접근에서 안 죽는다(DraftPage 배선 강제).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

const BASE = 'http://localhost:8080/api/v1';
const TRIP_ID = '11111111-1111-1111-1111-111111111111';

const DAY1 = '2026-06-10';
const DAY2 = '2026-06-11';
const DAY3 = '2026-06-12';

/** 3일 여행 — day-chip 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D7). */
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
  };
}

/**
 * 하루치 3슬롯 — AC-3·AC-5·AC-7 을 한 픽스처로 잰다.
 *  - poi-b 는 **isFixed=true**(고정)인데도 시각 칩이 떠야 한다(AC-3 핵심 · BR-U3-07 개정).
 *  - 첫 슬롯 distanceRange 를 **null** 로 둬 legDistance 가 `slice(1)` 이든 전량 합이든 합이 같은
 *    3.5km 다(2.1+1.4) — 구현 해석에 안 흔들리게 한다.
 *  - lat/lng 를 실어 셸 지도(map-root)가 마운트되고 DraftPage 가 center 를 계산하게 한다.
 */
function daySlots(date: string): ItineraryDaysItemSlotsItem[] {
  return [
    {
      poiId: 'poi-a',
      startAt: '09:30:00',
      endAt: '11:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: ['바다', '산책'],
      nameKo: '광안리 해변',
      category: '자연',
      imageUrl: null,
      distanceRange: null,
      lat: 33.458,
      lng: 126.942,
    },
    {
      poiId: 'poi-b',
      startAt: '13:00:00',
      endAt: '14:30:00',
      isFixed: true,
      endsNextDay: false,
      hasViolation: false,
      tags: ['호텔'],
      nameKo: `${date} 숙소`,
      category: '숙소',
      imageUrl: null,
      distanceRange: '2.1km',
      lat: 33.512,
      lng: 126.522,
    },
    {
      poiId: 'poi-c',
      startAt: '15:00:00',
      endAt: '16:00:00',
      isFixed: false,
      endsNextDay: false,
      hasViolation: false,
      tags: ['카페'],
      nameKo: '흰여울 마을',
      category: '자연',
      imageUrl: null,
      distanceRange: '1.4km',
      lat: 33.245,
      lng: 126.412,
    },
  ];
}

function daysUpTo(count: number): ItineraryDaysItem[] {
  return [DAY1, DAY2, DAY3]
    .slice(0, count)
    .map((date) => ({ date, slots: daySlots(date) }));
}

function itinerary(input: {
  dayCount: number;
  generationState: ItineraryGenerationState;
  status?: ItineraryStatus;
  solveMode?: ItinerarySolveMode;
  isFallback?: boolean;
  candidatesSummary?: ItineraryCandidatesSummary;
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: input.status ?? 'PLANNED',
    solveMode: input.solveMode ?? 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState,
    isFallback: input.isFallback ?? false,
    candidatesSummary: input.candidatesSummary,
    days: daysUpTo(input.dayCount),
  };
}

/** GET /itinerary 응답을 케이스가 정한다. 기본은 깨끗한 COMPLETE 3일(→ h08 셸). */
let itineraryHandler: () => Response;
/** 다시 짜기(재생성) POST 가 몇 번 나갔나. */
let postCount = 0;

/** 렌더된 문자열 전부를 공백으로 이어 붙인다(퍼센트·소요 부정 스캔의 모집단, h07 선례). */
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

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  postCount = 0;
  setAccessToken('valid-access');
  itineraryHandler = () =>
    HttpResponse.json(itinerary({ dayCount: 3, generationState: 'COMPLETE' }));

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
    http.post(`${BASE}/trips/:tripId/itinerary`, () => {
      postCount += 1;
      return HttpResponse.json(
        itinerary({ dayCount: 1, generationState: 'PARTIAL' }),
        { status: 201 }
      );
    })
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 실패 즉시, 폴링 타이머 잔존 방지. COMPLETE 는 폴링을 안 유발한다. */
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

describe('🔴 A1 · AC-1 — 깨끗한 COMPLETE 면 h08 셸 얼굴이 뜬다 (D1-R · 계약 플립)', () => {
  it('셸 골격이 뜨고 옛 DraftScreen 앱바·일차 탭은 사라진다', async () => {
    renderPage();

    // 셸 골격 — 지도 + day-chip 오버레이 + 헤더 + 슬롯 카드 + CTA 바.
    await screen.findByTestId('map-sheet-shell-root');
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-0')).toBeOnTheScreen(); // DayChipOverlay
    expect(screen.getByTestId('sheet-header-title')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-header-meta')).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^slot-stopcard-/).length).toBeGreaterThan(
      0
    );
    expect(screen.getByTestId('sheet-cta-root')).toBeOnTheScreen();

    // 옛 DraftScreen 앱바 부재 — ★3: 'AI 추천안' 텍스트는 셸 헤더에도 있어 testID 로 잰다.
    expect(screen.queryByTestId('itinerary-draft-back')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-retry')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-complete')).toBeNull();
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);
  });
});

describe('A1b · AC-1b — narrow 가 INV-4 를 지킨다 (staleFailed → DraftScreen · fallback → 인터스티셜)', () => {
  it('staleFailed(FAILED+슬롯) 응답은 셸이 아니라 DraftScreen(staleFailed 배너)로 간다 (선제 green)', async () => {
    // 준비 — FAILED+day1 슬롯 → resolveDraftView: listed + staleFailed. narrow 는 이걸 셸에서 뺀다.
    // TRIP-791 무영향: FAILED 는 fallbackNotice=null(isFallback=false)이라 인터스티셜로 안 가고
    // 목록 곁 staleFailed 배너를 유지한다(stale-failed 배너는 폴백 배너와 별개, 삭제 대상 아님).
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ dayCount: 1, generationState: 'FAILED' }));

    renderPage();

    // DraftScreen staleFailed 배너가 그대로 뜬다(INV-4 — 목록 곁 배너 소실 금지).
    expect(
      await screen.findByTestId('itinerary-draft-stale-failed')
    ).toBeOnTheScreen();
    // ★ 셸이 아니다 — broad 로 회귀하면(이 응답까지 셸로 보내면) 여기가 red 로 잡는다.
    expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
  });

  it('🔴 fallback(DETERMINISTIC+isFallback) 응답은 셸도 DraftScreen 도 아닌 인터스티셜로 간다 (TRIP-791)', async () => {
    // TRIP-791 플립 — 폴백 신호(non-null fallbackNotice)는 곁줄 배너가 아니라 전용 인터스티셜
    // (GenerationFallbackScreen)로 라우팅된다(01b D1). 셸도 아니다(narrow 조건이 fallback 을 셸에서 뺌).
    itineraryHandler = () =>
      HttpResponse.json(
        itinerary({
          dayCount: 3,
          generationState: 'COMPLETE',
          solveMode: 'DETERMINISTIC',
          isFallback: true,
        })
      );

    renderPage();

    expect(
      await screen.findByTestId('itinerary-fallback-root')
    ).toBeOnTheScreen();
    // 기존 두 얼굴로 새지 않는다 — 셸도, 곁줄 폴백 배너(이제 소멸)도 아니다.
    expect(screen.queryByTestId('map-sheet-shell-root')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-fallback-banner')).toBeNull();
  });
});

describe('🔴 A2 · AC-2 — CTA 두 갈래 배선 (혼동 방지)', () => {
  it('확정하기 press → /trips/[tripId]/itinerary 로 tripId 를 실어 한 번 push 한다', async () => {
    renderPage();
    await screen.findByTestId('sheet-cta-root');

    // 순서 계약 — cta[1]=확정하기(primary). 라벨을 함께 확인해 index 뒤바뀜을 잡는다.
    const confirm = screen.getByTestId('sheet-cta-button-1');
    expect(confirm).toHaveTextContent('확정하기');
    fireEvent.press(confirm);

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    // ★ 완전일치(맹점④) — `'itinerary'` 부분문자열은 draft·generating 경로에도 있어 substring 이면
    //   엉뚱한 곳으로 가도 통과한다. h14 는 접미 없는 index 라우트이고 객체형 push 여야 `[tripId]` 가
    //   해소된다(I9·must-visits push 선례 동형).
    const dest = mockPush.mock.calls[0][0] as {
      pathname?: string;
      params?: { tripId?: string };
    };
    expect(dest.pathname).toBe('/trips/[tripId]/itinerary');
    expect(dest.params?.tripId).toBe(TRIP_ID);
  });

  it('다시 짜기 press → 재생성 POST 가 한 건 나간다', async () => {
    renderPage();
    await screen.findByTestId('sheet-cta-root');

    // 순서 계약 — cta[0]=다시 짜기(outline).
    const retry = screen.getByTestId('sheet-cta-button-0');
    expect(retry).toHaveTextContent('다시 짜기');
    const before = postCount;
    fireEvent.press(retry);

    await waitFor(() => expect(postCount).toBe(before + 1));
  });
});

describe('🔴 A3 · AC-3 — 전 슬롯이 isFixed 무관 시각 칩을 그린다 (BR-U3-07 · en-dash)', () => {
  it('3슬롯 전부 시각 칩이고, 고정 슬롯(poi-b)도 en-dash 시각 칩이다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(3);
    // 고정 슬롯도 시각 칩 — toHaveTextContent(문자열)=완전일치라 en-dash `–`(U+2013)를 정확히 요구.
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-b`)
    ).toHaveTextContent('13:00–14:30');
  });
});

describe('🔴 A4 · AC-4 — 제거 요소가 셸 얼굴에 없다', () => {
  it('AI 배지·시간대 라벨·도보·#·옛 일차 탭·reason·다시 만들기 가 0건이다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    expect(screen.queryAllByText('AI 추천')).toEqual([]); // 옛 AI_BADGE
    expect(screen.queryAllByText(/^(오전|점심|오후|저녁)$/)).toEqual([]); // 시간대 라벨
    expect(screen.queryByText(/도보/)).toBeNull(); // 도보 추정
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]); // 옛 일차 탭
    expect(screen.queryByTestId('itinerary-draft-reason-subtitle')).toBeNull();
    // 옛 RETRY_LABEL('다시 만들기')는 없다 — h08 CTA '다시 짜기'와 완전일치로 구별된다.
    expect(screen.queryByText('다시 만들기')).toBeNull();
    // 슬롯 태그는 '바다 · 산책'(가운뎃점)이지 '#바다'가 아니다(옛 DraftSlotCard 해시태그 소멸).
    expect(renderedText()).not.toContain('#');
  });
});

describe('🔴 A5 · AC-5 — 시트 헤더 meta 가 "N곳 · X.Xkm"(거리 합)다', () => {
  it('meta 에 3곳·3.5km 가 있고 이동/소요 어휘는 0건이다 (INV-3)', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const meta = screen.getByTestId('sheet-header-meta');
    // 곳 수 = 3, 거리 합 = 2.1+1.4 = 3.5km(정규식=부분 매칭).
    expect(meta).toHaveTextContent(/3곳/);
    expect(meta).toHaveTextContent(/3\.5km/);
    // legDistance 는 '이동 3.5km' 를 주지만 헤더는 km 부만 — '이동' 접두·소요 어휘 금지.
    expect(meta).not.toHaveTextContent(/이동|분|시간|소요/);
  });
});

describe('🔴 A6 · AC-6 — 셸 얼굴 텍스트에 분·시간·소요·% 가 0건이다 (INV-3)', () => {
  it('퍼센트·소요시간 어휘가 화면 어디에도 없다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    const text = renderedText();
    expect(text).not.toContain('%');
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/);
  });
});

describe('🔴 A7 · AC-7 — "다른 후보 ›"는 비고정 슬롯에만 뜬다 (D2-R)', () => {
  it('비고정(poi-a·poi-c)엔 alt 링크가 있고 고정(poi-b)엔 없다', async () => {
    renderPage();
    await screen.findByTestId('map-sheet-shell-root');

    // 비고정 2개만 alt 링크(SlotStopCard 는 onPressAlt 가 주어졌을 때만 그린다).
    expect(screen.queryAllByTestId(/^slot-stopcard-alt-/)).toHaveLength(2);
    expect(
      screen.getByTestId(`slot-stopcard-alt-${DAY1}#poi-a`)
    ).toBeOnTheScreen();
    // 고정 슬롯엔 onPressAlt 미주입 → 링크 부재.
    expect(screen.queryByTestId(`slot-stopcard-alt-${DAY1}#poi-b`)).toBeNull();
  });
});
