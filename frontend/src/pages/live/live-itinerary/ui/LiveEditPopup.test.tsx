import { fireEvent, render, screen } from '@testing-library/react-native';

import { renderedText } from '@/test-support/sheetTree';

import { LiveEditPopup } from './LiveEditPopup';

/**
 * 허브 수정 팝업(순수 프레젠테이션 — props 만): 하단 바의 "수정" 칸 위에 세로로 쌓이는 알약 둘, 위 **AI에게 맡기기** · 아래 **직접 수정**. 어디에 붙일지는
 * 허브·`editPopupPlacement` 몫이고, 여기는 항목 배선·AI 불가 비활성·글자만 본다(유리는 GlassSurface/허브 테스트).
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

describe('LiveEditPopup', () => {
  it('두 항목은 버튼으로 읽히고 각자 제 콜백만 1회 부른다', () => {
    const handlers = renderPopup();

    fireEvent.press(screen.getByRole('button', { name: 'AI에게 맡기기' }));
    expect(handlers.onPressAi).toHaveBeenCalledTimes(1);
    expect(handlers.onPressManual).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: '직접 수정' }));
    expect(handlers.onPressManual).toHaveBeenCalledTimes(1);
    expect(handlers.onPressAi).toHaveBeenCalledTimes(1);
  });

  it('onPressAi 가 없으면(지난 날·시작 전 여행) AI 항목은 비활성 — 눌러도 콜백 0, 직접 수정은 산다', () => {
    renderPopup(); // 대조군 — 콜백이 있으면 AI 항목은 활성이다
    expect(screen.getByTestId(AI)).toBeEnabled();
    screen.unmount();

    const handlers = renderPopup({ onPressAi: undefined });
    expect(screen.getByTestId(ROOT)).toBeOnTheScreen();
    expect(screen.getByTestId(AI)).toBeDisabled();
    fireEvent.press(screen.getByTestId(AI)); // 상태(disabled)만으로는 눌림이 안 막힌다 — 효과 0도 본다
    expect(handlers.onPressAi).not.toHaveBeenCalled();
    expect(handlers.onPressManual).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(MANUAL));
    expect(handlers.onPressManual).toHaveBeenCalledTimes(1);
  });

  it('렌더된 글자는 정확히 두 라벨(AI에게 맡기기 → 직접 수정)이고 시각·소요시간 글자가 없다 (INV-3)', () => {
    renderPopup();

    const lines = renderedText(screen.root).split('\n');
    expect(lines).toEqual(['AI에게 맡기기', '직접 수정']);
    expect(lines.join(' ')).not.toMatch(/분|시간|소요|:/);
  });
});
