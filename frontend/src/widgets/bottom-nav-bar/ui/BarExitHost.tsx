import type { ReactElement } from 'react';
import { View } from 'react-native';

import { NAV_BAR_BOTTOM_GAP, NAV_BAR_SIDE } from '@/shared/ui/navBarLayout';

import { useBarExit } from '../model/barExitHandoff';
import { MorphNavBar } from './MorphNavBar';

const noop = (): void => {};

/**
 * TRIP-1831 · 퇴장 호스트 — 탭 레이아웃에 서서, 뒤로를 누른 화면이 빠진 뒤에도 그 바의 퇴장 모프를 끝까지 이어 재생한다.
 * 저장소 값이 없으면 아무것도 그리지 않는다(평상시 트리에 요소 0). 있으면 넘어온 props 그대로 `playExit` 바를 그린다 — 낭독에서 숨기고
 * (원본은 같은 커밋에 걷혀 이미 없다) 터치도 받지 않는다(아래 진짜 탭 바가 눌려야 한다).
 */
export function BarExitHost(): ReactElement | null {
  const exit = useBarExit();
  if (exit === null) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        left: NAV_BAR_SIDE,
        right: NAV_BAR_SIDE,
        bottom: NAV_BAR_BOTTOM_GAP,
      }}
    >
      <MorphNavBar key={exit.id} {...exit.props} onBack={noop} playExit />
    </View>
  );
}
