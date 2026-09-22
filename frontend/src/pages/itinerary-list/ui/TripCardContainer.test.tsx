import { render, screen } from '@testing-library/react-native';

import type { Itinerary, Trip } from '@/shared/api/generated/schemas';
import { useGetTripsTripIdItinerary } from '@/shared/api/generated/trips/trips';

import { TripCardContainer } from './TripCardContainer';

/**
 * TRIP-788 · AC-1~5(급소) — `TripCardContainer` 의 VM 조립을 처음 심판한다.
 *
 * traps-itinerary: 컨테이너의 상태문·resume 조립을 실행하는 승인 심판이 **0**이었다
 * (`MyTripCard.test.tsx` 는 하드코딩 VM props-only, `tabsItineraryRoute` 는 route 통짜라 카드별
 * 파생을 정밀히 안 잰다). 그래서 컨테이너를 `useGetTripsTripIdItinerary` 목과 **직접 렌더**해
 * `deriveTripCardFace` 관통(상태문·배지·resume)을 카드별로 못박는다 — 순수 `tripCardFace.test.ts`
 * (매핑)와 짝: 순수만으론 컨테이너가 함수를 안 부르고 상수를 박아도 통과한다.
 *
 * 무엇을 보장하나:
 *  - 🔴 **AC-1** PARTIAL → 상태문 'AI가 일정을 짜는 중' · 배지 '작성중' · **resume 부재**(★ seam
 *    누출 트립와이어 — 배지가 '작성중'인데 resume 가 뜨면 red. 배지로 resume 를 가르는 현행이 여기서 샌다).
 *  - 🔴 **AC-2** COMPLETE/FAILED + PLANNED → 상태문 '추천안 준비 중' · resume 존재('일정 이어서 짜기').
 *  - 🔴 **AC-3** CONFIRMED → 상태문 '추천안이 준비됐어요' · 배지 '완성' · resume 부재(구 '확정 장소 N곳' 대체).
 *  - 🔴 **AC-4** isPending → 배지·상태문·resume 전부 부재, 카드·(짝)는 뜬다(공짜 통과 차단).
 *
 * 왜 이렇게 테스트하나: 컨테이너는 `useGetTripsTripIdItinerary` 하나를 물어 VM 을 조립해 순수
 * `MyTripCard`(testIDPrefix="my-trip") 에 내린다. 훅을 목하면 react-query 미구동 →
 * QueryClientProvider 불필요(tabsItineraryRoute 선례). testID 는 `my-trip-{part}-{tripId}`.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripIdItinerary: jest.fn(),
}));

const mockUseItinerary = useGetTripsTripIdItinerary as jest.MockedFunction<
  typeof useGetTripsTripIdItinerary
>;

type ItineraryHookResult = ReturnType<typeof useGetTripsTripIdItinerary>;

/** 여행 한 벌 — tripId 고정(카드 leaf testID 접미). 날짜·인원은 metaLine 조립용(이 테스트 무관). */
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
    ...over,
  };
}

/** 일정 한 벌 — 얼굴 판정에 쓰는 두 축(generationState·status)만 신경(슬롯은 안 셈, 완성 문구가 상수라). */
function itin(
  generationState: Itinerary['generationState'],
  status: Itinerary['status']
): Itinerary {
  return {
    itineraryId: 'itin-1',
    tripId: 't1',
    status,
    solveMode: 'FULL_AI',
    generationMode: 'FULLY_AI',
    isFallback: false,
    generationState,
    days: [],
  };
}

function itinOk(data: Itinerary): ItineraryHookResult {
  return {
    data,
    error: null,
    isPending: false,
    isError: false,
  } as unknown as ItineraryHookResult;
}

const itinPending = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
} as unknown as ItineraryHookResult;

beforeEach(() => {
  mockUseItinerary.mockReset();
});

describe('🔴 AC-1 · 생성중(PARTIAL) — resume 누출 seam', () => {
  it('상태문 "AI가 일정을 짜는 중" · 배지 "작성중" · resume 부재(배지=작성중이어도 resume 안 샌다)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('PARTIAL', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      'AI가 일정을 짜는 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    // ★ 트립와이어 — 배지가 '작성중'(draft)인데 resume 는 없어야 한다(배지로 가르면 여기서 샌다).
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-2 · 초안 — resume 존재', () => {
  it('COMPLETE+PLANNED → "추천안 준비 중" · "일정 이어서 짜기" resume 존재', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('작성중');
    expect(screen.getByTestId('my-trip-resume-t1')).toHaveTextContent(
      '일정 이어서 짜기'
    );
  });

  it('FAILED+PLANNED(Q3) → 초안 얼굴로 접힌다(별도 실패 얼굴 없음, resume 존재)', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('FAILED', 'PLANNED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안 준비 중'
    );
    expect(screen.getByTestId('my-trip-resume-t1')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3 · 완성(CONFIRMED)', () => {
  it('상태문 "추천안이 준비됐어요"(구 "확정 장소 N곳" 대체) · 배지 "완성" · resume 부재', () => {
    mockUseItinerary.mockReturnValue(itinOk(itin('COMPLETE', 'CONFIRMED')));

    render(<TripCardContainer trip={trip()} />);

    expect(screen.getByTestId('my-trip-extra-t1')).toHaveTextContent(
      '추천안이 준비됐어요'
    );
    expect(screen.getByTestId('my-trip-badge-t1')).toHaveTextContent('완성');
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();
  });
});

describe('🔴 AC-4 · degrade(isPending) — 배지·상태문·resume 부재, 카드는 뜬다', () => {
  it('itinerary 미도착이면 배지·부가정보·resume 이 없고 카드·제목만 남는다', () => {
    mockUseItinerary.mockReturnValue(itinPending);

    render(<TripCardContainer trip={trip()} />);

    expect(screen.queryByTestId('my-trip-badge-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-extra-t1')).toBeNull();
    expect(screen.queryByTestId('my-trip-resume-t1')).toBeNull();

    // 짝 — 카드 골격(루트·제목)은 그대로 뜬다(아무것도 안 그려서 위 부정이 공짜 통과하는 것 차단).
    expect(screen.getByTestId('my-trip-card-t1')).toBeOnTheScreen();
    expect(screen.getByTestId('my-trip-title-t1')).toBeOnTheScreen();
  });
});
