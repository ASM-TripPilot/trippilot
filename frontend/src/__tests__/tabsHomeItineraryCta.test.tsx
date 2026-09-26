import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import {
  ItineraryGenerationState,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';
import {
  useGetTrips,
  useGetTripsTripIdItinerary,
} from '@/shared/api/generated/trips/trips';
import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import HomeRoute from '@/app/(tabs)/index';

/**
 * (tabs)/홈 진입 라우트 — 여행 카드 주 CTA(`home-trip-hero-cta`)가 **그 여행의 itinerary 상태에
 * 맞는 화면으로** 이동한다(TRIP-401). 지금은 죽은 버튼(`onPress={undefined}`)이다.
 *
 * 무엇을 보장하나:
 *  - 🔴 지배(planning) 여행의 일정이 **없으면(404)** CTA 가 생성 방식(h04)으로 push 한다(AC-1).
 *  - 🔴 지배 여행의 일정이 **PARTIAL** 이면 CTA 가 생성 중(h09)으로 push 한다(AC-5 홈측).
 *
 * 왜 이렇게 테스트하나: 화면(`HomeScreen`)은 라우터·서버를 모른다. 홈 route 만 두 여행 조회 +
 * 지배 여행의 itinerary GET 을 물어 목적지를 정하고, `home-trip-hero-cta` 콜백에 그 목적지 push
 * 를 실어 화면에 내린다. 그래서 여행 목록·itinerary 상태·담김 수는 훅 seam 으로 주입하고,
 * `useRouter().push` 목으로 목적지 문자열을 관찰한다.
 *
 * *(AC-5 공유 증명 · 02a §4-★3)* 여기 홈 CTA 의 목적지(404→method · PARTIAL→generating)는
 *   `tabsItineraryRoute.test.tsx` 의 탭 목적지와 **같은 상태→같은 목적지**다. 두 진입점이 같은
 *   순수함수(`resolveItineraryDestination`)를 공유함을 행동으로 확인한다(트립 일치는 강요 안 함 —
 *   홈=지배 여행·탭=첫 여행).
 *
 * *(개념)* `jest.mock` 팩토리는 hoist 되어 `const mockPush` 선언보다 먼저 돈다 — `push: mockPush`
 *   를 화살표 안에서 호출 시점에 읽어(지연 참조) undefined 가 안 박힌다(tabsHomeRoute 선례).
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    navigate: mockNavigate,
  }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: jest.fn(),
}));

// TRIP-695 — 홈 라우트가 담은 곳 배지 수(숙소)를 useSavedStays().savedCount 로 물게 되면서
// 이 파일도 <HomeRoute/> 를 렌더하므로 QueryClient 부재 크래시를 막는 무해 스텁이 필요하다
// (딥 경로, features/trip 동명 훅 아님, tabsHomeRoute·tabsShell 선례와 동일 계열). 단언 무변경.
jest.mock('@/features/stay/model/savedStays', () => ({
  useSavedStays: () => ({ savedCount: 0 }),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;
const mockUseSavedPlaces = useSavedPlaces as jest.MockedFunction<
  typeof useSavedPlaces
>;

const TRIP_ID = '33333333-3333-3333-3333-333333333333';

/** 지배 planning 여행 하나(비-ENDED · 미래 출발이라 resolveHomePhase 가 planning 으로 고른다). */
function planningTrip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '부산 여행',
    startDate: '2099-06-10',
    endDate: '2099-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
  };
}

function tripsResult(data: Trip[]) {
  return {
    data,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTrips>;
}

type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

function itineraryOk(
  generationState: (typeof ItineraryGenerationState)[keyof typeof ItineraryGenerationState],
  status: (typeof ItineraryStatus)[keyof typeof ItineraryStatus]
) {
  return {
    data: {
      itineraryId: 'itin-1',
      tripId: TRIP_ID,
      status,
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      isFallback: false,
      generationState,
      days: [] as Itinerary['days'],
    },
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ItineraryHookResult;
}

/** itinerary 조회가 404(일정 없음). 실 isNotFound 가 이 axios shape 를 판정한다. */
const itineraryNotFound = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 404 } },
  isPending: false,
  isError: true,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockNavigate.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
  mockUseSavedPlaces.mockReset();
  mockUseGetTrips.mockReturnValue(tripsResult([planningTrip()]));
  mockUseSavedPlaces.mockReturnValue({
    savedPoiIds: [],
  } as unknown as ReturnType<typeof useSavedPlaces>);
});

