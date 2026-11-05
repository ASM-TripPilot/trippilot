import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  buildMoveDayOptions,
  type MoveDayOption,
} from '../model/moveDayOptions';
import { MoveDaySheet } from './MoveDaySheet';

/**
 * TRIP-1793 · 「다른 날로 옮기기」 장소 시트 — 입력을 만드는 순수 함수 `buildMoveDayOptions` 와 시트 `MoveDaySheet` 단독 (AC-5·9).
 *
 * 무엇을 보장하나:
 *  - `buildMoveDayOptions` — 일차마다 "현재 날(current)"·"이미 그 장소가 있는 날(duplicate)"을 막힘으로 표시하고, 처음 선택할 날을 고른다
 *    (현재 날 **뒤쪽에서 막히지 않은 가장 가까운 날** → 없으면 **앞쪽에서 가장 가까운 날** → 없으면 null). 입력은 안 바꾼다.
 *  - `MoveDaySheet` — 칩이 막힘을 **진짜 `disabled`** 로 거부하고(눌러도 선택 불변), 선택에 따라 확정 버튼 라벨·도움말이 따라가며,
 *    확정은 고른 날짜로 `onConfirm` 을 1회, X 는 `onClose` 만 부른다. 선택할 날이 없으면 확정이 비활성이다.
 *
 * > *(개념)* **통과형 목** — 이 파일의 시트는 `__mocks__/@gorhom/bottom-sheet.tsx` 위에서 그려진다. 목은 children 을 무조건 렌더하므로
 * > 실제 열림·딤·끌어내림 닫힘은 jest 가 못 본다(6-b). 그래서 여기서는 "시트 안 내용과 콜백"만 잰다 — prop 전달만 보는 `it` 은 두지 않는다.
 *
 * 3동작 뼈대: 준비=옵션·콜백 주입 렌더 → 실행=칩·확정·X press → 단언=선택 표식·disabled·라벨·콜백 횟수.
 * 색·크기는 생김새라 단언하지 않는다(실화면 QA).
 */

const D1 = '2026-06-10';
const D2 = '2026-06-11';
const D3 = '2026-06-12';

describe('buildMoveDayOptions — 일차별 막힘과 처음 선택 (TRIP-1793 AC-9)', () => {
  const day = (date: string, ...poiIds: string[]) => ({
    date,
    slots: poiIds.map((poiId) => ({ poiId })),
  });
  const blockedOf = (options: MoveDayOption[]) =>
    options.map((option) => option.blocked);

  it('현재 날만 막히고 일차 번호는 1부터, 처음 선택은 현재 날의 다음 날이다', () => {
    const days = [day(D1, 'a', 'b'), day(D2, 'c'), day(D3, 'd')];

    const { options, initialDate } = buildMoveDayOptions(days, D1, 'b');

    expect(options.map((o) => [o.dayIndex, o.date])).toEqual([
      [1, D1],
      [2, D2],
      [3, D3],
    ]);
    expect(blockedOf(options)).toEqual(['current', null, null]);
    expect(initialDate).toBe(D2);
  });

  it('처음 선택은 뒤쪽 우선 — 가운데 날에서는 다음 날, 마지막 날에서는 뒤가 없으니 바로 앞 날', () => {
    const days = [day(D1, 'a'), day(D2, 'b'), day(D3, 'c')];

    expect(buildMoveDayOptions(days, D2, 'b').initialDate).toBe(D3);
    expect(buildMoveDayOptions(days, D3, 'c').initialDate).toBe(D2);
  });

  it('대상 날에 같은 장소가 이미 있으면 그 날은 duplicate 로 막히고 처음 선택에서 건너뛴다 (같은 poiId 만 본다)', () => {
    const days = [day(D1, 'a', 'b'), day(D2, 'b'), day(D3, 'x')];

    const { options, initialDate } = buildMoveDayOptions(days, D1, 'b');

    expect(blockedOf(options)).toEqual(['current', 'duplicate', null]);
    expect(initialDate).toBe(D3); // 다음 날은 막혀 있으니 그 다음
    // 짝 — 다른 장소(a)는 같은 날에서 막히지 않는다.
    expect(blockedOf(buildMoveDayOptions(days, D1, 'a').options)).toEqual([
      'current',
      null,
      null,
    ]);
  });

  it('뒤쪽이 전부 막혔으면 앞쪽에서 가장 가까운 날을 고르고, 옮길 수 있는 날이 하나도 없으면 null 이다', () => {
    // 3일차에서 출발, 2일차는 막힘(중복), 1일차는 비어 있음 → 앞쪽으로 내려가 1일차.
    const days = [day(D1, 'a'), day(D2, 'c'), day(D3, 'c')];
    expect(buildMoveDayOptions(days, D3, 'c').initialDate).toBe(D1);

    // 이틀인데 대상 날에 이미 있다 → 선택할 날이 없다.
    const stuck = buildMoveDayOptions([day(D1, 'b'), day(D2, 'b')], D1, 'b');
    expect(blockedOf(stuck.options)).toEqual(['current', 'duplicate']);
    expect(stuck.initialDate).toBeNull();

    // 하루짜리 일정.
    const single = buildMoveDayOptions([day(D1, 'b')], D1, 'b');
    expect(blockedOf(single.options)).toEqual(['current']);
    expect(single.initialDate).toBeNull();
  });

  it('입력 days 는 바뀌지 않는다', () => {
    const days = [day(D1, 'a', 'b'), day(D2, 'c')];
    const snapshot = JSON.stringify(days);

    buildMoveDayOptions(days, D1, 'b');

    expect(JSON.stringify(days)).toBe(snapshot);
  });
});

