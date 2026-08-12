import { fireEvent, render, screen } from '@testing-library/react-native';

import { SlotTimeSheet } from './SlotTimeSheet';

/**
 * TRIP-302 · h24 시각조정 시트의 **폼 계약**(슬라이스3 · AC-T3·AC-T4·AC-T5·AC-T6).
 *
 * 시트는 현재 시각을 시·분으로 시드해 보이고, 시작·종료를 **각각** 바꿀 수 있게 하며, [적용]에서
 * `onApply({startAt,endAt,endsNextDay})`를, [취소]에서 `onCancel`을 발화한다. 클라는 시간 타당성을
 * 판정하지 않는다(INV-2) — 적용은 항상 열려 있고, `endsNextDay`는 `end ≤ start`의 **기계적 유도**다
 * (HC4 동형, 02a ★10).
 *
 * *(개념)* **왜 셀을 눌러 시각을 고르나** — 이 리포엔 휠(스크롤-스냅) 시각 피커 라이브러리가 없고
 * (실측: gorhom·draggable뿐), jest 는 스크롤-스냅을 구동하지 못한다. 그래서 시·분을 **값별 셀**로
 * 두고 누르면 그 값이 선택된다(h07 옵션-셀 선례). "휠" 비주얼은 그 위의 프레젠테이션이다(02a ★1).
 *
 * *(개념)* **`@gorhom/bottom-sheet` 수동 목은 children 을 무조건 렌더**한다(통과 컴포넌트). 그래서
 * 시트를 직접 마운트하면 **항상 열린 상태**다 — 개폐(열림/닫힘)는 여기서 못 잰다. 그건 페이지가
 * 조건부 마운트하고 통합테스트가 잰다(02a ★4).
 *
 * 3동작 뼈대: 준비=현재 시각으로 렌더 → 실행=셀/버튼 press → 단언=선택된 셀·불린 콜백의 인자.
 */

const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 렌더된 문자열 전부 — INV-3 부정 스캔의 모집단(h07 C31 헬퍼 이식). */
function renderedTexts(): string[] {
  const out: string[] = [];
  screen.root
    .findAll(() => true)
    .forEach((node) => {
      const children = node.props?.children as unknown;
      const list = Array.isArray(children) ? children : [children];
      list.forEach((child) => {
        if (typeof child === 'string') out.push(child);
      });
    });
  return out;
}

const onApply = jest.fn();
const onCancel = jest.fn();

