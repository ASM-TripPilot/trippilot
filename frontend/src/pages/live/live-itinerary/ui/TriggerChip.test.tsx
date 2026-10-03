import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { TriggerChip } from './TriggerChip';

/**
 * TRIP-748 · AC-3 · Seed Q3·Q6 — i02 지도 위 트리거 **알약**(순수 프레젠테이션, props 만).
 *
 * 무엇을 보장하나:
 *  - 흰 알약 한 줄 `[빨강 경고삼각][카피][›]` — 알약 전체가 눌린다(`execution-live-trigger-alternative`).
 *  - 카피는 페이지가 만든 완성 문구(`label`)를 그대로 한 줄로 그린다(길면 말줄임, Q6).
 *  - 경고삼각은 글자 `⚠` 가 아니라 SVG 다(Q3 — iOS 노랑 이모지 위험). 글자 전체가 정확히
 *    `{카피}›` 인지로 잰다(02a ★5).
 *  - 옛 칩의 부제·×(끄기)·분홍 배경은 없다(D3 — 끄기 표면 삭제).
 *
 * 3동작: 준비(label·onPressAlternative) → 실행(render/press) → 단언(testID·글자·클래스·콜백).
 * 개념: **fireEvent.press(node)** = 그 노드를 눌렀다고 흉내내 onPress 를 부른다.
 */

const COPY = '비 예보 · 해운대 해변 17시';
const PRIMARY = '#FF385C';

function classTokens(node: { props?: { className?: unknown } }): string[] {
  const cn = node.props?.className;
  return typeof cn === 'string' ? cn.split(/\s+/).filter(Boolean) : [];
}

// 콜백 prop 이름을 `onPress` 로 두지 않는다 — RNTL fireEvent.press 는 합성 조상의 props 까지 거슬러
// 올라가 `onPress` 를 찾으므로, 칩 자신의 prop 이름이 onPress 면 Pressable 배선이 없어도 통과한다(02a ★20).
function renderChip(onPressAlternative: () => void = jest.fn()) {
  render(<TriggerChip label={COPY} onPressAlternative={onPressAlternative} />);
  return screen.getByTestId('execution-live-trigger-chip');
}

describe('TriggerChip · i02 알약', () => {
  it('C1 알약 글자는 정확히 "{카피}›" 이고, 카피 leaf 는 한 줄 말줄임이다', () => {
    renderChip();

    expect(
      screen.getByTestId('execution-live-trigger-alternative')
    ).toHaveTextContent(`${COPY}›`);
    const label = screen.getByTestId('execution-live-trigger-label');
    expect(label).toHaveTextContent(COPY);
    expect(label.props.numberOfLines).toBe(1);
  });

  it('C2 경고삼각은 빨강(primary)으로 채운 SVG 다', () => {
    const chip = renderChip();

    const warning = within(chip).getByTestId('execution-live-trigger-warning');
    const filled = warning.findAll(
      (node) =>
        typeof node.props?.fill === 'string' &&
        (node.props.fill as string).toUpperCase() === PRIMARY
    );
    expect(filled.length).toBeGreaterThan(0);
  });

  it('C3 알약을 누르면 onPressAlternative 가 1회 불린다', () => {
    const onPressAlternative = jest.fn();
    renderChip(onPressAlternative);

    fireEvent.press(screen.getByTestId('execution-live-trigger-alternative'));

    expect(onPressAlternative).toHaveBeenCalledTimes(1);
  });

  it('C4 부제·×(끄기)가 없다', () => {
    const chip = renderChip();

    // 짝 앵커 — 알약이 실제로 그려졌다.
    expect(chip).toBeOnTheScreen();
    expect(screen.queryByTestId('execution-live-trigger-dismiss')).toBeNull();
    expect(screen.queryByLabelText('끄기')).toBeNull();
    expect(screen.queryByText(/탭하여/)).toBeNull();
  });

  it('C5 흰 바탕·얇은 테두리·둥근 알약·ink 글자이고, 옛 분홍 토큰은 없다', () => {
    const chip = renderChip();

    // findAll 은 자기 자신도 포함한다 — 루트든 Pressable 이든 클래스 자리는 구현 자유(02a ★6).
    const has = (token: string) =>
      chip.findAll((node) => classTokens(node).includes(token)).length;
    expect(has('bg-canvas')).toBeGreaterThan(0);
    expect(has('border-hairline')).toBeGreaterThan(0);
    expect(has('rounded-pill')).toBeGreaterThan(0);
    expect(
      classTokens(screen.getByTestId('execution-live-trigger-label'))
    ).toContain('text-ink');

    expect(has('bg-primary-pale')).toBe(0);
    expect(has('text-primary-text')).toBe(0);
  });
});
