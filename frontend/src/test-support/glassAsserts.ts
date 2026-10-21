import { screen } from '@testing-library/react-native';
import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * TRIP-1522 v2 · 유리(glass) 표면을 렌더 트리에서 읽는 공용 도우미 — `GlassSurface`·`LiveBottomBar`·`LiveEditPopup`·
 * 허브(행사 카드) 테스트가 같이 쓴다. 유리 값은 `GlassSurface` 한 곳에서만 정해지고 사용처는 그 값을 그대로 받아야 한다.
 *
 * (개념) 유리 표면 = `그림자 래퍼 View → BlurView(expo-blur) → [흰 0.68 레이어] + 내용`. 값은 세 군데에 나뉘어 있다:
 *  - 블러·테두리 → `BlurView` 의 props(`intensity`·`tint`·`experimentalBlurMethod`·`style`)
 *  - 그림자 → BlurView 의 가장 가까운 **host** 조상 `View` 의 `style`(`overflow-hidden` 이 그림자를 자르므로 바깥 래퍼가 진다)
 *  - 흰 레이어 → BlurView 안 host View 의 `className`(`bg-canvas/[0.68]`) 또는 `style.backgroundColor`(`rgba(255,255,255,0.68)`)
 */

export const GLASS_RECIPE = {
  intensity: 70,
  tint: 'light',
  method: 'dimezisBlurView',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.5)',
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.1,
  shadowRadius: 14,
  elevation: 4,
  tintOpacity: 0.68,
} as const;

export const isBlurNode = (node: ReactTestInstance): boolean =>
  node.type === (BlurView as unknown);

/** 범위(기본: 화면 전체) 안의 BlurView 노드들. */
export function blurViewsIn(scope?: ReactTestInstance): ReactTestInstance[] {
  return (scope ?? screen.root).findAll(isBlurNode);
}

/** 이 노드를 품은 가장 가까운 BlurView 조상(없으면 null) — "이 글자·버튼이 유리 위에 있다". */
export function glassAncestor(
  node: ReactTestInstance
): ReactTestInstance | null {
  for (let up = node.parent; up; up = up.parent) {
    if (isBlurNode(up)) return up;
  }
  return null;
}

export interface GlassReading {
  intensity: unknown;
  tint: unknown;
  method: unknown;
  borderWidth: unknown;
  borderColor: unknown;
  shadowColor: unknown;
  shadowOffset: unknown;
  shadowOpacity: unknown;
  shadowRadius: unknown;
  elevation: unknown;
  /** 읽지 못하면 null */
  tintOpacity: number | null;
}

/** 흰 레이어 불투명도 — className `bg-canvas/[0.68]` 또는 `style.backgroundColor` `rgba(255,255,255,0.68)` 둘 다 읽는다. */
export function tintOpacityOf(node: ReactTestInstance): number | null {
  const className = String(node.props?.className ?? '');
  const fromClass = /bg-canvas\/\[([0-9.]+)\]/.exec(className);
  if (fromClass) return Number(fromClass[1]);
  const style = StyleSheet.flatten(node.props?.style) ?? {};
  const bg = style.backgroundColor;
  if (typeof bg === 'string') {
    const fromStyle =
      /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+)\s*\)$/.exec(bg);
    if (fromStyle) return Number(fromStyle[1]);
  }
  return null;
}

/** BlurView 노드 하나에서 유리 값을 읽는다. */
export function readGlass(blur: ReactTestInstance): GlassReading {
  const border = StyleSheet.flatten(blur.props.style) ?? {};
  // 그림자 래퍼 = 가장 가까운 host 조상 중 style 에 shadowOpacity 가 있는 것.
  let shadow: Record<string, unknown> = {};
  for (let up = blur.parent; up; up = up.parent) {
    if (typeof up.type !== 'string') continue;
    const style = StyleSheet.flatten(up.props.style) ?? {};
    if (typeof style.shadowOpacity === 'number') {
      shadow = style as Record<string, unknown>;
      break;
    }
  }
  const layers = blur
    .findAll((node) => typeof node.type === 'string')
    .map(tintOpacityOf)
    .filter((value): value is number => value !== null);
  return {
    intensity: blur.props.intensity,
    tint: blur.props.tint,
    method: blur.props.experimentalBlurMethod,
    borderWidth: border.borderWidth,
    borderColor: border.borderColor,
    shadowColor: shadow.shadowColor,
    shadowOffset: shadow.shadowOffset,
    shadowOpacity: shadow.shadowOpacity,
    shadowRadius: shadow.shadowRadius,
    elevation: shadow.elevation,
    tintOpacity: layers[0] ?? null,
  };
}

/** 이 BlurView 가 유리 레시피와 값이 모두 같다 — 값마다 따로 expect 해 어느 값이 틀렸는지 보이게 한다. */
export function expectGlassRecipe(blur: ReactTestInstance): void {
  const glass = readGlass(blur);
  expect(glass.intensity).toBe(GLASS_RECIPE.intensity);
  expect(glass.tint).toBe(GLASS_RECIPE.tint);
  expect(glass.method).toBe(GLASS_RECIPE.method);
  expect(glass.borderWidth).toBe(GLASS_RECIPE.borderWidth);
  expect(glass.borderColor).toBe(GLASS_RECIPE.borderColor);
  expect(glass.shadowColor).toBe(GLASS_RECIPE.shadowColor);
  expect(glass.shadowOffset).toEqual(GLASS_RECIPE.shadowOffset);
  expect(glass.shadowOpacity).toBe(GLASS_RECIPE.shadowOpacity);
  expect(glass.shadowRadius).toBe(GLASS_RECIPE.shadowRadius);
  expect(glass.elevation).toBe(GLASS_RECIPE.elevation);
  expect(glass.tintOpacity).toBe(GLASS_RECIPE.tintOpacity);
}
