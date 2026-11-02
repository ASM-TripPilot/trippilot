import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { faultStore, type FaultLinkAction } from '@/shared/dev-fault';

/**
 * 실패 주입 켜고 끄기(개발 빌드 전용 — `app/_dev` 는 운영 blockList 로 번들에서 빠진다).
 *   `com.trippilot.travel://_dev/fault?path=/trips/*\/itinerary&status=500` · `&delay=5000` · `&code=GENERATION_IN_PROGRESS`
 *   `com.trippilot.travel://_dev/fault?clear=1`
 * 규칙은 GET 에만 걸리고 끄기 전까지(재시작 후에도) 유지된다. 결과와 현재 규칙을 보여 주고, [돌아가기]로 원래 화면에 간다.
 */
export default function DevFaultRoute() {
  const params = useLocalSearchParams();
  const [result, setResult] = useState<FaultLinkAction | null>(null);
  const rules = useSyncExternalStore(faultStore.subscribe, faultStore.rules);

  useEffect(() => {
    void faultStore.apply(params).then(setResult);
    // 딥링크 한 번 = 적용 한 번. params 객체는 렌더마다 새로 만들어진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  return (
    <SafeAreaView testID="dev-fault-root" className="flex-1 bg-white p-4">
      <Text className="text-[17px] font-bold">실패 주입</Text>
      <Text testID="dev-fault-result" className="mt-2 text-[13px]">
        {result === null
          ? '적용 중…'
          : result.type === 'invalid'
            ? `무시됨 — ${result.reason}`
            : result.type === 'clear'
              ? '모두 껐다'
              : `켰다 — ${result.rule.path}`}
      </Text>
      <View className="mt-4">
        {rules.map((rule) => (
          <Text key={rule.path} className="text-[13px]">
            {`GET ${rule.path} → ${rule.status ?? '(정상)'}${rule.delayMs ? ` · ${rule.delayMs}ms 지연` : ''}${rule.code ? ` · ${rule.code}` : ''}`}
          </Text>
        ))}
      </View>
      <Pressable
        testID="dev-fault-back"
        accessibilityRole="button"
        className="mt-6 self-start rounded-lg bg-black px-4 py-2"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace('/')
        }
      >
        <Text className="text-white">돌아가기</Text>
      </Pressable>
    </SafeAreaView>
  );
}
