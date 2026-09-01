import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Trip } from '@/shared/api/generated/schemas';

/**
 * TRIP-575 · (tabs)/records.tsx — 기록 탭 허브 라우트 배선(항법).
 *
 * *(개념)* `tabsHomeRoute.test.tsx` 선례와 같은 자리다 — 라우트를 직접 렌더해 실제 네비게이션을
 * 관찰한다. 라우트→페이지가 `useGetTrips`(조회)와 `useRouter().push`(항법)를 물므로, 그 둘을
 * 파일-로컬 목으로 통제해 QueryClientProvider 없이 렌더한다.
 *
 * 무엇을 보장하나:
 *  - AC-4: 지난 여행 카드를 누르면 그 여행의 기록 비교로 push('/trips/{id}/records/compare').
 *  - AC-5: 저장 여행 0건이면 빈 상태 + 새 여행 버튼이 push('/trips/new/step1') · placeholder 소멸.
 *  - AC-6: 이전/다음 월 화살표가 월 상태를 shiftMonth 기반으로 바꾼다(라벨 상대 변화·원복).
 *
 * 3동작 뼈대: 준비=trips 목 + push 스파이 → 실행=render/press → 단언=push 인자·라벨 전이.
 */

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseGetTrips = jest.fn();
jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTrips: (...args: unknown[]) => mockUseGetTrips(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RecordsRoute = require('@/app/(tabs)/records').default;

/** required 10필드를 채운 최소 Trip — 테스트가 보는 축만 덮어쓴다. */
function trip(
  overrides: Pick<Trip, 'tripId' | 'title' | 'startDate' | 'endDate' | 'status'>
): Trip {
  return {
    party: 2,
    destinations: [],
    preferenceSnapshot: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as Trip;
}

function setTrips(data: Trip[]): void {
  mockUseGetTrips.mockReturnValue({
    data,
    isPending: false,
    isError: false,
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockUseGetTrips.mockReset();
});

describe('지난 여행 선택 → 기록 비교 (AC-4)', () => {
  it('카드를 누르면 그 여행의 records/compare로 push한다', () => {
    // 준비: status ENDED 여행 하나(오늘과 무관하게 "지난 여행"이라 결정론).
    setTrips([
      trip({
        tripId: 't9',
        title: '부산 여행',
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        status: 'ENDED',
      }),
    ]);

    render(<RecordsRoute />);
    fireEvent.press(screen.getByTestId('record-calendar-past-trip-t9'));

    expect(mockPush).toHaveBeenCalledWith('/trips/t9/records/compare');
  });
});

describe('빈 상태 → 새 여행 (AC-5 · AC-1)', () => {
  it('저장 여행 0건이면 placeholder가 사라지고 새 여행 버튼이 위저드로 push한다', () => {
    setTrips([]);

    render(<RecordsRoute />);

    // placeholder 계약 종료(셸 교체).
    expect(screen.queryByTestId('shell-tab-placeholder-records')).toBeNull();

    fireEvent.press(screen.getByTestId('record-calendar-empty-create'));

    expect(mockPush).toHaveBeenCalledWith('/trips/new/step1');
  });
});

describe('월 이동 상태 전이 (AC-6)', () => {
  it('다음을 누르면 월 라벨이 바뀌고, 이전을 누르면 원래대로 돌아온다', () => {
    setTrips([
      trip({
        tripId: 't1',
        title: '여행',
        startDate: '2026-05-10',
        endDate: '2026-05-12',
        status: 'ENDED',
      }),
    ]);

    render(<RecordsRoute />);

    // 현재 달 라벨은 시계값이라 모르지만, 상대 변화만으로 shiftMonth 배선을 결정론적으로 잰다.
    const before = screen.getByTestId('record-calendar-month-label').props
      .children;

    fireEvent.press(screen.getByTestId('record-calendar-next'));
    const afterNext = screen.getByTestId('record-calendar-month-label').props
      .children;
    expect(afterNext).not.toBe(before);

    fireEvent.press(screen.getByTestId('record-calendar-prev'));
    const afterPrev = screen.getByTestId('record-calendar-month-label').props
      .children;
    expect(afterPrev).toBe(before);
  });
});
