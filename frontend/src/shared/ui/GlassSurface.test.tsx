import { render, screen } from '@testing-library/react-native';
import { BlurView } from 'expo-blur';
import { StyleSheet, Text } from 'react-native';

import { GlassSurface } from './GlassSurface';

/**
 * 유리(glass) 표면 부품 — 허브 하단 바(뒤로·캡슐)·수정 팝업 알약·행사 카드가 같이 쓰는 한 곳. 값은 앱 하단 탭 바와 같고(TRIP-1104·1436) 이 부품 한 곳에서만
 * 잠근다(README 판정 4 의 예외 — 브리프가 [T] 로 정함; 사용처가 이 부품을 쓰는지·블러가 실제로 그려지는지·안드로이드 지도 위 블러는 6-b).
 */

function renderGlass(props: Parameters<typeof GlassSurface>[0] = {}) {
  render(
    <GlassSurface testID="g" {...props}>
      <Text testID="g-child">내용</Text>
    </GlassSurface>
  );
  return screen.UNSAFE_getByType(BlurView);
}

describe('GlassSurface', () => {
  it('블러·테두리·그림자·흰 레이어 값이 레시피와 같고, 흰 레이어는 터치를 삼키지 않으며(none) 자식은 BlurView 안에 선다', () => {
    const blur = renderGlass();

    expect(blur.props).toMatchObject({
      intensity: 70,
      tint: 'light',
      experimentalBlurMethod: 'dimezisBlurView',
    });
    expect(StyleSheet.flatten(blur.props.style)).toMatchObject({
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.5)',
    });
    // 그림자는 overflow-hidden 인 BlurView 가 아니라 바깥 래퍼가 진다(잘리지 않게).
    expect(
      StyleSheet.flatten(screen.getByTestId('g').props.style)
    ).toMatchObject({
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 14,
      elevation: 4,
    });
    const layers = blur.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String(node.props.className ?? '').includes('bg-canvas/[0.68]')
    );
    expect(layers).toHaveLength(1);
    expect(layers[0].props.pointerEvents).toBe('none');
    expect(
      blur.findAll((node) => node.props.testID === 'g-child')
    ).not.toHaveLength(0);
  });

  it('testID·className·style 은 바깥 래퍼로(style 을 줘도 그림자 유지), contentClassName·contentStyle 은 BlurView 로 간다(테두리 유지)', () => {
    const blur = renderGlass({
      className: 'outer-x',
      style: { width: 100 },
      contentClassName: 'inner-x',
      contentStyle: { paddingLeft: 7 },
    });

    const wrapper = screen.getByTestId('g');
    const outer = StyleSheet.flatten(wrapper.props.style);
    expect(wrapper.props.className).toContain('outer-x');
    expect(outer).toMatchObject({ width: 100, shadowOpacity: 0.1 });
    const inner = StyleSheet.flatten(blur.props.style);
    expect(blur.props.className).toContain('inner-x');
    expect(inner).toMatchObject({ paddingLeft: 7, borderWidth: 1 });
  });
});