describe('🔴 AC-1 · planning + itinerary 404 → home-trip-hero-cta push method(h04)', () => {
  it('일정이 없는 계획 중 여행 카드 CTA 를 누르면 생성 방식 화면으로 push 한다', () => {
    mockUseItinerary.mockReturnValue(itineraryNotFound);

    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));

    // 정확한 문자열 목적지 — 객체 href 나 다른 화면이면 red(문자열 href·판별 강제).
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/method`);
  });
});

describe('🔴 AC-5(홈측) · planning + itinerary PARTIAL → push generating(h09)', () => {
  it('생성 중인 계획 여행 카드 CTA 를 누르면 생성 중 화면으로 push 한다(탭과 같은 규칙)', () => {
    mockUseItinerary.mockReturnValue(
      itineraryOk(ItineraryGenerationState.PARTIAL, ItineraryStatus.PLANNED)
    );

    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));

    expect(mockPush).toHaveBeenCalledWith(
      `/trips/${TRIP_ID}/itinerary/generating`
    );
  });
});

describe('🔴 AC-2 · planning(여행 전) + itinerary CONFIRMED → push live', () => {
  it('확정 일정이 있는 여행 카드 CTA 를 누르면 여행 전이어도 여행 중 화면으로 1회 push 한다', () => {
    mockUseGetTrips.mockReturnValue(
      tripsResult([{ ...planningTrip(), status: 'CONFIRMED' }])
    );
    mockUseItinerary.mockReturnValue(
      itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.CONFIRMED)
    );

    render(<HomeRoute />);

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('🔴 INV-4(홈 CTA) · itinerary 미정착이면 오이동하지 않는다 (code-critic 경고-1)', () => {
  // 왜 필요한가: itinerary GET 이 로딩 중이거나 비-404 오류면 목적지를 아직 모른다.
  // 그때 빈 입력이 resolveItineraryDestination 의 기본값 draft(h11)로 떨어져 오이동하면,
  // 실제 상태가 404·PARTIAL·CONFIRMED 여도 전부 h11 로 착지한다(침묵 미스디렉션). 형제 탭은
  // 이미 로딩/오류를 가드하므로 홈 CTA 도 대칭이어야 한다. 정착 전엔 push 하지 않는 것이 옳다.

  /** itinerary 조회가 아직 로딩 중. */
  const itineraryLoading = {
    data: undefined,
    error: null,
    isPending: true,
    isError: false,
  } as unknown as ItineraryHookResult;

  /** itinerary 조회가 500(서버 오류) — 404 가 아니라 상태를 알 수 없다. */
  const itineraryServerError = {
    data: undefined,
    error: { isAxiosError: true, response: { status: 500 } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;

  it('로딩 중이면 CTA 를 눌러도 아무 데로도 push 하지 않는다', () => {
    mockUseItinerary.mockReturnValue(itineraryLoading);

    render(<HomeRoute />);
    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));

    // 목적지를 모르는 채 draft(h11)로 미는 오이동이 없다.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('비-404 오류(500)면 CTA 를 눌러도 draft 로 오이동하지 않는다', () => {
    mockUseItinerary.mockReturnValue(itineraryServerError);

    render(<HomeRoute />);
    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));

    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-453 · entry 3 — 여행 카드 **본체**(home-trip-hero) 탭도 알약(home-trip-hero-cta)과 같은
// 목적지로 이동한다(기존 onPressTripHeroCta 재사용, 신규 순수함수 0 · 맹점 ⑤).
//
// ⚠️ 실검증으로 드러난 함정(02a ★3·§5 a) — 여기 카드 본체 **press** 테스트들은 전부 **선제
// green(회귀 앵커)**이지 red 가 아니다. `TripHero` 는 onPress 를 prop 으로 받는 **합성 컴포넌트**
// 라, RNTL findEventHandler 가 home-trip-hero(순수 View)에서 위로 올라가다 TripHero 합성요소의
// props.onPress 를 집어 **배선 여부와 무관하게** onPressTripHeroCta 를 발화시킨다(오늘도 카드
// 본체를 누르면 목적지로 push 된다 — 공허 통과). 그래서 "카드 본체가 버튼이 됐다"는 실판정은
// 라우트가 아니라 `HomeScreen.test.tsx` 의 AC-7 버튼-집합(role="button")이 진다. 아래 테스트는
// **구현 후** 값을 낸다: (a) 카드 본체를 알약과 다른 잘못된 목적지·가드 없는 새 함수로 배선하면
// red(목적지·재사용 회귀), (b) 카드 본체 승격 뒤 알약 press 가 2회로 새면 red(이중발화 회귀).

describe('🟢 453-AC-3a · 카드 본체(home-trip-hero) → 알약과 같은 목적지 (구현 후 목적지 앵커)', () => {
  it('planning + itinerary 404 카드 본체 press → method(h04) 로 1회 push(알약과 동일)', () => {
    mockUseItinerary.mockReturnValue(itineraryNotFound);

    render(<HomeRoute />);
    fireEvent.press(screen.getByTestId('home-trip-hero'));

    // 카드 본체를 알약과 **다른** 목적지로 배선하면 red(목적지 회귀). 오늘은 합성-forward 로
    // onPressTripHeroCta 가 불려 우연히 green(공허) — 실 red 는 AC-7 role 이 낸다.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/method`);
  });
});

