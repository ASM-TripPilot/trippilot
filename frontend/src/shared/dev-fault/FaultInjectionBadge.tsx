import { useEffect, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { faultStore } from './store';

/** 화면 구석의 「실패 주입 켜짐 · N」 — 규칙이 없으면 아무것도 그리지 않는다. 터치를 받지 않는다. */
export function FaultInjectionBadge() {
  const rules = useSyncExternalStore(faultStore.subscribe, faultStore.rules);
  useEffect(() => {
    // 재시작 직후 요청이 아직 없어도 저장된 규칙을 읽어 표시한다.
    void faultStore.ready();
  }, []);
  if (rules.length === 0) return null;
  return (
    <View
      testID="dev-fault-badge"
      pointerEvents="none"
      className="absolute right-2 top-12 rounded-full bg-black/70 px-2 py-0.5"
    >
      <Text className="text-[11px] text-white">
        {`실패 주입 켜짐 · ${rules.length}`}
      </Text>
    </View>
  );
}
