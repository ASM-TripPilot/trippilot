import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import { server } from '@/mocks/server';
import type {
  Itinerary,
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
  ItineraryGenerationState,
  Trip,
} from '@/shared/api/generated/schemas';
import { clearAccessToken, setAccessToken } from '@/shared/api/tokenManager';

import { DraftPage } from './DraftPage';

/**
 * TRIP-790 · AC-8 h07 "부분 결과" 얼굴을 **실 HTTP 로** 태우는 심판(옛 TRIP-337 h10 게이지
 * 재작성 — 01b D1 로 PARTIAL 얼굴이 DraftScreen 인라인 게이지에서 **공용 지도+시트 셸**로 이동).
 *
 * 무엇을 보장하나 (draft 라우트의 `generationState==='PARTIAL'` 분기):
 *  - 🔴 PARTIAL 이면 **셸 얼굴**이 뜬다 — 전면 지도(`map-root`) + 상단 진행 카드
 *    (`generation-progress-card`, day-chip 대신) + 하단 peek 시트(SheetHeader + SlotStopCard).
 *    옛 게이지 testID(`itinerary-generating-*`)·일차 칩(`itinerary-draft-day-*`)은 사라진다(★1·★2).
 *  - 🔴 게이지 라벨이 `{n}일차 완성/생성 중/대기`(한글, 옛 `Day{n}` 아님)로 tabs 에서 도출된다(AC-6).
 *  - 🔴 도착 일차 슬롯은 isFixed 무관 **전부** 시각 칩(`HH:mm–HH:mm`, en-dash)을 그린다(AC-2·D6).
 *  - 🔴 AI 추천 배지·시간대 라벨·도보 추정·일차 칩·퍼센트·소요시간이 0건이다(AC-3·AC-5·INV-3).
 *  - 🔴 시트 헤더 meta 가 "N곳 · X.Xkm"(거리 합, `이동`/소요 어휘 0)다(AC-4·D8).
 *  - 🔴 생성 중이라 CTA(확정/완성)가 없다(D9).
 *  - `COMPLETE` 면 완성 얼굴(`<DraftScreen>` "AI 추천안")로 복귀하고 셸이 사라진다(revert guard).
 *
 * 왜 통합 버킷인가: 핵심 위험이 "가짜 진척"과 "옛 얼굴 잔존"이다 — 실제 PARTIAL 응답이 배선을
 * 타고 셸 얼굴로 이어지는지, 3상태가 옳게 **도출**되는지를 봐야 한다(DraftPage.integration 머리말 승계).
 *
 * 3동작 뼈대: 준비=가짜 서버 응답 지정 → 실행=화면을 연다 → 단언=보이는 얼굴·testID·글자.
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
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
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

/** 3일 여행 — 탭·게이지 셀 개수의 출처는 `days.length` 가 아니라 이 두 날짜다(01b D7). */
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
 * 하루치 3슬롯 — AC-2·AC-4 를 한 픽스처로 잰다.
 *  - 슬롯 b 는 **isFixed=true**(고정)인데도 시각 칩이 떠야 한다(AC-2 핵심 · D6).
 *  - 첫 슬롯 distanceRange 를 **null** 로 둬 legDistance 가 `slice(1)` 이든 전량 합이든 합이 같은
 *    3.5km 다(2.1+1.4) — 구현 해석에 안 흔들리게 한다(02a 픽스처 근거).
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

/** 도착한 일자만 담는다(PARTIAL 은 day1 만). */
function daysUpTo(count: number): ItineraryDaysItem[] {
  return [DAY1, DAY2, DAY3]
    .slice(0, count)
    .map((date) => ({ date, slots: daySlots(date) }));
}

function itinerary(input: {
  dayCount: number;
  generationState: ItineraryGenerationState;
}): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status: 'PLANNED',
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    generationState: input.generationState,
    isFallback: false,
    days: daysUpTo(input.dayCount),
  };
}

/** GET /itinerary 응답을 케이스가 정한다(PARTIAL day1만 · COMPLETE 3일 전부). */
let itineraryHandler: () => Response;

/** 렌더된 문자열 전부를 공백으로 이어 붙인다. 퍼센트·소요 부정 스캔의 모집단이다 — 소스가 아니라
 * **보이는 글자**를 훑는다(DraftScreen.test.tsx C14 와 동일 패턴). */
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
  setAccessToken('valid-access');
  itineraryHandler = () =>
    HttpResponse.json(itinerary({ dayCount: 3, generationState: 'COMPLETE' }));

  server.use(
    http.get(`${BASE}/trips/:tripId`, () => HttpResponse.json(trip())),
    http.get(`${BASE}/trips/:tripId/itinerary`, () => itineraryHandler()),
    http.post(`${BASE}/trips/:tripId/itinerary`, () =>
      HttpResponse.json(
        itinerary({ dayCount: 1, generationState: 'PARTIAL' }),
        {
          status: 201,
        }
      )
    )
  );
});

afterEach(() => {
  server.resetHandlers();
  clearAccessToken();
});

afterAll(() => server.close());

