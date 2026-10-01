import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Itinerary } from '@/shared/api/generated/schemas';

import { ItineraryMethodPage } from './ItineraryMethodPage';

/**
 * TRIP-1011 C(#039) · AC-C1 — 3/4(방식 선택)의 "거점 숙소 다시 고르기" 진입.
 *
 * 왜 필요한가: 2/4 → 3/4 는 `replace` 라(TRIP-672 AC-5, D8 유지) 3/4 에서 뒤로 가면 위저드 밖으로
 * 나간다. 거점을 다시 고를 길을 뒤로가기 대신 **링크**로 연다.
 *
 * 무엇을 보장하나:
 *  - 링크를 누르면 여행 단위 거점 화면(`/trips/[tripId]/bases`)으로 **push** 한다(replace 가 아니다 —
 *    돌아올 3/4 가 스택에 남아야 두 CTA 의 `back()` 이 3/4 로 온다).
 *  - 기존 일정이 있어도 링크는 보인다(브리프 §2⑤ 권고 — 바꾼 거점은 다음 생성부터 반영된다).
 *
 * 형제 `ItineraryMethodPage.integration.test.tsx` 는 `replace` 목이 렌더마다 새로 만들어져 "replace 안
 * 함"을 못 잰다 — 그래서 목을 고정한 별 파일로 둔다(기존 파일 무변경).
 *
 * ⚠️ `jest.mock` 팩토리가 참조하는 바깥 변수는 이름이 `mock` 으로 시작해야 한다(리포 확립 규칙).
 */

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockItineraryData: Itinerary | undefined;

jest.mock('@/shared/api/generated/trips/trips', () => ({
  usePostTripsTripIdItinerary: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
  useGetTripsTripIdItinerary: () => ({
    data: mockItineraryData,
    isPending: false,
    isError: mockItineraryData === undefined,
  }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  router: { push: mockPush, back: mockBack, replace: mockReplace },
}));

const TRIP_ID = 't1';

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockItineraryData = undefined; // 기본 = 기존 일정 없음(404).
});

describe('AC-C1 · 3/4 의 "거점 숙소 다시 고르기"', () => {
  it('링크가 보이고, 누르면 /trips/[tripId]/bases 로 tripId 를 싣고 push 한 번 — replace 는 없다', () => {
    render(<ItineraryMethodPage tripId={TRIP_ID} />);

    const link = screen.getByTestId('itinerary-method-rebase');
    // 앵커 — 누르기 전엔 이동이 없다.
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.press(link);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/trips/[tripId]/bases',
      params: { tripId: TRIP_ID },
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('기존 일정이 있어도 링크는 보인다 (브리프 §2⑤)', () => {
    mockItineraryData = {
      itineraryId: 'itin-x',
      tripId: TRIP_ID,
      status: 'PLANNED',
      solveMode: 'FULL_AI',
      generationMode: 'FULLY_AI',
      generationState: 'COMPLETE',
      isFallback: false,
      days: [{ date: '2026-06-10', slots: [] }],
    };
    render(<ItineraryMethodPage tripId={TRIP_ID} />);

    expect(screen.getByTestId('itinerary-method-rebase')).toBeOnTheScreen();
  });
});
