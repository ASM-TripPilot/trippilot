import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PastTripCardVM } from '@/features/record/model/recordsCalendar';
import type { MonthCell } from '@/shared/date/monthGrid';

import {
  RecordsCalendarScreen,
  type RecordsCalendarScreenProps,
} from './RecordsCalendarScreen';

/**
 * TRIP-575 · RecordsCalendarScreen — j07 여행 캘린더 허브(무상태 프레젠테이션).
 *
 * *(개념)* 이 화면은 판정·조회·라우팅을 **모른다**. 계산된 값(월 라벨·그리드·마킹된 날·지난 여행
 * 카드·빈 상태 여부)과 콜백만 받아 그리고, 누름을 콜백으로 잇는다. 그래서 목이 필요 없다 —
 * props를 직접 넣고 렌더 트리를 관찰한다.
 *
 * 무엇을 보장하나:
 *  - AC-1: placeholder가 아니라 캘린더 허브(record-calendar-month)를 그린다.
 *  - AC-2: 마킹된 날은 색(jest 사각)이 아니라 `accessibilityState.selected`로 관찰된다(★D3).
 *  - AC-3: 지난 여행 카드가 제목·기간(+박수)만 그린다(사진·통계 없음, 정직 degrade).
 *  - AC-5: 저장 여행 0건이면 빈 캘린더 대신 안내 + 새 여행 버튼.
 *  - 누름 배선: 카드→onSelectTrip · 월 화살표→onPress{Prev,Next}Month · 새 여행→onPressCreateTrip.
 *
 * 3동작 뼈대: 준비=props → 실행=render/press → 단언=렌더 트리·콜백 호출.
 */

/** 6월 그리드의 앞부분만 든 최소 픽스처(1일·2일 셀 + 앞 패딩 null). */
const GRID: (MonthCell | null)[] = [
  null,
  { date: '2026-06-01', day: 1 },
  { date: '2026-06-02', day: 2 },
];

const JEJU_CARD: PastTripCardVM = {
  tripId: 't1',
  title: '제주 여행',
  dateRangeLabel: '2026.5.1–5.3',
  nightsLabel: '2박 3일',
};

/** 콜백은 전부 jest.fn 스파이로 두고, 지정 안 한 props만 케이스별로 덮어쓴다. */
function baseProps(
  overrides: Partial<RecordsCalendarScreenProps> = {}
): RecordsCalendarScreenProps {
  return {
    monthLabel: '2026년 6월',
    grid: GRID,
    markedDays: ['2026-06-02'],
    pastTrips: [JEJU_CARD],
    isEmpty: false,
    onPressPrevMonth: jest.fn(),
    onPressNextMonth: jest.fn(),
    onSelectTrip: jest.fn(),
    onPressCreateTrip: jest.fn(),
    ...overrides,
  };
}

describe('채운 상태 — 캘린더 허브 + 마킹(AC-1 · AC-2)', () => {
  it('캘린더를 그리고, 빈 상태 안내는 안 뜨며, 월 라벨을 보여준다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);

    expect(screen.getByTestId('record-calendar-month')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-empty')).toBeNull();
    expect(screen.getByText('2026년 6월')).toBeOnTheScreen();
  });

  it('마킹된 날 셀은 selected, 마킹 안 된 날 셀은 not selected다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);

    // 2일은 markedDays에 있어 selected, 1일은 없어 not selected.
    // (색 fill은 jest 원리적 사각 — accessibilityState로 관찰, ★D3)
    expect(screen.getByTestId('record-calendar-day-2026-06-02')).toBeSelected();
    expect(
      screen.getByTestId('record-calendar-day-2026-06-01')
    ).not.toBeSelected();
  });
});

describe('지난 여행 카드 — 제목·기간·박수만(AC-3)', () => {
  it('카드가 제목·날짜범위·박수 라벨을 그린다', () => {
    render(<RecordsCalendarScreen {...baseProps()} />);

    expect(
      screen.getByTestId('record-calendar-past-trip-t1')
    ).toBeOnTheScreen();
    expect(screen.getByText('제주 여행')).toBeOnTheScreen();
    expect(screen.getByText('2026.5.1–5.3')).toBeOnTheScreen();
    expect(screen.getByText('2박 3일')).toBeOnTheScreen();
  });

  it('라벨이 null이면 가짜 박수를 만들지 않고 제목만 그린다(정직 degrade)', () => {
    render(
      <RecordsCalendarScreen
        {...baseProps({
          pastTrips: [
            {
              tripId: 't2',
              title: '주말 나들이',
              dateRangeLabel: null,
              nightsLabel: null,
            },
          ],
        })}
      />
    );

    expect(
      screen.getByTestId('record-calendar-past-trip-t2')
    ).toBeOnTheScreen();
    expect(screen.getByText('주말 나들이')).toBeOnTheScreen();
    // 부재 단언은 queryByText(정규식) — getByText는 못 찾으면 throw라 못 쓴다.
    expect(screen.queryByText(/\d+박/)).toBeNull();
  });
});

describe('빈 상태 — 저장 여행 0건(AC-5)', () => {
  it('빈 캘린더 대신 안내 + 새 여행 버튼을 그리고, 캘린더는 안 그린다', () => {
    render(
      <RecordsCalendarScreen
        {...baseProps({
          isEmpty: true,
          grid: [],
          markedDays: [],
          pastTrips: [],
        })}
      />
    );

    expect(screen.getByTestId('record-calendar-empty')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-calendar-month')).toBeNull();
    expect(
      screen.getByTestId('record-calendar-empty-create')
    ).toBeOnTheScreen();
  });

  it('새 여행 버튼을 누르면 onPressCreateTrip이 불린다', () => {
    const onPressCreateTrip = jest.fn();
    render(
      <RecordsCalendarScreen
        {...baseProps({
          isEmpty: true,
          grid: [],
          markedDays: [],
          pastTrips: [],
          onPressCreateTrip,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('record-calendar-empty-create'));

    expect(onPressCreateTrip).toHaveBeenCalledTimes(1);
  });
});

describe('누름 배선 — 월 이동·카드 선택(AC-4 · AC-6)', () => {
  it('이전/다음 월 화살표를 누르면 각 콜백이 한 번씩 불린다', () => {
    const onPressPrevMonth = jest.fn();
    const onPressNextMonth = jest.fn();
    render(
      <RecordsCalendarScreen
        {...baseProps({ onPressPrevMonth, onPressNextMonth })}
      />
    );

    fireEvent.press(screen.getByTestId('record-calendar-prev'));
    fireEvent.press(screen.getByTestId('record-calendar-next'));

    expect(onPressPrevMonth).toHaveBeenCalledTimes(1);
    expect(onPressNextMonth).toHaveBeenCalledTimes(1);
  });

  it('지난 여행 카드를 누르면 그 tripId로 onSelectTrip이 불린다', () => {
    const onSelectTrip = jest.fn();
    render(<RecordsCalendarScreen {...baseProps({ onSelectTrip })} />);

    fireEvent.press(screen.getByTestId('record-calendar-past-trip-t1'));

    expect(onSelectTrip).toHaveBeenCalledWith('t1');
  });
});
