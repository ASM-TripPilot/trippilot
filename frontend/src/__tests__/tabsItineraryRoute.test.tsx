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
import ItineraryTab from '@/app/(tabs)/itinerary';

/**
 * (tabs)/일정 진입 라우트 — 죽은 껍데기가 아니라 **일정 상태에 맞는 화면으로** 리다이렉트하거나
 * 빈 상태를 준다. TRIP-401로 재작성: 첫 여행의 itinerary GET 을 물어 상태별 목적지를 가른다.
 *
 * 무엇을 보장하나:
 *  - 🟢 **여행이 없으면** 빈 상태 + [여행 만들기](리다이렉트 없음) — 버튼이 여행 생성으로 이동(무회귀).
 *  - 🔴 **여행이 있으면** 그 여행 itinerary 상태로 목적지를 가른다: 404→method(h04) ·
 *    PARTIAL→generating(h09) · COMPLETE+PLANNED→draft(h11) · CONFIRMED→h25.
 *  - 🔴 itinerary 조회가 **로딩/실패(비-404)** 면 오이동하지 않는다(INV-4 · AC-8).
 *
 * 왜 이렇게 테스트하나: 라우트 컴포넌트는 router 가 렌더해 props 를 못 받으므로, 여행 목록과
 * itinerary 상태는 훅 seam(`useGetTrips`·`useGetTripsTripIdItinerary`)으로 주입해 목으로 갈아끼운다.
 * expo-router `Redirect` 는 라우터 컨텍스트 없이 관찰하려고 마커로 목킹한다 — 목적지 href 를
 * `redirect-href` 텍스트로 노출한다.
 *
 * *(개념)* expo-router `<Redirect href>`: 렌더 즉시 href 로 보내는 선언형 리다이렉트. 목은
 *   `String(href)` 를 그리므로 라우트는 **문자열 href** 를 써야 관찰된다(객체면 `[object Object]`).
 *
 * *(매처)* `toHaveTextContent('문자열')` 은 이 리포에서 **완전일치**다(node_modules matches.js 실검증,
 *   02a §5-a). 마커 텍스트가 목적지 href 전체라 완전일치가 곧 판별기 — `/itinerary/draft` 는
 *   `/itinerary/generating` 과 다르고, plan(`/itinerary`) 은 접미 붙은 것들과 다르다. 부분매치
 *   정규식을 쓰면 `/itinerary/*` 접미가 전부 겹쳐 판별 불능이므로 **정확일치 문자열**을 쓴다(02a ★6).
 *
 * 커버 밖(02a ★3): 여러 여행 중 "어느 것"인지 규칙은 정본에 없어 첫 여행(list[0])만 잰다.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...require('@/test-support/expoRouterRedirectMock'),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: jest.fn(),
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseGetTrips = useGetTrips as jest.MockedFunction<typeof useGetTrips>;
const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

const TRIP_ID = '22222222-2222-2222-2222-222222222222';

function trip(): Trip {
  return {
    tripId: TRIP_ID,
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
  };
}

/** 라우트가 쓰는 필드(data·isPending·isError)만 채운 여행 목록 조회 결과. */
function tripsResult(data: Trip[]) {
  return {
    data,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useGetTrips>;
}

/** 지정한 진행/확정 상태의 Itinerary 응답 한 벌(목적지 판정에 필요한 두 축만 신경). */
function itinerary(
  generationState: (typeof ItineraryGenerationState)[keyof typeof ItineraryGenerationState],
  status: (typeof ItineraryStatus)[keyof typeof ItineraryStatus]
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: TRIP_ID,
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    days: [],
  };
}

type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

/** itinerary 조회 결과(data 도착). */
function itineraryOk(data: Itinerary) {
  return {
    data,
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ItineraryHookResult;
}

/** itinerary 조회가 axios 상태코드 오류로 실패(404·500 등). isNotFound 가 실제로 판정한다. */
function itineraryHttpError(statusCode: number) {
  return {
    data: undefined,
    error: { isAxiosError: true, response: { status: statusCode } },
    isPending: false,
    isError: true,
  } as unknown as ItineraryHookResult;
}

/** itinerary 조회 진행 중. */
const itineraryPending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
  mockUseItinerary.mockReset();
});

describe('🟢 X1 · 여행이 없으면 빈 상태 + [여행 만들기] (무회귀)', () => {
  it('빈 상태를 그리고 리다이렉트하지 않으며, 버튼이 여행 생성으로 이동한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([]));

    render(<ItineraryTab />);

    expect(screen.getByTestId('itinerary-tab-empty')).toBeOnTheScreen();
    expect(screen.getByText('여행 만들기')).toBeOnTheScreen();
    // 부정 짝 — 아무 데로도 리다이렉트하지 않는다.
    expect(screen.queryByTestId('redirect-href')).toBeNull();

    fireEvent.press(screen.getByTestId('itinerary-tab-create-trip'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(String(mockPush.mock.calls[0][0])).toContain('/trips/new');
  });
});

describe('🔴 AC-5(표) · itinerary 404 → method(h04)', () => {
  it('첫 여행 일정이 없으면(404) 생성 방식 화면으로 리다이렉트한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));
    mockUseItinerary.mockReturnValue(itineraryHttpError(404));

    render(<ItineraryTab />);

    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      `/trips/${TRIP_ID}/itinerary/method`
    );
    expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
  });
});

