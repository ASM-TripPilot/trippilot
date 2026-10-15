import { fireEvent, render, screen } from '@testing-library/react-native';

import type { DayWindow } from '@/features/create-trip';
import { DayWindowEditSheet } from './DayWindowEditSheet';

/**
 * TRIP-1308 일과 시간 시트 — 탭 전환·켜기/끄기·되돌리기 비활성·적용 결과·당일치기 오류.
 * 실제 개폐·휠 제스처는 jest 사각(6-b). 여기서는 값 흐름만 본다.
 */
function open(value: DayWindow = {}, sameDay = false) {
  const onApply = jest.fn();
  const onClose = jest.fn();
  render(
    <DayWindowEditSheet
      value={value}
      sameDay={sameDay}
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

  it('안 정한 탭을 누르면 값이 바로 켜지고(12:00 · 18:00) 설명이 바뀐다', () => {
    open();
    pick('trip-wizard-daywindow-tab-first');
    expect(tabValue('first')).toHaveTextContent('12:00');
    expect(screen.getByTestId('trip-wizard-daywindow-hint')).toHaveTextContent(
      '비행기·KTX 도착 뒤에 시작해요'
    );
    pick('trip-wizard-daywindow-tab-last');
    expect(tabValue('last')).toHaveTextContent('18:00');
    expect(screen.getByTestId('trip-wizard-daywindow-hint')).toHaveTextContent(
      '출발 전에 끝내요'
    );
    // 켜졌으니 더는 기본이 아니다 → 되돌리기 활성
    expect(screen.getByTestId('trip-wizard-daywindow-reset')).toBeEnabled();
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
