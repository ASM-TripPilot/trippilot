import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Text, View } from 'react-native';

import { requestCount } from './requestCount';

// expo-router 는 렌더 때 늦게 읽는다 — 배럴을 로드하는 jest(루트 레이아웃)가 라우터 목 없이도 이 모듈을 평가할 수 있게.
const usePathname = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('expo-router') as typeof import('expo-router')).usePathname();

/** 화면 구석의 「{구간} · {건수}」 — 화면 진입(경로 변화)·앱 복귀(AppState active)마다 0 에서 다시 센다. 터치를 받지 않는다. */
export function RequestCountBadge() {
  const pathname = usePathname();
  const { label, count } = useSyncExternalStore(
    requestCount.subscribe,
    requestCount.snapshot
  );

  useEffect(() => {
    requestCount.mark(pathname);
  }, [pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') requestCount.mark('복귀');
    });
    return () => sub.remove();
  }, []);

  return (
    <View
      testID="dev-request-badge"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute left-2 top-12 rounded-full bg-black/70 px-2 py-0.5"
    >
      <Text className="text-[11px] text-white">{`${label} · ${count}`}</Text>
    </View>
  );
}
