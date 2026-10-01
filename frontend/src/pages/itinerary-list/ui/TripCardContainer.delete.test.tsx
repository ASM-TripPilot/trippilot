import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-1055 · AC-1 — 어떤 카드에 ⋯(삭제 진입점)를 두는가. 판정은 컨테이너가 한다(UX 사본 — 정본 판정은
 * 서버 BR-U1-57. 단 서버 상태 가드 TRIP-1061 이 아직 없어 **지금은 이 판정이 유일한 방어**다).
 *
 * 규칙(01b Seed Q1·Q2·Q3): 삭제 가능 = 조회가 끝났고 · 카드 배지가 '작성중'(draft)이고 · 진행 중 생성
 * 세션(`generationSessionId`)이 없다.
 *  - 날짜가 지나 여행 상태가 ACTIVE/ENDED 여도 배지가 '작성중'이면 지울 수 있다(Q3 — 보이는 배지와 맞춘다).
 *  - 생성을 취소해 PARTIAL 로 남은 여행(세션 없음)은 지울 수 있다(Q2).
 *  - 확정(여행 중·끝남 포함)·생성 중·아직 모름(로딩·404 아닌 실패)은 ⋯ 자체가 없다(Q1).
 *
 * 그리고 메뉴 열림을 컨테이너가 쥔다 — ⋯ 로 토글, '삭제' 항목을 누르면 닫고 `onPressDelete` 를 올린다.
 *
 * ⚠️ 이 파일의 생성물 목에는 조회 훅 하나만 있다. 컨테이너가 삭제 mutation 을 부르면 여기서 터진다 —
 * mutation 은 페이지 몫이라는 계약(02a §2-2)을 이 목이 지킨다.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;
type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

function trip(over: Partial<Trip> = {}): Trip {
  return {
    tripId: 't1',
    title: '제주 여행',
    startDate: '2026-06-10',
    endDate: '2026-06-13',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '제주', nights: 3 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    baseCount: 0,
    itineraryDayCount: 0,
    ...over,
  };
}

function itin(
  generationState: Itinerary['generationState'],
  status: Itinerary['status'],
  generationSessionId: string | null = null
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 't1',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    generationSessionId,
    days: [],
  };
}

const ok = (data: Itinerary) =>
  ({
    data,
    error: null,
    isPending: false,
    isError: false,
  }) as unknown as ItineraryHookResult;

const notFound = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 404 } },
  isPending: false,
  isError: true,
} as unknown as ItineraryHookResult;

const serverError = {
  data: undefined,
  error: { isAxiosError: true, response: { status: 500 } },
  isPending: false,
  isError: true,
} as unknown as ItineraryHookResult;

const pending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockUseItinerary.mockReset();
  mockPush.mockClear();
});

describe('🔴 TRIP-1055 AC-1 · 삭제 가능한 카드에는 ⋯ 가 있다', () => {
  it.each<[string, Partial<Trip>, ItineraryHookResult]>([
    ['일정 없음(404)', {}, notFound],
    ['초안(COMPLETE + PLANNED)', {}, ok(itin('COMPLETE', 'PLANNED'))],
    ['초안(FAILED + PLANNED)', {}, ok(itin('FAILED', 'PLANNED'))],
    [
      '생성을 취소해 남은 부분 결과(PARTIAL · 세션 없음, Q2)',
      {},
      ok(itin('PARTIAL', 'PLANNED', null)),
    ],
    [
      '날짜가 되어 ACTIVE 인 미확정 초안(Q3)',
      { status: 'ACTIVE' },
      ok(itin('COMPLETE', 'PLANNED')),
    ],
    [
      '날짜가 지나 ENDED 인 미확정 초안(Q3)',
      { status: 'ENDED' },
      ok(itin('COMPLETE', 'PLANNED')),
    ],
  ])('%s', (_label, tripOver, hook) => {
    // 준비 — 그 상태의 일정 응답.
    mockUseItinerary.mockReturnValue(hook);

    // 실행 — 삭제 콜백을 주고 렌더.
    render(
      <TripCardContainer trip={trip(tripOver)} onPressDelete={jest.fn()} />
    );

    // 단언 — ⋯ 가 있다.
    expect(screen.getByTestId('my-trip-menu-t1')).toBeOnTheScreen();
  });
});

