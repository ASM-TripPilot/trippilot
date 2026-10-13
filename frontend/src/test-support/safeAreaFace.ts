import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * TRIP-1286 — 안내 얼굴(빈 상태·404·오류·로딩)을 감싼 `SafeAreaView` 가 인셋 영역까지 본문 색을 칠하는지 재는 판정.
 *
 * `SafeAreaView` 는 상태바·홈 인디케이터 높이만큼 **자기 패딩**을 두고 그 안에 자식을 넣는다. 그 패딩 영역의 색은
 * 안쪽 View 가 아니라 SafeAreaView 자신(또는 그 바깥)이 정한다 — 아무도 안 칠하면 뒤의 내비게이션 기본 배경(#F2F2F2)이
 * 위·아래 회색 띠로 비친다. 그래서 안쪽 View 의 색은 세지 않는다(그게 결함 모양이다).
 *
 * 구현 형태는 강제하지 않는다: className 토큰이든 style `backgroundColor` 든, SafeAreaView 자신이든 그 바깥 View 든
 * 인셋 영역 색은 같다. 실제 픽셀은 jest 가 못 보므로 6-b 실기 몫이다.
 */

/** `tailwind.config.js` 색 토큰 — style 로 칠한 경우 비교용. */
const TOKEN_HEX = {
  'bg-canvas': '#FFFFFF',
  'bg-canvas-alt': '#FAFAFA',
} as const;

export type CanvasToken = keyof typeof TOKEN_HEX;

function classTokens(node: ReactTestInstance): string[] {
  return String(node.props.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function flatStyle(node: ReactTestInstance): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style) ?? {}) as Record<
    string,
    unknown
  >;
}

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let parent = node.parent;
  while (parent) {
    out.push(parent);
    parent = parent.parent;
  }
  return out;
}

/** 얼굴을 감싼 가장 가까운 `SafeAreaView`. 없으면 null. */
export function safeAreaAround(
  face: ReactTestInstance
): ReactTestInstance | null {
  return ancestorsOf(face).find((node) => node.type === SafeAreaView) ?? null;
}

/** SafeAreaView 가 패딩을 두는 변 — `edges` 를 배열·객체 어느 모양으로 넘겨도 읽는다. */
export function safeAreaEdges(safeArea: ReactTestInstance): string[] {
  const edges: unknown = safeArea.props.edges;
  if (Array.isArray(edges)) return edges.map(String);
  if (edges && typeof edges === 'object') {
    return Object.entries(edges as Record<string, unknown>)
      .filter(([, mode]) => mode !== 'off')
      .map(([edge]) => edge);
  }
  // edges 미지정 = 네 변 전부(라이브러리 기본값).
  return ['top', 'right', 'bottom', 'left'];
}

function paints(node: ReactTestInstance, token: CanvasToken): boolean {
  if (classTokens(node).includes(token)) return true;
  const color = flatStyle(node).backgroundColor;
  return typeof color === 'string' && color.toUpperCase() === TOKEN_HEX[token];
}

/** 얼굴을 감싼 SafeAreaView 자신 또는 그 바깥 조상이 `token` 색을 칠하는가(인셋 영역의 색). */
export function safeAreaPaints(
  face: ReactTestInstance,
  token: CanvasToken
): boolean {
  const safeArea = safeAreaAround(face);
  if (safeArea === null) return false;
  return [safeArea, ...ancestorsOf(safeArea)].some((node) =>
    paints(node, token)
  );
}

function isCenteredFill(node: ReactTestInstance): boolean {
  const tokens = classTokens(node);
  if (
    tokens.includes('flex-1') &&
    tokens.includes('items-center') &&
    tokens.includes('justify-center')
  ) {
    return true;
  }
  const style = flatStyle(node);
  return (
    style.flex === 1 &&
    style.alignItems === 'center' &&
    style.justifyContent === 'center'
  );
}

/** 얼굴(포함)부터 감싼 SafeAreaView(포함) 사이에 화면을 채우며 가운데 정렬하는 컨테이너가 있는가. */
export function centeredInSafeArea(face: ReactTestInstance): boolean {
  const safeArea = safeAreaAround(face);
  if (safeArea === null) return false;
  const between = [face];
  for (const node of ancestorsOf(face)) {
    between.push(node);
    if (node === safeArea) break;
  }
  return between.some(isCenteredFill);
}
