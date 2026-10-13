import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import tailwindConfig from '../../../../tailwind.config.js';
import { ChevronRightGlyph } from './SettingsGlyphs';

/**
 * `ChevronRightGlyph` 기본색 무회귀 — color 를 안 넘기는 다른 화면 4곳이 기대는 값(hairline-strong).
 *
 * TRIP-777(l04)이 chevron 에 muted 색을 넘기게 되면서 기본값까지 바뀌지 않았는지 잠근 앵커다. 옛
 * `MyStaysScreen.l04parity.test.tsx` AC-7 describe 를 소스 옆으로 옮겼다(TRIP-1148 · 01b Q4).
 */

const COLORS = (
  tailwindConfig as unknown as {
    theme: { extend: { colors: Record<string, string> } };
  }
).theme.extend.colors;

/** 색 토큰 → react-native-svg 가 렌더 트리에 남기는 stroke 값(ARGB 정수). */
function svgColor(hex: string): number {
  return 0xff000000 + parseInt(hex.slice(1), 16);
}

/** 노드 아래에서 stroke 를 가진 SVG host 노드(RNSVGPath·RNSVGLine 등). */
function svgStrokes(node: ReactTestInstance): ReactTestInstance[] {
  return node.findAll(
    (n) =>
      typeof n.type === 'string' &&
      n.type.startsWith('RNSVG') &&
      n.props.stroke !== undefined
  );
}

function strokeOf(n: ReactTestInstance): unknown {
  return (n.props.stroke as { payload?: unknown }).payload;
}

describe('TRIP-777 · ChevronRightGlyph 기본색 무회귀 (AC-7, 선제 green 앵커)', () => {
  it('color 를 안 넘기면 여전히 hairline-strong 색이다(다른 화면 4곳이 기대는 값)', () => {
    const { root } = render(<ChevronRightGlyph />);

    const strokes = svgStrokes(root);
    expect(strokes).toHaveLength(1);
    expect(strokeOf(strokes[0] as ReactTestInstance)).toBe(
      svgColor(COLORS['hairline-strong'] as string)
    );
  });
});