function renderSheet(startAt = '10:15:00', endAt = '11:45:00') {
  return render(
    <SlotTimeSheet
      startAt={startAt}
      endAt={endAt}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}

beforeEach(() => {
  onApply.mockClear();
  onCancel.mockClear();
});

describe('🔴 CS1 · AC-T3·AC-T8 — 현재 시각을 시작·종료 각각으로 시드해 보인다', () => {
  it('시작 10:15·종료 11:45 가 셀 선택으로 뜨고 적용/취소가 있다', () => {
    renderSheet('10:15:00', '11:45:00');

    expect(screen.getByTestId('itinerary-edit-time-sheet')).toBeOnTheScreen();

    // 시작·종료가 **독립 값**으로 시드된다(분 granularity 15·45 유지 — 30분 반올림이 아니다).
    expect(screen.getByTestId('itinerary-edit-time-start-h-10')).toBeSelected();
    expect(screen.getByTestId('itinerary-edit-time-start-m-15')).toBeSelected();
    expect(screen.getByTestId('itinerary-edit-time-end-h-11')).toBeSelected();
    expect(screen.getByTestId('itinerary-edit-time-end-m-45')).toBeSelected();

    // 짝(부정) — 시드 안 된 값은 선택되지 않는다.
    expect(
      screen.getByTestId('itinerary-edit-time-start-h-11')
    ).not.toBeSelected();

    expect(screen.getByTestId('itinerary-edit-time-apply')).toBeOnTheScreen();
    expect(screen.getByTestId('itinerary-edit-time-cancel')).toBeOnTheScreen();
  });
});

describe('🔴 CS2 · AC-T3·AC-T4(false) — 무변경 적용은 시드값을 초 보존해 싣는다', () => {
  it('그냥 적용하면 09:30:00 식 정밀도로 onApply, endsNextDay=false', () => {
    renderSheet('10:15:00', '11:45:00');

    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    // 표시는 HH:mm, 저장은 "HH:mm:00"(초는 :00) — 11:45 > 10:15 라 익일 아님.
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      startAt: '10:15:00',
      endAt: '11:45:00',
      endsNextDay: false,
    });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('🔴 CS3 · AC-T3(독립)·AC-T4(true) — 시작만 바꾸면 종료는 그대로, 익일 유도', () => {
  it('시작 시를 23 으로 바꿔 적용하면 분·종료는 유지되고 endsNextDay=true', () => {
    renderSheet('10:15:00', '11:45:00');

    // 시작의 '시'만 23 으로 — 시작 '분'(15)과 종료(11:45)는 건드리지 않는다.
    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-h-23'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    // 종료 11:45 불변 = start·end 독립. 11:45 ≤ 23:15 라 익일.
    expect(onApply).toHaveBeenCalledWith({
      startAt: '23:15:00',
      endAt: '11:45:00',
      endsNextDay: true,
    });
  });
});

describe('🔴 CS4 · AC-T4(경계 ≤) — start == end 면 endsNextDay=true', () => {
  it('시작과 종료가 같으면 익일로 유도한다', () => {
    renderSheet('11:00:00', '11:00:00');

    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    expect(onApply).toHaveBeenCalledWith({
      startAt: '11:00:00',
      endAt: '11:00:00',
      endsNextDay: true,
    });
  });
});

describe('🔴 CS5 · AC-T5 — 취소는 onCancel 만, onApply 는 안 부른다', () => {
  it('취소 press → onCancel 1회, onApply 0회', () => {
    renderSheet();

    fireEvent.press(screen.getByTestId('itinerary-edit-time-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('🔴 CS6 · AC-T6 · INV-3 — 시트 렌더 어디에도 소요시간 문자열이 없다', () => {
  it('시각 숫자는 보이는데 분·시간·소요 표기는 0건이다(★2 render 스캔)', () => {
    renderSheet('10:15:00', '11:45:00');

    const texts = renderedTexts();
    // 긍정 앵커 — 시트가 실제로 시각을 그리고 있다.
    expect(texts.some((t) => t.includes('10'))).toBe(true);
    expect(texts.some((t) => t.includes('45'))).toBe(true);

    // 부정 — 소요시간 표기 0건. 분 셀을 "30분" 으로 그리면 여기서 걸린다(source 가드가 못 보는
    // `${m}분` 렌더까지 잡는 유일한 심판, 02a ★2).
    expect(texts.filter((t) => DURATION_TEXT.test(t))).toEqual([]);
  });
});

describe('🔴 CS7 · AC-T4(분 축) · 리뷰 W-1 — 같은 시·늦은 분은 익일이 아니다', () => {
  it('10:15→10:45(시 같음 10, 분만 45>15) 무변경 적용 → endsNextDay=false', () => {
    renderSheet('10:15:00', '10:45:00');

    // 아무 셀도 안 바꾸고 시드값 그대로 적용한다.
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    // **분 축을 심판에 넣는 케이스.** 시가 같아도(10==10) 종료 분(45)이 시작 분(15)보다 뒤 → 익일 아님.
    // 시만 보는 유도식(endHour<=startHour)이면 `10<=10`=true 로 익일을 잘못 켠다 — CS2/3/4 는 시만 봐도
    // 정답이 나오는 입력뿐이라 그 오구현을 못 잡는데, 이 케이스가 red 로 잡는다.
    expect(onApply).toHaveBeenCalledWith({
      startAt: '10:15:00',
      endAt: '10:45:00',
      endsNextDay: false,
    });
  });
});

describe('🔴 CS8 · AC-T3(독립) · 리뷰 N-1 — 분 셀 press 는 그 필드의 분만 바꾼다', () => {
  it('시작 분 셀 40 press → 시작 분만 40, 시작 시(10)·종료(11:45)는 불변', () => {
    renderSheet('10:15:00', '11:45:00');

    // **분 셀 press 경로를 심판에 넣는 케이스.** 시작 '분' 셀 40 만 누른다(시·종료는 안 건드린다).
    fireEvent.press(screen.getByTestId('itinerary-edit-time-start-m-40'));
    fireEvent.press(screen.getByTestId('itinerary-edit-time-apply'));

    // 시작 분만 40 으로 흐르고 시작 시(10)·종료(11:45)는 그대로여야 한다. 분 컬럼 onSelect 가 엉뚱한
    // 필드(예: setStartHour)로 오배선되면 startAt 이 틀어져 red. 현재 어떤 테스트도 분 셀을 눌러 값을
    // 바꾸지 않아, 이 케이스가 분 셀 press 배선을 잠그는 유일한 심판이다.
    expect(onApply).toHaveBeenCalledWith({
      startAt: '10:40:00',
      endAt: '11:45:00',
      endsNextDay: false,
    });
  });
});
