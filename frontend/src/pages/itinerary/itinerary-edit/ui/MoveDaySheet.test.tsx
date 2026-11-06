import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  buildMoveDayOptions,
  type MoveDayOption,
} from '../model/moveDayOptions';
import { MoveDaySheet } from './MoveDaySheet';
import { RenameSlotSheet } from './RenameSlotSheet';

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

  // TRIP-1795 — 날짜·옮기기 CTA 는 `move` 한 덩어리로 받는다(null 이면 고치기 행만). 이 헬퍼는 종전 호출 모양(options·initialDate)을 그대로 받아 `move` 로 묶는다.
  function renderSheet(
    over: {
      options?: MoveDayOption[];
      initialDate?: string | null;
      move?: null;
      onPressRename?: jest.Mock;
    } = {}
  ): { onConfirm: jest.Mock; onClose: jest.Mock; onPressRename: jest.Mock } {
    const cb = {
      onConfirm: jest.fn(),
      onClose: jest.fn(),
      onPressRename: over.onPressRename ?? jest.fn(),
    };
    render(
      <MoveDaySheet
        name="부산시립미술관"
        move={
          over.move === null
            ? null
            : {
                options: over.options ?? THREE,
                initialDate:
                  over.initialDate === undefined ? D2 : over.initialDate,
                onConfirm: cb.onConfirm,
              }
        }
        onPressRename={cb.onPressRename}
        onClose={cb.onClose}
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

describe('MoveDaySheet · SH6 — 이름·분류 고치기 행과 옮길 수 없는 장소 (TRIP-1795 AC-10)', () => {
  const RENAME = 'editor-move-rename';
  const opt = (
    dayIndex: number,
    date: string,
    blocked: MoveDayOption['blocked']
  ): MoveDayOption => ({ dayIndex, date, blocked });

  function renderSheet(move: Parameters<typeof MoveDaySheet>[0]['move']): {
    onPressRename: jest.Mock;
    onClose: jest.Mock;
  } {
    const cb = { onPressRename: jest.fn(), onClose: jest.fn() };
    render(<MoveDaySheet name="부산시립미술관" move={move} {...cb} />);
    return cb;
  }

  it('SH6a · move 가 null(고정·방문 완료·하루 일정)이면 이름·X·고치기 행만 있고 날짜 라벨·일차 칩·힌트·옮기기 CTA 는 없다 — 행을 누르면 onPressRename 1회', () => {
    const { onPressRename, onClose } = renderSheet(null);

    expect(screen.getByTestId('editor-move-sheet')).toBeOnTheScreen();
    expect(screen.getByText('부산시립미술관')).toBeOnTheScreen();
    expect(screen.getByTestId(RENAME)).toHaveTextContent('이름·분류 고치기');
    // 짝(부정) — 날짜 섹션 전부가 없다. 옮기기는 이 모드에서 불가능해야 한다(moveSlot 은 고정을 안 막는다 — 이 게이트가 유일한 방어선).
    expect(screen.queryByText('날짜')).toBeNull();
    expect(screen.queryByTestId('editor-move-day-1')).toBeNull();
    expect(screen.queryByTestId('editor-move-hint')).toBeNull();
    expect(screen.queryByTestId('editor-move-confirm')).toBeNull();

    fireEvent.press(screen.getByTestId(RENAME));
    expect(onPressRename).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('editor-move-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SH6b · move 가 있으면 날짜 섹션과 함께 고치기 행도 있고, 둘은 서로의 콜백을 부르지 않는다', () => {
    const onConfirm = jest.fn();
    const { onPressRename } = renderSheet({
      options: [opt(1, D1, 'current'), opt(2, D2, null)],
      initialDate: D2,
      onConfirm,
    });

    expect(screen.getByText('날짜')).toBeOnTheScreen();
    expect(screen.getByTestId('editor-move-confirm')).toHaveTextContent(
      '2일차로 옮기기'
    );
    fireEvent.press(screen.getByTestId(RENAME));
    expect(onPressRename).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// TRIP-1795 · 「이름·분류 고치기」 시트(Figma 5225:4083 — 확정 라벨은 `적용`, Figma `저장하기` 와 다름: 서버 저장은 `일정 저장하기` 뿐).
//
// 무엇을 보장하나: 입력은 현재 표시 이름으로 시작, 분류 칩은 서버 닫힌 10종(생성 상수 순서)이고 현재 분류만 선택 표식,
// 숙소처럼 분류를 못 고치는 장소는 칩이 없다. `적용`은 고른 값을 한 덩이로 알리고 공백뿐·60코드포인트 초과면 비활성+안내.
// `원래대로`는 덮어쓴 게 있을 때만 켜진다. 닫기는 아무것도 알리지 않는다.
//
// > *(개념)* **코드포인트** — 사람이 한 글자로 세는 단위. 이모지 `😀` 는 JS `.length` 로는 2, `[...문자열].length` 로는 1 이다.
// > 서버가 60자를 코드포인트로 세므로 클라도 그렇게 세야 이모지가 섞인 이름이 잘못 막히거나 통과하지 않는다.
// ★ 시트 실제 열림·딤·키보드 밀림·칩 줄바꿈은 통과형 목이 못 본다 — 6-b(기능 지도 edit-rename).
//
// 3동작 뼈대: 준비=name·category·콜백 주입 렌더 → 실행=입력·칩·버튼 → 단언=값·선택 표식·disabled·콜백 인자.
describe('RenameSlotSheet · RS — 이름·분류 고치기 시트 (TRIP-1795 AC-11~13·15)', () => {
  const CATEGORIES = [
    '명소',
    '맛집',
    '카페',
    '야경',
    '자연',
    '쇼핑',
    '문화',
    '액티비티',
    '미술',
    '술집',
  ];
  const chip = (c: string) => screen.getByTestId(`editor-rename-category-${c}`);
  const INPUT = 'editor-rename-input';
  const APPLY = 'editor-rename-apply';
  const RESET = 'editor-rename-reset';

  function renderRename(
    over: Partial<Parameters<typeof RenameSlotSheet>[0]> = {}
  ) {
    const cb = {
      onApply: jest.fn(),
      onReset: jest.fn(),
      onClose: jest.fn(),
    };
    render(
      <RenameSlotSheet
        name="웨이브온 카페"
        category="맛집"
        categoryEditable
        canReset={false}
        {...cb}
        {...over}
      />
    );
    return cb;
  }

  it('RS1 · 열린 모양 — 입력은 현재 이름, 칩 10종은 서버 순서·현재 분류만 선택, 보조문은 완전일치, 덮어쓴 게 없으면 원래대로 비활성', () => {
    renderRename();

    expect(screen.getByTestId('editor-rename-sheet')).toBeOnTheScreen();
    // 제어(value)·비제어(defaultValue) 어느 쪽으로 시드해도 보이는 값으로 잰다.
    expect(screen.getByTestId(INPUT)).toHaveDisplayValue('웨이브온 카페');
    const chips = screen
      .getAllByTestId(/^editor-rename-category-/)
      .map((node) => node.props.testID.replace('editor-rename-category-', ''));
    expect(chips).toEqual(CATEGORIES);
    expect(chip('맛집')).toBeSelected();
    expect(chip('카페')).not.toBeSelected();
    expect(screen.getByTestId('editor-rename-hint')).toHaveTextContent(
      '이 여행에서만 바뀌어요 · 장소 정보 자체는 그대로예요'
    );
    expect(screen.getByTestId(APPLY)).toHaveTextContent('적용');
    expect(screen.getByTestId(RESET)).toHaveTextContent('원래대로');
    expect(screen.getByTestId(RESET)).toBeDisabled();
    expect(screen.queryByTestId('editor-rename-error')).toBeNull();
  });

  it('RS1b · 분류를 못 고치는 장소(categoryEditable=false — 숙소 등)는 칩이 하나도 없고 이름만 고친다', () => {
    const { onApply } = renderRename({
      category: '숙소',
      categoryEditable: false,
    });

    expect(screen.queryAllByTestId(/^editor-rename-category-/)).toHaveLength(0);
    fireEvent.changeText(screen.getByTestId(INPUT), '우리 숙소');
    fireEvent.press(screen.getByTestId(APPLY));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      displayName: '우리 숙소',
      displayCategory: null,
    });
  });

  it('RS2 · 이름·분류를 바꿔 적용하면 고른 값이 한 덩이로 1회 알려지고, 분류를 안 건드리면 현재 분류가 그대로 실린다 · 칩은 하나만 선택된다', () => {
    const { onApply, onClose } = renderRename();

    fireEvent.changeText(screen.getByTestId(INPUT), '우리 아지트');
    fireEvent.press(chip('카페'));
    expect(chip('카페')).toBeSelected();
    expect(chip('맛집')).not.toBeSelected();
    expect(onApply).not.toHaveBeenCalled(); // 앵커 — 입력·칩 선택만으로는 알리지 않는다

    fireEvent.press(screen.getByTestId(APPLY));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      displayName: '우리 아지트',
      displayCategory: '카페',
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('RS2b · 이름만 고치면 분류는 현재 분류(맛집) 그대로 실린다', () => {
    const { onApply } = renderRename();

    fireEvent.changeText(screen.getByTestId(INPUT), '우리 아지트');
    fireEvent.press(screen.getByTestId(APPLY));

    expect(onApply).toHaveBeenCalledWith({
      displayName: '우리 아지트',
      displayCategory: '맛집',
    });
  });

  it('RS3 · 공백뿐인 이름·60코드포인트 초과는 적용이 비활성이고 안내가 뜨며 눌러도 알리지 않는다, 60코드포인트는 통과한다 (이모지는 한 글자로 센다)', () => {
    // 앵커 — JS 길이와 코드포인트 길이가 다르다.
    expect('😀'.length).toBe(2);
    expect([...'😀'].length).toBe(1);

    const { onApply } = renderRename();
    expect(screen.queryByTestId('editor-rename-error')).toBeNull();

    // 공백뿐
    fireEvent.changeText(screen.getByTestId(INPUT), '    ');
    expect(screen.getByTestId(APPLY)).toBeDisabled();
    fireEvent.press(screen.getByTestId(APPLY));
    expect(onApply).not.toHaveBeenCalled();

    // 이모지 30개 = JS 길이 60 이지만 코드포인트 30 → 통과(`.length` 로 세면 61 이상일 때 막히는 쪽이 아니라, 아래 61개 케이스와 쌍으로 잡는다)
    fireEvent.changeText(screen.getByTestId(INPUT), '😀'.repeat(60));
    expect(screen.getByTestId(APPLY)).not.toBeDisabled();
    expect(screen.queryByTestId('editor-rename-error')).toBeNull();

    // 61 코드포인트
    fireEvent.changeText(screen.getByTestId(INPUT), '😀'.repeat(61));
    expect(screen.getByTestId(APPLY)).toBeDisabled();
    expect(screen.getByTestId('editor-rename-error')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId(APPLY));
    expect(onApply).not.toHaveBeenCalled();

    // 60 코드포인트(영문)는 통과 → 알림 1회
    fireEvent.changeText(screen.getByTestId(INPUT), 'a'.repeat(60));
    expect(screen.getByTestId(APPLY)).not.toBeDisabled();
    fireEvent.press(screen.getByTestId(APPLY));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  // N2 (5-b 참고) — 서버·스토어는 이름을 **앞뒤 공백을 자른 뒤** 60 코드포인트로 센다. 시트가 공백 포함 길이로 막으면 사용자가 붙여 넣은
  // 60자 이름(뒤에 공백 하나)이 괜히 막힌다. 막는 쪽으로 틀려 데이터 위험은 없지만 `적용` 이 켜져야 맞다.
  // ⚠️ 구현 전엔 이 케이스가 red 다 — implementer 가 검사를 trim 뒤 길이로 고치면 green (02 map 「5-b 보강」 N2).
  it('RS3b · N2 — 이름이 60 코드포인트이고 앞뒤 공백이 붙어 있어도(trim 하면 60) 적용이 켜지고 자른 이름이 알려진다', () => {
    const { onApply } = renderRename();
    fireEvent.changeText(screen.getByTestId(INPUT), ` ${'a'.repeat(60)} `);

    expect(screen.getByTestId(APPLY)).not.toBeDisabled();
    expect(screen.queryByTestId('editor-rename-error')).toBeNull();
    fireEvent.press(screen.getByTestId(APPLY));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      displayName: 'a'.repeat(60),
      displayCategory: '맛집',
    });
  });

  it('RS4 · 원래대로는 덮어쓴 게 있을 때만 켜져 onReset 1회, X 는 onClose 만 부르고 아무것도 알리지 않는다', () => {
    const { onApply, onReset, onClose } = renderRename({ canReset: true });

    expect(screen.getByTestId(RESET)).not.toBeDisabled();
    fireEvent.press(screen.getByTestId(RESET));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('editor-rename-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
