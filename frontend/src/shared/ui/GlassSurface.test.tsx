import { render, screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import {
  blurViewsIn,
  expectGlassRecipe,
  glassAncestor,
  isBlurNode,
  readGlass,
  tintOpacityOf,
} from '@/test-support/glassAsserts';

import { GlassSurface } from './GlassSurface';

/**
 * TRIP-1522 v2 · 유리(glass) 표면 부품 — 하단 바(뒤로·캡슐)·수정 팝업 알약·행사 카드가 같이 쓰는 한 곳.
 * 흰 반투명 + 흰 테두리 + 뒤 배경 블러 + 그림자를 한 묶음으로 쓰며, 값은 앱 하단 탭 바(`BottomTabBar`)와 같다.
 *
 * 무엇을 보장하나:
 *  - 블러 intensity 70·tint light·dimezisBlurView, 테두리 1px `rgba(255,255,255,0.5)`, 그림자 0.10·{0,4}·14·elevation 4,
 *    흰 레이어 0.68 — 값이 이 부품 한 곳에서 잠긴다(README 판정 4 의 예외: 브리프 AC-15 가 [T] 로 정함).
 *  - 흰 레이어는 터치를 삼키지 않고(pointerEvents none), 자식은 BlurView 안에 선다.
 *  - 바깥 래퍼가 testID·className·style 을 받고 그림자가 `style` 병합으로 사라지지 않는다. 반경은 바깥·안쪽 둘 다 같다.
 *
 * 3동작: 준비(부품 렌더) → 실행(트리 읽기) → 단언(값). 블러가 실제로 그려지는지·안드로이드 지도 위 블러는 6-b.
 */

function renderGlass(props: Parameters<typeof GlassSurface>[0] = {}) {
  render(
    <GlassSurface testID="g" {...props}>
      <Text testID="g-child">내용</Text>
    </GlassSurface>
  );
}

describe('GlassSurface · GS1 값 잠금 (AC-15)', () => {
  it('블러·테두리·그림자·흰 레이어 값이 레시피와 같다 — 값마다 따로 본다', () => {
    renderGlass();

    const blurs = blurViewsIn();
    expect(blurs).toHaveLength(1);
    const glass = readGlass(blurs[0]);
    expect(glass.intensity).toBe(70);
    expect(glass.tint).toBe('light');
    expect(glass.method).toBe('dimezisBlurView');
    expect(glass.borderWidth).toBe(1);
    expect(glass.borderColor).toBe('rgba(255,255,255,0.5)');
    expect(glass.shadowColor).toBe('#000000');
    expect(glass.shadowOffset).toEqual({ width: 0, height: 4 });
    expect(glass.shadowOpacity).toBe(0.1);
    expect(glass.shadowRadius).toBe(14);
    expect(glass.elevation).toBe(4);
    expect(glass.tintOpacity).toBe(0.68);
    // 묶음 단언(공용 도우미가 같은 값을 쓴다 — 사용처 테스트가 이 도우미로 확인한다).
    expectGlassRecipe(blurs[0]);
  });
});

describe('GlassSurface · GS2 흰 레이어·자식 (AC-15)', () => {
  it('흰 레이어는 BlurView 안에서 터치를 삼키지 않고(none), 자식은 BlurView 안에 선다', () => {
    renderGlass();

    const [blur] = blurViewsIn();
    const layers = blur.findAll(
      (node) => typeof node.type === 'string' && tintOpacityOf(node) !== null
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].props.pointerEvents).toBe('none');
    expect(glassAncestor(screen.getByTestId('g-child'))).toBe(blur);
  });
});

describe('GlassSurface · GS3 바깥/안쪽 전달 (AC-15)', () => {
  it('testID·className·style 은 바깥 래퍼로(그림자 유지), contentClassName·contentStyle 은 BlurView 로 간다', () => {
    renderGlass({
      className: 'outer-x',
      style: { width: 100 },
      contentClassName: 'inner-x',
      contentStyle: { paddingLeft: 7 },
    });

    const wrapper = screen.getByTestId('g');
    const outer = StyleSheet.flatten(wrapper.props.style);
    expect(wrapper.props.className).toContain('outer-x');
    expect(outer.width).toBe(100);
    // 병합돼도 그림자가 남는다 — style 을 주면 그림자가 사라지는 구현을 막는다.
    expect(outer.shadowOpacity).toBe(0.1);

    const [blur] = blurViewsIn();
    expect(blur.props.className).toContain('inner-x');
    expect(StyleSheet.flatten(blur.props.style).paddingLeft).toBe(7);
    // 안쪽 style 을 줘도 테두리가 남는다.
    expect(StyleSheet.flatten(blur.props.style).borderWidth).toBe(1);
  });

  it('반경은 바깥·안쪽에 같이 가고(기본 rounded-pill), radiusClassName 을 주면 둘 다 바뀐다', () => {
    renderGlass();
    const [blur] = blurViewsIn();
    expect(screen.getByTestId('g').props.className).toContain('rounded-pill');
    expect(blur.props.className).toContain('rounded-pill');
    screen.unmount();

    renderGlass({ radiusClassName: 'rounded-button' });
    const [custom] = blurViewsIn();
    expect(screen.getByTestId('g').props.className).toContain('rounded-button');
    expect(screen.getByTestId('g').props.className).not.toContain(
      'rounded-pill'
    );
    expect(custom.props.className).toContain('rounded-button');
    expect(custom.props.className).not.toContain('rounded-pill');
    expect(isBlurNode(custom)).toBe(true);
  });
});