/** `retry:false`·`gcTime:0` — 실패를 즉시 실패로, 폴링 타이머가 종료 후 프로세스를 붙잡는 것 방지.
 * refetchInterval 은 배선의 책임이라 여기서 주지 않는다. PARTIAL 응답은 폴링을 유발하지만 값이
 * 안정적이라(같은 PARTIAL) 재렌더가 무해하고, 첫 렌더 상태만 findBy 로 즉시 단언한다. */
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

describe('A8-0 · 탐지기 자가검사 — 이게 통과해야 아래 "퍼센트 0건"이 의미를 갖는다', () => {
  it('퍼센트 스캔은 쪼개 그린 6·7·% 도 잡는다 (조합 실검증 · ★6)', () => {
    // ★ 조합 검증 — `renderedText()` 는 문자열 자식을 모아 공백으로 잇는다. Text 가 3조각으로
    //   쪼개져도 그 전처리가 `%` 를 지우지 않고 `\d+\s*%` 패턴이 살아남음을 실행으로 확인한다.
    render(
      <Text testID="pct-probe">
        <Text>6</Text>
        <Text>7</Text>
        <Text>%</Text>
      </Text>
    );

    const text = renderedText();
    expect(text).toContain('%');
    expect(text).toMatch(/\d+\s*%/);
  });
});

describe('🔴 A8-1 · AC-8 — PARTIAL 이면 h07 부분 결과(셸) 얼굴이 뜬다 (D1)', () => {
  beforeEach(() => {
    // 준비 — day1 만 담긴 PARTIAL, 여행은 3일.
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ dayCount: 1, generationState: 'PARTIAL' }));
  });

  it('A8-1a · 셸 얼굴이 뜨고 옛 게이지·일차 칩은 사라진다', async () => {
    renderPage();

    // 셸 골격 — 진행 카드(day-chip 대신) + 지도 + 셸 루트.
    await screen.findByTestId('generation-progress-card');
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('map-root')).toBeOnTheScreen();
    // ★2 — 진행 카드가 day-chip 자리를 대체하므로 일차 칩은 없다(옛 additive 공존 폐기).
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);
    // ★1 — 옛 h10 인라인 게이지 testID 는 이 얼굴에서 소멸했다.
    expect(
      screen.queryAllByTestId(/^itinerary-generating-(day|skeleton)-/)
    ).toEqual([]);
  });

  it('A8-1b · 게이지 라벨이 한글 {n}일차 …이고 3셀이 여행 기간에서 도출된다 (AC-6)', async () => {
    renderPage();
    await screen.findByTestId('generation-progress-card');

    // 3셀 — day1 완성 / day2 생성 중 / day3 대기(여행 기간 3에서 도출, days.length=1 아님).
    expect(
      screen.getByTestId('generation-gauge-cell-1-done')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-2-active')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('generation-gauge-cell-3-waiting')
    ).toBeOnTheScreen();
    // 한글 라벨(getByText=text 노드 완전일치).
    expect(screen.getByText('1일차 완성')).toBeOnTheScreen();
    expect(screen.getByText('2일차 생성 중')).toBeOnTheScreen();
    expect(screen.getByText('3일차 대기')).toBeOnTheScreen();
    // 짝 — 옛 `Day{n}` 형식은 사라졌다.
    expect(screen.queryAllByText(/Day\s*\d/)).toEqual([]);
  });

  it('A8-1c · 도착 일차 슬롯은 isFixed 무관 전부 시각 칩이다 (AC-2 · D6)', async () => {
    renderPage();
    await screen.findByTestId('generation-progress-card');

    // 3슬롯 전부 시각 칩(SlotStopCard time leaf).
    expect(screen.queryAllByTestId(/^slot-stopcard-time-/)).toHaveLength(3);
    // ★ 고정 슬롯(poi-b, isFixed=true)도 시각 칩이 뜬다 — "고정만 시각" 옛 규칙 폐기(BR-U3-07 개정).
    //   toHaveTextContent(문자열)=완전일치라(★5) en-dash `–`(U+2013) 를 정확히 요구한다.
    expect(
      screen.getByTestId(`slot-stopcard-time-${DAY1}#poi-b`)
    ).toHaveTextContent('13:00–14:30');
  });

  it('A8-1d · AI 배지·시간대 라벨·도보 추정·일차 칩이 없다 (AC-3)', async () => {
    renderPage();
    await screen.findByTestId('generation-progress-card');

    expect(screen.queryAllByText('AI 추천')).toEqual([]); // 옛 AI_BADGE
    expect(screen.queryAllByText(/^(오전|점심|오후|저녁)$/)).toEqual([]); // 시간대 라벨
    expect(screen.queryByText(/도보/)).toBeNull(); // 도보 추정
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]); // 일차 칩
  });

  it('A8-1e · 시트 헤더가 "N곳 · X.Xkm"(거리 합, 소요/이동 어휘 0)다 (AC-4 · D8)', async () => {
    renderPage();
    await screen.findByTestId('generation-progress-card');

    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      /1일차 완성/
    );
    // 제목은 게이지 라벨과 겹치지 않게 날짜를 결합한다(DraftPage §3) — 날짜 값이 실제로
    // 붙는지 잠근다(5-b 경고-1: 이 단언이 없으면 formatDraftDayHeader 산출이 무심판).
    expect(screen.getByTestId('sheet-header-title')).toHaveTextContent(
      /6월 10일/
    );
    const meta = screen.getByTestId('sheet-header-meta');
    // 곳 수 = 도착 슬롯 3, 거리 합 = 2.1+1.4 = 3.5km(정규식=부분 매칭, ★5).
    expect(meta).toHaveTextContent(/3곳/);
    expect(meta).toHaveTextContent(/3\.5km/);
    // INV-3 + Figma 형식 — legDistance 의 `이동 ` 접두를 그대로 쓰면 red, 소요 어휘도 금지.
    expect(meta).not.toHaveTextContent(/이동|분|시간|소요/);
  });

  it('A8-1f · 퍼센트·소요·CTA 가 0건이다 (AC-5 · D9 · INV-3)', async () => {
    renderPage();
    await screen.findByTestId('generation-progress-card');

    const text = renderedText();
    expect(text).not.toContain('%'); // 진행 수치 없음(계약)
    expect(text).not.toMatch(/\d+\s*(분|시간)|소요/); // 소요시간 어휘 없음(INV-3)
    // D9 — 생성 중이라 확정/완성 CTA 가 없다(셸 cta 미전달).
    expect(screen.queryByTestId('sheet-cta-root')).toBeNull();
    expect(screen.queryByTestId('itinerary-draft-complete')).toBeNull();
  });
});