describe('🔴 AC-2 · itinerary PARTIAL → generating(h09)', () => {
  it('생성 진행 중이면 생성 중 화면으로 리다이렉트한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));
    mockUseItinerary.mockReturnValue(
      itineraryOk(
        itinerary(ItineraryGenerationState.PARTIAL, ItineraryStatus.PLANNED)
      )
    );

    render(<ItineraryTab />);

    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      `/trips/${TRIP_ID}/itinerary/generating`
    );
  });
});

describe('🔴 AC-4 · itinerary COMPLETE+PLANNED → draft(h11)', () => {
  it('완성됐지만 미확정이면 초안 화면으로 리다이렉트한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));
    mockUseItinerary.mockReturnValue(
      itineraryOk(
        itinerary(ItineraryGenerationState.COMPLETE, ItineraryStatus.PLANNED)
      )
    );

    render(<ItineraryTab />);

    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      `/trips/${TRIP_ID}/itinerary/draft`
    );
  });
});

describe('🟢 AC-3 · itinerary CONFIRMED → h25 (선제 green)', () => {
  it('확정 일정이면 완성 시간표(index)로 리다이렉트한다 — 접미 없는 문자열', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));
    mockUseItinerary.mockReturnValue(
      itineraryOk(
        itinerary(ItineraryGenerationState.COMPLETE, ItineraryStatus.CONFIRMED)
      )
    );

    render(<ItineraryTab />);

    // 완전일치라 draft/generating 접미가 붙으면 실패한다(판별기).
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      `/trips/${TRIP_ID}/itinerary`
    );
  });
});

describe('🔴 AC-8 · itinerary 로딩 중이면 오이동하지 않는다 (INV-4)', () => {
  it('itinerary 조회가 로딩 중이면 리다이렉트도 "여행 없음"도 아니다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));
    mockUseItinerary.mockReturnValue(itineraryPending);

    render(<ItineraryTab />);

    // 부정 짝 — 목적지를 모르는 동안 아무 데로도 보내지 않고, 여행 없음으로 뭉개지도 않는다.
    expect(screen.queryByTestId('redirect-href')).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
  });
});

describe('🔴 AC-8 · itinerary 조회 실패(비-404)면 여행 없음으로 뭉개지 않는다 (INV-4)', () => {
  it('itinerary 조회가 500 이면 리다이렉트도 "여행 없음"도 아니다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([trip()]));
    mockUseItinerary.mockReturnValue(itineraryHttpError(500));

    render(<ItineraryTab />);

    // 500 은 404 가 아니므로 method 로 보내지 않는다. 오이동·여행없음 둘 다 배제.
    expect(screen.queryByTestId('redirect-href')).toBeNull();
    expect(screen.queryByTestId('itinerary-tab-empty')).toBeNull();
  });
});

// 오늘을 항상 포함하는 여행(과거~미래로 넓게) — 실제 오늘 날짜에 의존하지 않게 폭을 크게 둔다.
function activeTrip(): Trip {
  return { ...trip(), startDate: '2020-01-01', endDate: '2099-12-31' };
}

describe('🔴 TRIP-395 · 활성 여행이 오늘 구간 안이면 여행 중 화면(live)으로 보낸다 (US-ONTRIP-01)', () => {
  it('오늘이 여행 구간 안이고 일정이 있으면 /trips/{id}/live 로 보낸다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([activeTrip()]));
    mockUseItinerary.mockReturnValue(
      itineraryOk(itinerary('COMPLETE', 'PLANNED'))
    );

    render(<ItineraryTab />);

    // 완전일치 — live 접미가 붙은 목적지여야 한다(draft·plan 등과 다르다).
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      `/trips/${TRIP_ID}/live`
    );
  });

  it('오늘이 구간 안이어도 일정이 없으면(404) live 가 아니라 생성(method)으로 폴백한다', () => {
    mockUseGetTrips.mockReturnValue(tripsResult([activeTrip()]));
    mockUseItinerary.mockReturnValue(itineraryHttpError(404));

    render(<ItineraryTab />);

    // 보여줄 일정이 없으므로 live 로 보내지 않는다 — 생성 방식부터.
    expect(screen.getByTestId('redirect-href')).toHaveTextContent(
      `/trips/${TRIP_ID}/itinerary/method`
    );
  });
});