describe('TRIP-1055 AC-1 · 삭제할 수 없는 카드에는 ⋯ 가 없다 (금지 단언)', () => {
  it.each<[string, Partial<Trip>, ItineraryHookResult]>([
    ['확정(CONFIRMED)', {}, ok(itin('COMPLETE', 'CONFIRMED'))],
    [
      '여행 중(ACTIVE + CONFIRMED)',
      { status: 'ACTIVE' },
      ok(itin('COMPLETE', 'CONFIRMED')),
    ],
    [
      '끝난 여행(ENDED + CONFIRMED)',
      { status: 'ENDED' },
      ok(itin('COMPLETE', 'CONFIRMED')),
    ],
    [
      '생성 중(PARTIAL · 진행 중 세션 있음, Q1·Q2)',
      {},
      ok(itin('PARTIAL', 'PLANNED', 'sess-1')),
    ],
    // 재생성 1차 구간 — 일정 행은 옛 값(COMPLETE·FAILED)으로 보이는데 세션이 돈다. 판정 축은 세션뿐이다
    // (공용 `isGenerationRunning`, TRIP-1032 5-b 경고-3 · 이번 5-b 경고-2).
    [
      '재생성 직후(COMPLETE + PLANNED · 세션 있음)',
      {},
      ok(itin('COMPLETE', 'PLANNED', 'sess-2')),
    ],
    [
      '재생성 직후(FAILED + PLANNED · 세션 있음)',
      {},
      ok(itin('FAILED', 'PLANNED', 'sess-3')),
    ],
    ['아직 모름(조회 중)', {}, pending],
    ['아직 모름(404 아닌 조회 실패)', {}, serverError],
  ])('%s', (_label, tripOver, hook) => {
    // 준비
    mockUseItinerary.mockReturnValue(hook);

    // 실행 — 삭제 콜백을 줘도.
    render(
      <TripCardContainer trip={trip(tripOver)} onPressDelete={jest.fn()} />
    );

    // 단언 — 카드는 뜨지만(앵커) ⋯ 는 없다.
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
  });

  it('삭제 콜백을 안 주면 삭제 가능한 카드여도 ⋯ 가 없다 (기존 소비처 무변경)', () => {
    mockUseItinerary.mockReturnValue(notFound);

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.queryByTestId('my-trip-menu-t1')).toBeNull();
  });
});

describe('🔴 TRIP-1055 AC-2·3 · ⋯ 는 토글, "삭제" 항목은 메뉴를 닫고 삭제 요청만 올린다', () => {
  it('⋯ → 메뉴 열림 → ⋯ → 닫힘 → ⋯ → 삭제 항목 → 콜백 1번·메뉴 닫힘, 화면 이동은 0번', () => {
    // 준비 — 삭제 가능한 카드(일정 없음).
    mockUseItinerary.mockReturnValue(notFound);
    const onPressDelete = jest.fn();
    render(<TripCardContainer trip={trip()} onPressDelete={onPressDelete} />);
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

    // 실행 ① — ⋯ 를 누르면 메뉴가 열린다(아직 아무것도 안 지운다).
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    expect(screen.getByTestId('my-trip-menu-delete-t1')).toBeOnTheScreen();
    expect(onPressDelete).not.toHaveBeenCalled();

    // 실행 ② — ⋯ 를 다시 누르면 닫힌다(토글).
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();

    // 실행 ③ — 다시 열고 '삭제' 항목을 누른다.
    fireEvent.press(screen.getByTestId('my-trip-menu-t1'));
    fireEvent.press(screen.getByTestId('my-trip-menu-delete-t1'));

    // 단언 — 삭제 요청 1번, 메뉴는 닫혔고, 카드 화면 이동은 한 번도 없었다.
    expect(onPressDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('my-trip-menu-delete-t1')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
