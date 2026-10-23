import type { Context } from 'react';
import { createContext, useContext } from 'react';

/**
 * TRIP-1584 · 내비게이션 스택을 읽는 훅(지금 스택의 라우트들 + 이 화면의 key). 허브/기록 하단 바의 "출발 탭" 판독(`useDepartureTab`)과
 * 기록 3종의 칸 이동("가려는 화면이 이미 스택에 있나")이 같이 쓴다.
 *
 * `@react-navigation/native` 는 정적 import 하지 않는다 — node 버킷에선 ESM 이라 로드가 안 되고, 이 훅이 위젯·피처 배럴에 걸리면 뷰 테스트
 * 수백 개가 그 패키지를 끌고 오게 된다. 그래서 `useToastBottom` 처럼 지연 `require` 로 두 Context 만 읽고, 없거나 내비게이션 밖이면
 * "빈 스택"으로 본다. `getRoutes()` 는 렌더 때 굳히지 않고 **부를 때** 읽는다(누르는 순간의 스택).
 */

export interface StackRouteLike {
  key: string;
  name: string;
  /** 중첩 내비게이터(탭)의 상태 — 한 번도 안 바꾼 기본 상태면 부모 라우트에 저장되지 않아 없다. */
  state?: { index?: number; routes: { name: string }[] };
}
interface StackNavigation {
  getState: () => { routes: readonly StackRouteLike[] };
}

const NO_NAVIGATION = createContext<StackNavigation | undefined>(undefined);
const NO_ROUTE = createContext<{ key: string } | undefined>(undefined);

function loadContexts(): {
  navigation: Context<StackNavigation | undefined>;
  route: Context<{ key: string } | undefined>;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@react-navigation/native') as {
      NavigationContext?: Context<StackNavigation | undefined>;
      NavigationRouteContext?: Context<{ key: string } | undefined>;
    };
    return {
      navigation: loaded.NavigationContext ?? NO_NAVIGATION,
      route: loaded.NavigationRouteContext ?? NO_ROUTE,
    };
  } catch {
    return { navigation: NO_NAVIGATION, route: NO_ROUTE };
  }
}

const CONTEXTS = loadContexts();

export function useStackRoutes(): {
  getRoutes: () => readonly StackRouteLike[];
  selfKey: string | undefined;
} {
  const navigation = useContext(CONTEXTS.navigation);
  const route = useContext(CONTEXTS.route);
  return {
    getRoutes: () => navigation?.getState().routes ?? [],
    selfKey: route?.key,
  };
}