describe('MoveDaySheet — 일차 칩·확정·닫기 (TRIP-1793 AC-5·9)', () => {
  const opt = (
    dayIndex: number,
    date: string,
    blocked: MoveDayOption['blocked']
  ): MoveDayOption => ({ dayIndex, date, blocked });
  const THREE: MoveDayOption[] = [
    opt(1, D1, 'current'),
    opt(2, D2, null),
    opt(3, D3, null),
  ];
  const chip = (n: number) => screen.getByTestId(`editor-move-day-${n}`);
  const CONFIRM = 'editor-move-confirm';
  const HINT = 'editor-move-hint';
  const DUP_HINT = 'editor-move-duplicate-hint';

  function renderSheet(
    over: Partial<Parameters<typeof MoveDaySheet>[0]> = {}
  ): { onConfirm: jest.Mock; onClose: jest.Mock } {
    const cb = { onConfirm: jest.fn(), onClose: jest.fn() };
    render(
      <MoveDaySheet
        name="부산시립미술관"
        options={THREE}
        initialDate={D2}
        {...cb}
        {...over}
      />
    );
    return cb;
  }

  it('SH1 · 열린 모양 — 장소 이름, 현재 날 칩은 비활성·미선택, 처음 칩만 선택, 확정 라벨·도움말이 선택 일차를 말한다', () => {
    renderSheet();

    expect(screen.getByTestId('editor-move-sheet')).toBeOnTheScreen();
    expect(screen.getByText('부산시립미술관')).toBeOnTheScreen();
    expect(chip(1)).toHaveTextContent('1일차');
    expect(chip(1)).toBeDisabled();
    expect(chip(1)).not.toBeSelected();
    expect(chip(2)).toHaveTextContent('2일차');
    expect(chip(2)).not.toBeDisabled();
    expect(chip(2)).toBeSelected();
    expect(chip(3)).not.toBeDisabled();
    expect(chip(3)).not.toBeSelected();
    expect(screen.getByTestId(CONFIRM)).toHaveTextContent('2일차로 옮기기');
    expect(screen.getByTestId(CONFIRM)).not.toBeDisabled();
    expect(screen.getByTestId(HINT)).toHaveTextContent(
      '2일차 마지막에 넣어요 · 다음 단계에서 시각을 골라요'
    );
    // 중복으로 막힌 칩이 없으니 중복 안내 줄도 없다.
    expect(screen.queryByTestId(DUP_HINT)).toBeNull();
  });

  it('SH2 · 다른 칩을 고르면 선택·라벨·도움말이 따라가고 확정은 그 날짜로 1회 — 막힌 칩은 눌러도 아무 일이 없다', () => {
    const { onConfirm } = renderSheet();

    // 현재 날 칩(막힘) — 눌러도 선택 불변.
    fireEvent.press(chip(1));
    expect(chip(1)).not.toBeSelected();
    expect(chip(2)).toBeSelected();
    expect(screen.getByTestId(CONFIRM)).toHaveTextContent('2일차로 옮기기');

    fireEvent.press(chip(3));
    expect(chip(3)).toBeSelected();
    expect(chip(2)).not.toBeSelected();
    expect(screen.getByTestId(CONFIRM)).toHaveTextContent('3일차로 옮기기');
    expect(screen.getByTestId(HINT)).toHaveTextContent(
      '3일차 마지막에 넣어요 · 다음 단계에서 시각을 골라요'
    );
    expect(onConfirm).not.toHaveBeenCalled(); // 앵커 — 고르기만으로는 확정되지 않는다

    fireEvent.press(screen.getByTestId(CONFIRM));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(D3);
  });

  it('SH3 · 이미 그 장소가 있는 날은 칩이 비활성이고 눌러도 선택이 안 바뀌며, 중복 안내 한 줄이 뜬다', () => {
    const { onConfirm } = renderSheet({
      options: [
        opt(1, D1, 'current'),
        opt(2, D2, 'duplicate'),
        opt(3, D3, null),
      ],
      initialDate: D3,
    });

    expect(chip(2)).toBeDisabled();
    expect(chip(2)).not.toBeSelected();
    expect(screen.getByTestId(DUP_HINT)).toHaveTextContent(
      '이미 이 날에 있는 장소예요'
    );
    expect(chip(3)).toBeSelected();

    fireEvent.press(chip(2));
    expect(chip(2)).not.toBeSelected();
    expect(chip(3)).toBeSelected();
    fireEvent.press(screen.getByTestId(CONFIRM));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(D3); // 막힌 2일차가 아니라 고른 3일차
  });

  it('SH4 · 옮길 수 있는 날이 없으면 어느 칩도 선택 아님, 확정은 비활성(라벨 「옮기기」)이고 눌러도 onConfirm 0회', () => {
    const { onConfirm } = renderSheet({
      options: [opt(1, D1, 'current'), opt(2, D2, 'duplicate')],
      initialDate: null,
    });

    expect(chip(1)).not.toBeSelected();
    expect(chip(2)).not.toBeSelected();
    const confirm = screen.getByTestId(CONFIRM);
    expect(confirm).toHaveTextContent('옮기기');
    expect(confirm).not.toHaveTextContent('일차');
    expect(confirm).toBeDisabled();

    fireEvent.press(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('SH5 · X 는 onClose 만 부르고 옮기지 않는다', () => {
    const { onConfirm, onClose } = renderSheet();

    fireEvent.press(screen.getByTestId('editor-move-close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
