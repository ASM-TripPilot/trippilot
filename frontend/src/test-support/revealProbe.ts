import { getAnimatedStyle } from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * TRIP-1641 · `RevealItem`(등장 모션 래퍼)의 투명도·이동을 jest 로 읽는 공용 도우미 — 단위 테스트(`RevealItem.test`)와
 * 쓰는 화면 테스트(`DraftPage.integration`·`TripSummaryScreen.test`)가 같은 눈으로 본다.
 *
 * 래퍼는 testID 를 받지 않는다(공개 prop 을 늘리지 않으려고). 그래서 "자식 호스트에서 가장 가까운 호스트 조상" = 래퍼로 읽는다 —
 * 래퍼 안쪽에 호스트 View 가 한 겹 더 끼면 이 읽기가 안쪽을 가리켜 투명도가 안 보인다(그게 계약 위반이라 일부러 둔다).
 * ⚠️ 값은 `getAnimatedStyle` 로만 읽는다 — host `props.style` 은 첫 렌더 값에 굳는다. 가짜 타이머로 흘릴 때만 움직임이 보인다.
 */

/** 자식 노드에서 위로 올라가 처음 만나는 호스트 노드(= 래퍼 `Animated.View` 의 호스트). */
export function revealWrapper(child: ReactTestInstance): ReactTestInstance {
  let node: ReactTestInstance | null = child.parent;
  while (node && typeof node.type !== 'string') node = node.parent;
  if (!node) throw new Error('자식 위에 호스트 래퍼가 없다');
  return node;
}

export interface RevealValues {
  opacity: number;
  /** 아래로 밀린 정도(px). 25 → 0 으로 올라온다. transform 이 없으면 0. */
  translateY: number;
}

/** 래퍼의 지금 투명도·translateY — 병합된 최신 값(`getAnimatedStyle`). */
export function revealValues(child: ReactTestInstance): RevealValues {
  const style = getAnimatedStyle(revealWrapper(child)) as {
    opacity?: unknown;
    transform?: Record<string, unknown>[];
  };
  const shift = (style.transform ?? []).find(
    (step) => typeof step.translateY === 'number'
  );
  return {
    // 투명도 키가 없으면 NaN — "보인다(1)"로 읽혀 공허하게 통과하지 않게 한다.
    opacity: typeof style.opacity === 'number' ? style.opacity : Number.NaN,
    translateY: typeof shift?.translateY === 'number' ? shift.translateY : 0,
  };
}
