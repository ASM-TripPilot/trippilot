import { fireEvent, render, screen } from '@testing-library/react-native';

import { TriggerChip } from './TriggerChip';

/**
 * TRIP-748 · AC-3 · Seed Q3·Q6 — i02 지도 위 트리거 **알약**(순수 프레젠테이션, props 만).
 *
 * 무엇을 보장하나:
 *  - 흰 알약 한 줄 `[빨강 경고삼각][카피][›]` — 알약 전체가 눌린다(`execution-live-trigger-alternative`).
 *  - 카피는 페이지가 만든 완성 문구(`label`)를 그대로 그린다. 경고삼각은 글자 `⚠` 가 아니라 SVG 라
 *    글자 전체가 정확히 `{카피}›` 인지로 잰다(Q3 · 02a ★5). 색·말줄임·토큰은 실화면 QA 몫(README 판정 4).
 *
 * 3동작: 준비(label·onPressAlternative) → 실행(render/press) → 단언(testID·글자·콜백).
 * 개념: **fireEvent.press(node)** = 그 노드를 눌렀다고 흉내내 onPress 를 부른다.
 */

const COPY = '비 예보 · 해운대 해변 17시';

// 콜백 prop 이름을 `onPress` 로 두지 않는다 — RNTL fireEvent.press 는 합성 조상의 props 까지 거슬러
// 올라가 `onPress` 를 찾으므로, 칩 자신의 prop 이름이 onPress 면 Pressable 배선이 없어도 통과한다(02a ★20).
function renderChip(onPressAlternative: () => void = jest.fn()) {
  render(<TriggerChip label={COPY} onPressAlternative={onPressAlternative} />);
  return screen.getByTestId('execution-live-trigger-chip');
}

describe('TriggerChip · i02 알약', () => {
  it('C1 알약 글자는 정확히 "{카피}›" 이고, 카피 leaf 는 페이지가 준 카피 그대로다', () => {
    renderChip();

    expect(
      screen.getByTestId('execution-live-trigger-alternative')
    ).toHaveTextContent(`${COPY}›`);
    const label = screen.getByTestId('execution-live-trigger-label');
    expect(label).toHaveTextContent(COPY);
  });

  it('C3 알약을 누르면 onPressAlternative 가 1회 불린다', () => {
    const onPressAlternative = jest.fn();
    renderChip(onPressAlternative);

    fireEvent.press(screen.getByTestId('execution-live-trigger-alternative'));

    expect(onPressAlternative).toHaveBeenCalledTimes(1);
  });
});
