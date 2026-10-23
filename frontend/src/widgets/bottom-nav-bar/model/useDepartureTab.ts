import { useState } from 'react';

import { useStackRoutes } from '@/shared/lib/useStackRoutes';
import type { ShellTabKey } from '@/shared/ui/BottomTabBar';

/** `(tabs)` 안 라우트 이름 → 탭 key. 홈만 파일 규약상 `index` 다(`app/(tabs)/_layout.tsx` 의 매핑과 같다). */
const TAB_ROUTE_TO_KEY: Record<string, ShellTabKey> = {
  index: 'home',
  explore: 'explore',
  itinerary: 'itinerary',
  records: 'records',
  my: 'my',
};

/**
 * 이 화면으로 오기 직전 홈 탭 바에서 활성이던 탭 — 루트 스택에서 이 화면 바로 아래 라우트가 `(tabs)` 면 그 안의 현재 탭, 아니면 undefined
 * (푸시 딥링크·칸 이동 등 탭 바 위가 아닌 진입 → 바는 모션 없이 최종 구조). 진입점이 여러 곳이라 href 에 싣지 않고 내비게이션 상태를 읽는다.
 * 마운트될 때 한 번만 읽는다(이후 그 아래 탭은 바뀌지 않는다). 내비게이션 문맥이 없는 렌더(jest)에선 undefined 다.
 * (TRIP-1584 — 허브 페이지에 있던 로직을 허브·기록 하단 바가 같이 쓰도록 옮겼다.)
 */
export function useDepartureTab(): ShellTabKey | undefined {
  const { getRoutes, selfKey } = useStackRoutes();
  const [tab] = useState(() => {
    const routes = getRoutes();
    const below = routes[routes.findIndex((r) => r.key === selfKey) - 1];
    if (below?.name !== '(tabs)') return undefined;
    const tabs = below.state;
    // 탭을 한 번도 안 바꿨으면(기본 상태) 중첩 상태가 부모 라우트에 저장되지 않는다 — 그때 활성 탭은 첫 화면 `index`(홈)다.
    const name = tabs ? tabs.routes[tabs.index ?? 0]?.name : 'index';
    return name === undefined ? undefined : TAB_ROUTE_TO_KEY[name];
  });
  return tab;
}
