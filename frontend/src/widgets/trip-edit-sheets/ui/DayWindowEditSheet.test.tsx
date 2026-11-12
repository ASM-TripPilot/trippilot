import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { DayWindow } from '@/features/create-trip';
import { WHEEL_CELL_HEIGHT } from '@/shared/ui/WheelPicker';
import { DayWindowEditSheet } from './DayWindowEditSheet';

/**
 * TRIP-1308 일과 시간 시트 — 탭 전환·켜기/끄기·되돌리기 비활성·적용 결과·당일치기 오류.
 * 실제 개폐·휠 제스처는 jest 사각(6-b). 여기서는 값 흐름만 본다.
 */
function open(value: DayWindow = {}, sameDay = false, periodUnset = false) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  render(
    <DayWindowEditSheet
      value={value}
      sameDay={sameDay}
      periodUnset={periodUnset}
      onApply={onApply}
      onClose={onClose}
    />
  );
  return { onApply, onClose };
}

const tabValue = (key: string) =>
  screen.getByTestId(`trip-wizard-daywindow-tab-${key}-value`);
const pick = (id: string) => fireEvent.press(screen.getByTestId(id));

describe('여러 날 — 탭', () => {
  it('기본 값: 하루 시작 09:00, 첫날·마지막 날은 "따로 안 정해요", 되돌리기 비활성', () => {
    open();
    expect(tabValue('day')).toHaveTextContent('09:00');
    expect(tabValue('first')).toHaveTextContent('따로 안 정해요');
    expect(tabValue('last')).toHaveTextContent('따로 안 정해요');
    expect(screen.getByTestId('trip-wizard-daywindow-reset')).toBeDisabled();
    expect(screen.getByTestId('trip-wizard-daywindow-hint')).toHaveTextContent(
      '모든 날에 공통으로 적용돼요'
    );
  });

  // TRIP-1423 (Q-058) — 옛 계약("누르면 12:00 · 18:00 이 바로 켜진다")을 뒤집었다. 탭은 보기만 한다.
  it('안 정한 탭을 눌러도 값은 생기지 않는다 — "따로 안 정해요" 그대로, 설명만 바뀌고 되돌리기는 꺼진 채다', () => {
    open();
    pick('trip-wizard-daywindow-tab-first');
    expect(tabValue('first')).toHaveTextContent('따로 안 정해요');
    expect(screen.getByTestId('trip-wizard-daywindow-hint')).toHaveTextContent(
      '비행기·KTX 도착 뒤에 시작해요'
    );
    pick('trip-wizard-daywindow-tab-last');
    expect(tabValue('last')).toHaveTextContent('따로 안 정해요');
    expect(screen.getByTestId('trip-wizard-daywindow-hint')).toHaveTextContent(
      '출발 전에 끝내요'
    );
    // 드래프트가 아직 기본이다 → 되돌리기 비활성 그대로(값을 넣고 글자만 숨긴 구현이 여기서 red)
    expect(screen.getByTestId('trip-wizard-daywindow-reset')).toBeDisabled();
  });

  it('휠 셀로 고른 시·분이 선택 탭의 값이 된다', () => {
    open();
    pick('trip-wizard-daywindow-tab-first');
    pick('trip-wizard-daywindow-wheel-h-14');
    pick('trip-wizard-daywindow-wheel-m-30');
    expect(tabValue('first')).toHaveTextContent('14:30');
    expect(tabValue('day')).toHaveTextContent('09:00');
  });

  it('"따로 정하지 않기"는 그 값만 끄고 하루 시작 탭으로 돌아간다', () => {
    open({ firstDayStartAt: '14:00', lastDayEndAt: '16:00' });
    pick('trip-wizard-daywindow-tab-first');
    pick('trip-wizard-daywindow-off');
    expect(tabValue('first')).toHaveTextContent('따로 안 정해요');
    expect(tabValue('last')).toHaveTextContent('16:00');
    expect(screen.queryByTestId('trip-wizard-daywindow-off')).toBeNull();
  });

  it('하루 시작 탭에는 "따로 정하지 않기"가 없다', () => {
    open();
    expect(screen.queryByTestId('trip-wizard-daywindow-off')).toBeNull();
  });

  it('기본값으로 되돌리기는 세 값을 모두 지운다', () => {
    const { onApply } = open({
      dayStartAt: '11:00',
      firstDayStartAt: '14:00',
      lastDayEndAt: '16:00',
    });
    pick('trip-wizard-daywindow-reset');
    expect(tabValue('day')).toHaveTextContent('09:00');
    expect(tabValue('first')).toHaveTextContent('따로 안 정해요');
    expect(screen.getByTestId('trip-wizard-daywindow-reset')).toBeDisabled();
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({});
  });
});

