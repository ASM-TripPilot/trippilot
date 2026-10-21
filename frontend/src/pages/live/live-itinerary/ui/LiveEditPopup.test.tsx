import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  blurViewsIn,
  expectGlassRecipe,
  glassAncestor,
} from '@/test-support/glassAsserts';
import { renderedText } from '@/test-support/sheetTree';

import { LiveEditPopup } from './LiveEditPopup';

/**
 * TRIP-1522 v2 · i01 허브 수정 팝업(순수 프레젠테이션 — props 만). 하단 바의 "수정" 칸을 누르면 칸 위에 세로로
 * 쌓이는 알약 둘: 위 **AI에게 맡기기**, 아래 **직접 수정**(Figma B `5031:3438`, 딤 없음). 어디에 붙일지(칸 중심·바 윗변 − 8)는
 * 허브·`editPopupPlacement` 몫이고, 여기는 항목·순서·비활성·유리만 본다.
 *
 * 무엇을 보장하나:
 *  - 항목 둘이 AI 위·직접 수정 아래로 서고 글자가 정확하다. 각자 제 콜백만 1회 부른다.
 *  - `onPressAi` 가 없으면(지난 날·시작 전 여행) AI 항목은 비활성이고 눌려도 아무 일 없다 — 직접 수정은 산다(Q-5).
 *  - 알약 둘이 각각 유리 표면이다(AC-15). 글자는 라벨뿐이다(INV-2·3, AC-22).
 * 3동작: 준비(콜백 jest.fn) → 실행(항목 press) → 단언(콜백 횟수·활성 상태·트리).
 */

const ROOT = 'execution-live-edit-popup';
const AI = 'execution-live-edit-popup-ai';
const MANUAL = 'execution-live-edit-popup-manual';

function renderPopup(overrides: { onPressAi?: (() => void) | undefined } = {}) {
  const handlers = { onPressAi: jest.fn(), onPressManual: jest.fn() };
  render(
    <LiveEditPopup
      {...handlers}
      {...('onPressAi' in overrides ? overrides : {})}
    />
  );
  return handlers;
}

describe('LiveEditPopup · EP1 구성 (AC-3)', () => {
  it('루트 안에 AI에게 맡기기(위)·직접 수정(아래)이 서고 글자가 정확하다', () => {
    renderPopup();

    const root = screen.getByTestId(ROOT);
    const ids = root
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          (node.props.testID === AI || node.props.testID === MANUAL)
      )
      .map((node) => node.props.testID as string);
    // 위 → 아래 순서(트리 순서 — AC-3 이 [T] 로 정한 항목).
    expect(ids).toEqual([AI, MANUAL]);
    expect(within(root).getByTestId(AI)).toHaveTextContent('AI에게 맡기기');
    expect(within(root).getByTestId(MANUAL)).toHaveTextContent('직접 수정');
  });
});

describe('LiveEditPopup · EP2 배선 (AC-3)', () => {
  it('AI 항목은 onPressAi 만, 직접 수정 항목은 onPressManual 만 1회 부른다', () => {
    const handlers = renderPopup();

    fireEvent.press(screen.getByTestId(AI));
    expect(handlers.onPressAi).toHaveBeenCalledTimes(1);
    expect(handlers.onPressManual).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId(MANUAL));
    expect(handlers.onPressManual).toHaveBeenCalledTimes(1);
    expect(handlers.onPressAi).toHaveBeenCalledTimes(1);
  });
});

describe('LiveEditPopup · EP3 AI 불가 (AC-4 · Q-5)', () => {
  it('onPressAi 가 없으면 AI 항목은 비활성 — 눌러도 콜백 0, 직접 수정은 산다', () => {
    // 대조군 — 콜백이 있으면 AI 항목은 활성이다.
    renderPopup();
    expect(screen.getByTestId(AI)).toBeEnabled();
    screen.unmount();

    const handlers = renderPopup({ onPressAi: undefined });
    const ai = screen.getByTestId(AI);
    expect(screen.getByTestId(ROOT)).toBeOnTheScreen();
    expect(ai).toBeDisabled();
    // 상태(disabled)만으로는 눌림이 안 막힌다 — 효과 0도 함께 본다.
    fireEvent.press(ai);
    expect(handlers.onPressAi).not.toHaveBeenCalled();
    expect(handlers.onPressManual).not.toHaveBeenCalled();
    expect(screen.getByTestId(MANUAL)).toBeEnabled();
    fireEvent.press(screen.getByTestId(MANUAL));
    expect(handlers.onPressManual).toHaveBeenCalledTimes(1);
  });
});

describe('LiveEditPopup · EP4 접근성 (AC-16)', () => {
  it('두 항목이 버튼 역할 + 이름으로 잡힌다', () => {
    renderPopup();

    expect(screen.getByRole('button', { name: 'AI에게 맡기기' })).toHaveProp(
      'testID',
      AI
    );
    expect(screen.getByRole('button', { name: '직접 수정' })).toHaveProp(
      'testID',
      MANUAL
    );
  });
});

describe('LiveEditPopup · EP5 유리 (AC-15)', () => {
  it('알약 둘이 각각 유리 표면이고 값이 레시피와 같다 — 라벨은 서로 다른 유리 위에 있다', () => {
    renderPopup();

    const blurs = blurViewsIn();
    expect(blurs).toHaveLength(2);
    blurs.forEach((blur) => expectGlassRecipe(blur));
    const aiBlur = glassAncestor(screen.getByText('AI에게 맡기기'));
    const manualBlur = glassAncestor(screen.getByText('직접 수정'));
    expect(aiBlur).not.toBeNull();
    expect(manualBlur).not.toBeNull();
    expect(aiBlur).not.toBe(manualBlur);
  });
});

describe('LiveEditPopup · EP6 글자는 라벨뿐 (AC-22 · INV-2·3)', () => {
  it('렌더된 글자는 정확히 두 라벨이고 시각·소요시간 글자가 없다', () => {
    renderPopup();

    const lines = renderedText(screen.root).split('\n');
    expect(lines).toEqual(['AI에게 맡기기', '직접 수정']);
    expect(lines.join(' ')).not.toMatch(/분|시간|소요|:/);
  });
});