describe('🟢 453-AC-3a(INV-4) · 카드 본체도 미정착이면 오이동 안 함 (재사용 강제 앵커)', () => {
  // 구현 후 판정력: 카드 본체를 알약이 쓰는 가드(isPending‖비-404 오류→조기반환)가 든
  // onPressTripHeroCta 로 **재사용**하지 않고 가드 없는 새 함수로 배선하면, 로딩에서 push 가
  // 새어 red(맹점 ⑤ 트립와이어). 오늘은 미배선+합성-forward 로 0회(선제 green).
  const itineraryLoading = {
    data: undefined,
    error: null,
    isPending: true,
    isError: false,
  } as unknown as ItineraryHookResult;

  it('로딩 중이면 카드 본체를 눌러도 아무 데로도 push 하지 않는다', () => {
    mockUseItinerary.mockReturnValue(itineraryLoading);

    render(<HomeRoute />);
    fireEvent.press(screen.getByTestId('home-trip-hero'));

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('🟢 453-AC-3b · 카드 본체 배선 뒤에도 알약 press 는 정확히 1회 (이중발화·삼킴 없음)', () => {
  it('planning + 404 에서 알약을 누르면 method 로 정확히 1회만 push 한다', () => {
    // 중첩 Pressable(카드 본체 안 알약) 회귀 앵커(★3). RNTL fireEvent 는 알약(가장 가까운
    // Pressable 합성요소)에서 핸들러를 찾고 멈춰 바깥 카드 본체로 안 번진다 → 이중발화 없음.
    // 카드 본체 승격 뒤 알약 press 가 2회로 새면 red. 오늘·구현 후 모두 1회(선제 green, §5 a).
    mockUseItinerary.mockReturnValue(itineraryNotFound);

    render(<HomeRoute />);
    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/method`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-986 A · 홈 히어로의 라벨·부제·목적지가 **같은 판정(`itinerary.status`)**을 쓴다
// (US-SHELL-02 · US-SCHED-12 · Seed D1 · Q1 · Q2 · Q6).
//
// 결함: 라벨은 `Trip.status`, 목적지는 `itinerary.status` 를 봤다. BE 는 `Trip.status` 를 CONFIRMED 로
// 올리지 않고(날짜로 ACTIVE·ENDED 만 파생) 늘 PLANNED/ACTIVE 로 보내므로, 일정을 확정한 여행도 홈에선
// "일정 이어서 짜기" + "일정을 이어서 짜볼까요"로 보였다. 아래 픽스처는 전부 **BE 실동작 그대로**
// `Trip.status` 를 PLANNED(여행 전)·ACTIVE(여행 중)로 준다(02a ★A-1 — CONFIRMED 로 주면 옛 구현도 통과).
//
// 여행 전 = 2099 시작, 여행 중 = 2020-01-01~2099-12-31(실시계 오늘을 항상 포함, 02a ★A-3).

const SUBTITLE = /일정을 이어서 짜볼까요/;

function tripAt(
  status: Trip['status'],
  startDate: string,
  endDate: string
): Trip {
  return { ...planningTrip(), status, startDate, endDate };
}
const beforeTrip = () => tripAt('PLANNED', '2099-06-10', '2099-06-13');
const duringTrip = () => tripAt('ACTIVE', '2020-01-01', '2099-12-31');

const itineraryPending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

const itineraryServerError = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 500 } },
  isPending: false,
  isError: true,
} as unknown as ItineraryHookResult;

function renderHome(trip: Trip, itinerary: ItineraryHookResult): void {
  mockUseGetTrips.mockReturnValue(tripsResult([trip]));
  mockUseItinerary.mockReturnValue(itinerary);
  render(<HomeRoute />);
}

describe('🔴 986-A1 · 여행 전 + 일정 확정(Trip.status 는 PLANNED) → "확정 일정 보기" · 부제 없음 · live', () => {
  it('라벨·부제·목적지가 모두 확정 판정을 따르고, 배지는 "계획 중"을 유지한다(Q6)', () => {
    renderHome(
      beforeTrip(),
      itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.CONFIRMED)
    );

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '확정 일정 보기'
    );
    // 부제 부재 + 짝: 인사 제목은 그대로 있다(아무것도 안 그려 통과하는 것 차단, 02a ★A-4).
    expect(screen.getByTestId('home-greeting')).not.toHaveTextContent(SUBTITLE);
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(
      /부산 여행 D-/
    );
    expect(screen.getByTestId('home-trip-hero-badge')).toHaveTextContent(
      /^계획 중/
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
  });
});

describe('🔴 986-A2 · 여행 전 + 일정 없음(404) → "일정 만들기" · 부제 없음 · method (Q1)', () => {
  it('일정이 없는데 "이어서 짜기"라고 말하지 않고, 누르면 생성 방식 화면으로 간다', () => {
    renderHome(beforeTrip(), itineraryNotFound);

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 만들기'
    );
    expect(screen.getByTestId('home-greeting')).not.toHaveTextContent(SUBTITLE);
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(
      /부산 여행 D-/
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/method`);
  });
});

describe('🟢 986-A3 · 초안·생성 중은 옛 얼굴 그대로 (회귀 앵커)', () => {
  it('초안(PLANNED+COMPLETE) → "일정 이어서 짜기" · 부제 있음 · draft', () => {
    renderHome(
      beforeTrip(),
      itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.PLANNED)
    );

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기'
    );
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/draft`);
  });

  it('생성 중(PARTIAL) → "일정 이어서 짜기" · generating', () => {
    renderHome(
      beforeTrip(),
      itineraryOk(ItineraryGenerationState.PARTIAL, ItineraryStatus.PLANNED)
    );

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기'
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledWith(
      `/trips/${TRIP_ID}/itinerary/generating`
    );
  });
});

describe('986-A4 · 여행 중(Trip.status ACTIVE)도 라벨은 일정 상태를 따른다 (Seed D3 와 한 판정)', () => {
  it('🟢 확정 → 배지 "여행 중" · "여행 일정 보기" · live', () => {
    renderHome(
      duringTrip(),
      itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.CONFIRMED)
    );

    expect(screen.getByTestId('home-trip-hero-badge')).toHaveTextContent(
      /^여행 중/
    );
    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '여행 일정 보기'
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/live`);
  });

  it('🔴 미확정 초안 → "일정 이어서 짜기" · draft (라벨이 목적지와 같은 판정)', () => {
    renderHome(
      duringTrip(),
      itineraryOk(ItineraryGenerationState.COMPLETE, ItineraryStatus.PLANNED)
    );

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기'
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/draft`);
  });

  it('🔴 일정 없음(404) → "일정 만들기" · method (Q1 — 여행 중 404 도 같은 라벨)', () => {
    renderHome(duringTrip(), itineraryNotFound);

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 만들기'
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).toHaveBeenCalledWith(`/trips/${TRIP_ID}/itinerary/method`);
  });
});

describe('🟢 986-A5 · 일정 미정착(로딩·404 아닌 오류) → Trip.status 폴백 라벨 (Q2 · 02a ★A-2)', () => {
  // 로딩·500·404 는 셋 다 data 가 없다. 라벨을 data 만 보고 만들면 로딩·500 까지 "일정 만들기"로
  // 접힌다 — 아래는 그 오답에서 red 가 나는 트립와이어다(404 는 오류 코드로만 판정).
  it('여행 전 + 로딩 중 → "일정 이어서 짜기" · 부제 있음 · 눌러도 이동 없음', () => {
    renderHome(beforeTrip(), itineraryPending);

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기'
    );
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('여행 전 + 500 → "일정 이어서 짜기" · 부제 있음 (404 아닌 오류를 "일정 없음"으로 말하지 않는다, INV-4)', () => {
    renderHome(beforeTrip(), itineraryServerError);

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '일정 이어서 짜기'
    );
    expect(screen.getByTestId('home-greeting')).toHaveTextContent(SUBTITLE);
  });

  it('여행 중 + 로딩 중 → "여행 일정 보기"', () => {
    renderHome(duringTrip(), itineraryPending);

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '여행 일정 보기'
    );
  });

  it('여행 중 + 500 → "여행 일정 보기" · 눌러도 이동 없음 (500 을 초안으로 접지 않는다, 03b 참고-1)', () => {
    // 여행 전 + 500 은 폴백 라벨이 초안 라벨과 글자까지 같아 "500 → 초안" 오답을 못 가른다.
    // 여행 중이면 폴백('여행 일정 보기')과 초안('일정 이어서 짜기')이 달라 그 오답에서 red 가 난다.
    renderHome(duringTrip(), itineraryServerError);

    expect(screen.getByTestId('home-trip-hero-cta')).toHaveTextContent(
      '여행 일정 보기'
    );

    fireEvent.press(screen.getByTestId('home-trip-hero-cta'));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