describe('🔴 A8-3 · TRIP-939 AC-7 — PARTIAL 셸에 눌러도 반응 없는 링크가 없다 (S8 · A-3)', () => {
  beforeEach(() => {
    // 준비 — day1 만 담긴 PARTIAL(생성 중 셸).
    itineraryHandler = () =>
      HttpResponse.json(itinerary({ dayCount: 1, generationState: 'PARTIAL' }));
  });

  it('A8-3a · "다른 후보 ›" 링크가 0개이고 장소 이름은 누를 수 없는 글자다', async () => {
    // 실행: 초안 화면을 연다.
    renderPage();
    await screen.findByTestId('generation-progress-card');

    // 단언: 교체 미배선이던 "다른 후보 ›"(빈 함수 주입)가 사라졌다.
    // testID 문자열로 비교(요소 배열 toEqual 은 실패 출력이 fiber 트리 diff 라 OOM — 02a ★22).
    expect(
      screen
        .queryAllByTestId(/^slot-stopcard-alt-/)
        .map((node) => node.props.testID)
    ).toEqual([]);
    // 이름 노드 3개(도착 슬롯 3)는 그려지되(앵커) 호스트가 전부 터치 불가(onPressName 미주입).
    const names = screen.queryAllByTestId(/^slot-stopcard-name-/);
    expect(names).toHaveLength(3);
    names.forEach((node) => {
      expect(
        typeof node.props.onStartShouldSetResponder === 'function' ||
          typeof node.props.onClick === 'function'
      ).toBe(false);
    });
  });
});

describe('🔴 A8-2 · TRIP-792 플립 — COMPLETE 면 h07 진행 카드가 사라지고 h08 셸(day-chip·CTA)이 뜬다', () => {
  it('진행 카드·게이지가 사라지고 h08 day-chip 오버레이·확정 CTA 가 나타난다', async () => {
    // 준비 — 3일 전부 도착한 **깨끗한 COMPLETE**(기본 핸들러). h07(PARTIAL)→h08(COMPLETE) 전환.
    // ⚠️ 옛 계약("COMPLETE→DraftScreen 복귀")은 TRIP-792 D1-R NARROW 로 뒤집혔다 — 깨끗한 COMPLETE
    //    는 이제 h08 셸이다. "AI 추천안" 텍스트는 셸 헤더에도 있어(★3) testID 로만 가른다.
    renderPage();

    // 데이터 도착 앵커 — h08 CTA 바가 뜬 시점을 기다린 뒤 단언한다(GET 완료 전 상태를 재지 않게).
    await waitFor(() =>
      expect(screen.queryByTestId('sheet-cta-root')).not.toBeNull()
    );

    // ① h07 진행 카드는 사라진다(COMPLETE=생성 완료라 진행 중 아님).
    expect(screen.queryByTestId('generation-progress-card')).toBeNull();
    // ② 옛 h10 게이지 흔적도 0.
    expect(
      screen.queryAllByTestId(/^itinerary-generating-(day|skeleton)-/)
    ).toEqual([]);
    // ③ h08 셸 얼굴 — day-chip 오버레이가 진행 카드 자리를 차지한다.
    expect(screen.getByTestId('map-sheet-shell-root')).toBeOnTheScreen();
    expect(screen.getByTestId('sheet-daychip-0')).toBeOnTheScreen();
    // ④ 옛 DraftScreen 완성 목록(일차 탭)은 없다(셸로 대체).
    expect(screen.queryAllByTestId(/^itinerary-draft-day-/)).toEqual([]);
  });
});
