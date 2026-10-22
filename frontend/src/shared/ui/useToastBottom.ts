import type { Context } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';

import { registerToastBottom } from './toastBottom';

/**
 * TRIP-1559 · 화면이 "나는 아래 이만큼을 막고 있다"를 토스트 바닥 레지스트리에 신고하는 훅.
 * 마운트 **그리고 포커스**(지금 맨 위에 보이는 화면) 동안만 신고한다 — 스택 아래에 마운트만 된 홈 탭의 값이 위 화면 토스트에 안 새게.
 *
 * `@react-navigation/native` 는 정적 import 하지 않는다: node 버킷에선 ESM 이라 로드가 안 되고, 이 리포의 부분 목
 * (`NavigationContext` 없음)에서도 이 훅을 쓰는 수십 개 컴포넌트 테스트가 살아야 한다. 그래서 지연 `require` 로
 * `NavigationContext` 만 읽고, 없거나 내비게이션 밖이면 "항상 포커스"로 본다.
 */

// 두 메서드 모두 optional — 일부 테스트가 `{ getState }` 만 가진 가짜 내비게이션을 꽂는다. 없으면 "항상 포커스".
interface FocusSource {
  isFocused?: () => boolean;
  addListener?: (type: 'focus' | 'blur', callback: () => void) => () => void;
}

const NO_NAVIGATION = createContext<FocusSource | undefined>(undefined);

function loadNavigationContext(): Context<FocusSource | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('@react-navigation/native') as {
      NavigationContext?: Context<FocusSource | undefined>;
    };
    return loaded.NavigationContext ?? NO_NAVIGATION;
  } catch {
    return NO_NAVIGATION;
  }
}

const NavigationContext = loadNavigationContext();

export function useToastBottom(height: number): void {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation?.addListener) return () => {};
      const offFocus = navigation.addListener('focus', onChange);
      const offBlur = navigation.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation]
  );
  const focused = useSyncExternalStore(
    subscribe,
    () => navigation?.isFocused?.() ?? true
  );

  useEffect(() => {
    if (!focused) return undefined;
    return registerToastBottom(height);
  }, [focused, height]);
}
