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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

jest.mock('@/features/explore/model/savedPlaces', () => ({
  useSavedPlaces: jest.fn(),
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