describe('여러 날 — 적용', () => {
  it('안 건드리고 적용하면 빈 객체(키 없음)', () => {
    const { onApply } = open();
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({});
  });

  it('정한 값만 담아 돌려준다', () => {
    const { onApply } = open();
    pick('trip-wizard-daywindow-wheel-h-11');
    pick('trip-wizard-daywindow-tab-last');
    pick('trip-wizard-daywindow-wheel-h-16');
    pick('trip-wizard-daywindow-wheel-m-00');
    pick('trip-wizard-daywindow-apply');
    const sent = onApply.mock.calls[0][0] as DayWindow;
    expect(sent).toEqual({ dayStartAt: '11:00', lastDayEndAt: '16:00' });
    expect('firstDayStartAt' in sent).toBe(false);
  });

  it('하루 시작을 09:00 으로 되돌려 고르면 기본이라 키가 빠진다', () => {
    const { onApply } = open({ dayStartAt: '11:00' });
    pick('trip-wizard-daywindow-wheel-h-09');
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({});
  });

  it('하루 시작이 일과 종료(21:00) 이후면 오류를 보이고 적용을 막는다', () => {
    const { onApply } = open();
    pick('trip-wizard-daywindow-wheel-h-21');
    expect(screen.getByTestId('trip-wizard-daywindow-error')).toBeTruthy();
    expect(screen.getByTestId('trip-wizard-daywindow-apply')).toBeDisabled();
    pick('trip-wizard-daywindow-apply');
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('당일치기 — 시작/끝 두 칸', () => {
  it('탭 없이 두 칸이 보이고, 정한 값은 첫날 시작·마지막 날 종료로 매핑된다', () => {
    const { onApply } = open({}, true);
    expect(screen.queryByTestId('trip-wizard-daywindow-tab-day')).toBeNull();
    pick('trip-wizard-daywindow-start-h-10');
    pick('trip-wizard-daywindow-end-h-18');
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({
      firstDayStartAt: '10:00',
      lastDayEndAt: '18:00',
    });
  });

  it('끝 ≤ 시작이면 종료 칸에만 오류가 뜨고 적용이 막힌다', () => {
    const { onApply } = open({ firstDayStartAt: '10:00' }, true);
    pick('trip-wizard-daywindow-end-h-10');
    pick('trip-wizard-daywindow-end-m-00');
    expect(
      screen.getByTestId('trip-wizard-daywindow-error-end')
    ).toHaveTextContent('종료는 시작보다 늦어야 해요');
    expect(screen.getByTestId('trip-wizard-daywindow-apply')).toBeDisabled();
    pick('trip-wizard-daywindow-apply');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('18:00 시작 · 10:00 끝(경계)은 막히고, 끝을 늦추면 풀린다', () => {
    const { onApply } = open(
      { firstDayStartAt: '18:00', lastDayEndAt: '10:00' },
      true
    );
    expect(screen.getByTestId('trip-wizard-daywindow-error-end')).toBeTruthy();
    pick('trip-wizard-daywindow-end-h-20');
    expect(screen.queryByTestId('trip-wizard-daywindow-error-end')).toBeNull();
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({
      firstDayStartAt: '18:00',
      lastDayEndAt: '20:00',
    });
  });

  it('시작·끝이 기본과 같으면 키가 실리지 않는다', () => {
    const { onApply } = open({ firstDayStartAt: '10:00' }, true);
    pick('trip-wizard-daywindow-start-h-09');
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({});
  });
});

/** 휠이 index 번째 값이 가운데 오는 위치에서 멈췄다고 알린다(관성 스크롤 정지 신호를 직접 쏜다). */
function settle(wheelTestID: string, index: number) {
  fireEvent(screen.getByTestId(wheelTestID), 'momentumScrollEnd', {
    nativeEvent: { contentOffset: { x: 0, y: index * WHEEL_CELL_HEIGHT } },
  });
}

/** 접두(`trip-wizard-daywindow-wheel` 등)의 시·분 칸 요소 — 휠 ScrollView(`-h-wheel`)는 `\d\d` 에 안 걸린다. */
const cells = (prefix: string, unit: 'h' | 'm') =>
  screen.queryAllByTestId(new RegExp(`^${prefix}-${unit}-\\d\\d$`));
const selectedCount = (prefix: string) =>
  [...cells(prefix, 'h'), ...cells(prefix, 'm')].filter(
    (node) => node.props.accessibilityState?.selected
  ).length;

const WHEEL = 'trip-wizard-daywindow-wheel';

// TRIP-1423 (Q-058) — [첫날]·[마지막 날] 탭 누름은 "보기만"이다. 휠은 제안 자리(12:00 · 18:00)에 서 있기만 하고
// (TRIP-1437 `anchor`), 사용자가 휠을 돌리거나 칸을 눌러야 값이 생긴다.
describe('TRIP-1423 · 안 정한 탭은 보기만 — 휠은 제안 자리에 서고 값은 고를 때만 생긴다', () => {
  it('첫날·마지막 날 탭은 선택된 칸이 없다 · 하루 시작 탭(짝)은 09:00 이 선택돼 있다', () => {
    open();

    pick('trip-wizard-daywindow-tab-first');
    expect(selectedCount(WHEEL)).toBe(0);

    pick('trip-wizard-daywindow-tab-last');
    expect(selectedCount(WHEEL)).toBe(0);

    // 짝 — 값이 있는 탭은 그 칸이 선택돼 있다("아무 칸도 선택 안 함"으로 짠 구현이 red).
    pick('trip-wizard-daywindow-tab-day');
    expect(screen.getByTestId(`${WHEEL}-h-09`)).toBeSelected();
    expect(screen.getByTestId(`${WHEEL}-m-00`)).toBeSelected();
  });

  it('첫날·마지막 날 탭을 눌러 보기만 하고 적용하면 onApply 인자에 두 키가 없다', () => {
    const { onApply } = open();
    pick('trip-wizard-daywindow-tab-first');
    pick('trip-wizard-daywindow-tab-last');

    pick('trip-wizard-daywindow-apply');

    expect(onApply).toHaveBeenCalledTimes(1);
    const sent = onApply.mock.calls[0][0] as DayWindow;
    expect(sent).toEqual({});
    expect('firstDayStartAt' in sent).toBe(false);
    expect('lastDayEndAt' in sent).toBe(false);
  });

  it('첫날 탭을 봤다가 하루 시작 탭에서 11:00 을 고르고 적용해도 첫날 키는 없다', () => {
    const { onApply } = open();
    pick('trip-wizard-daywindow-tab-first');
    pick('trip-wizard-daywindow-tab-day');
    pick(`${WHEEL}-h-11`);

    pick('trip-wizard-daywindow-apply');

    const sent = onApply.mock.calls[0][0] as DayWindow;
    expect(sent).toEqual({ dayStartAt: '11:00' });
    expect('firstDayStartAt' in sent).toBe(false);
  });

  it('첫날 탭에서 시 휠이 14 칸에 멈추면 그때 값이 생긴다 — 탭 값 14:00 · 적용 인자에 실린다', () => {
    const { onApply } = open();
    pick('trip-wizard-daywindow-tab-first');

    settle(`${WHEEL}-h-wheel`, 14);

    expect(tabValue('first')).toHaveTextContent('14:00');
    pick('trip-wizard-daywindow-apply');
    expect(onApply).toHaveBeenCalledWith({ firstDayStartAt: '14:00' });
  });

  it('한 열만 고르면 다른 열은 휠이 서 있던 제안 자리다 — 첫날 분 30 → 12:30, 마지막 날 시 20 → 20:00', () => {
    open();

    pick('trip-wizard-daywindow-tab-first');
    pick(`${WHEEL}-m-30`);
    expect(tabValue('first')).toHaveTextContent('12:30');

    pick('trip-wizard-daywindow-tab-last');
    pick(`${WHEEL}-h-20`);
    expect(tabValue('last')).toHaveTextContent('20:00');
  });

  it('"따로 정하지 않기"는 그 탭에 값이 있을 때만 보인다 — 없으면 없고, 고르면 생기고, 누르면 다시 사라진다', () => {
    open();
    pick('trip-wizard-daywindow-tab-first');
    expect(screen.queryByTestId('trip-wizard-daywindow-off')).toBeNull();

    pick(`${WHEEL}-h-14`);
    expect(screen.getByTestId('trip-wizard-daywindow-off')).toBeOnTheScreen();

    pick('trip-wizard-daywindow-off');
    expect(tabValue('first')).toHaveTextContent('따로 안 정해요');
    expect(screen.queryByTestId('trip-wizard-daywindow-off')).toBeNull();
  });
});

// TRIP-1423 결정 1=A (01b Q1) — 끝을 정할 수 있는 것처럼 읽히던 옛 부제를 사실대로 고쳤다.
describe('TRIP-1423 · 부제는 사실대로 — 여러 날 / 당일치기', () => {
  const OLD_SUBTITLE = 'AI가 이 시간 안에서 하루를 짜요';

  it('여러 날: "하루는 21시까지예요 · 시작 시각을 정해요"', () => {
    open();
    expect(
      screen.getByText('하루는 21시까지예요 · 시작 시각을 정해요')
    ).toBeOnTheScreen();
    expect(screen.queryByText(OLD_SUBTITLE)).toBeNull();
  });

  it('당일치기: "당일치기라 시작과 종료를 함께 정해요"', () => {
    open({}, true);
    expect(
      screen.getByText('당일치기라 시작과 종료를 함께 정해요')
    ).toBeOnTheScreen();
    expect(screen.queryByText(OLD_SUBTITLE)).toBeNull();
  });

  // TRIP-1509 — 기간을 안 골랐으면(박수 0 은 기본값) "당일치기라" 라고 단정하지 않는다.
  it('기간 미선택: 당일치기 문구 대신 중립 부제', () => {
    open({}, true, true);
    expect(
      screen.queryByText('당일치기라 시작과 종료를 함께 정해요')
    ).toBeNull();
    expect(screen.getByText('시작과 종료 시각을 정해요')).toBeOnTheScreen();
  });
});

// TRIP-1423 (01b Q2·Q3) — 휠을 공용 `HourMinuteWheel` 로 옮겨도 눈금은 그대로: 시 24칸 · 분 00·30 두 칸.
// (공용 조각의 분 기본값은 00~59 라, 눈금을 안 넘기면 60칸이 된다.)
describe('TRIP-1423 · 휠 눈금은 시 24칸 · 분 00·30 — 여러 날·당일치기 모두', () => {
  it.each([
    ['여러 날', false, [WHEEL]],
    [
      '당일치기',
      true,
      ['trip-wizard-daywindow-start', 'trip-wizard-daywindow-end'],
    ],
  ] as [string, boolean, string[]][])('%s', (_label, sameDay, prefixes) => {
    open({}, sameDay);
    for (const prefix of prefixes) {
      expect(cells(prefix, 'h')).toHaveLength(24);
      expect(cells(prefix, 'm').map((node) => node.props.testID)).toEqual([
        `${prefix}-m-00`,
        `${prefix}-m-30`,
      ]);
    }
  });
});

/**
 * TRIP-1423 · TRIP-1437 03b 경고-1 — 두 열이 다시 그리기 전에 연달아 멈추면 앞 열 변경이 사라지던 결함.
 * 바깥 `act()` 하나 안에서 정지 신호 둘을 쏘면, 바깥이 끝날 때까지 다시 그리지 않아 실기의 "같은 프레임 정지"와 같다.
 * 조각 층(한 휠의 시·분)과 시트 층(당일치기의 시작 휠·끝 휠)을 따로 잰다.
 */
describe('TRIP-1423 · 두 열이 같은 프레임에 멈춰도 두 값이 모두 남는다', () => {
  it('여러 날 · 하루 시작: 시 14 와 분 30 이 함께 멈추면 14:30', () => {
    open();

    act(() => {
      settle(`${WHEEL}-h-wheel`, 14);
      settle(`${WHEEL}-m-wheel`, 1);
    });

    expect(tabValue('day')).toHaveTextContent('14:30');
  });

  it('당일치기: 시작 시 10 과 끝 시 18 이 함께 멈추면 둘 다 실린다', () => {
    const { onApply } = open({}, true);

    act(() => {
      settle('trip-wizard-daywindow-start-h-wheel', 10);
      settle('trip-wizard-daywindow-end-h-wheel', 18);
    });
    pick('trip-wizard-daywindow-apply');

    expect(onApply).toHaveBeenCalledWith({
      firstDayStartAt: '10:00',
      lastDayEndAt: '18:00',
    });
  });

  it('당일치기: 시작 시 10 과 시작 분 30 이 함께 멈추면 10:30', () => {
    const { onApply } = open({}, true);

    act(() => {
      settle('trip-wizard-daywindow-start-h-wheel', 10);
      settle('trip-wizard-daywindow-start-m-wheel', 1);
    });
    pick('trip-wizard-daywindow-apply');

    expect(onApply).toHaveBeenCalledWith({ firstDayStartAt: '10:30' });
  });
});
