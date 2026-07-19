import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  getActiveScenarioKey,
  SCENARIO_LIST,
  setScenario,
  type ScenarioKey,
} from '@/mocks/scenarios';

/**
 * dev 전용 mock 시나리오 스위처(D4 — preview.tsx 대체). EXPO_PUBLIC_API_MOCK 이 켜진 dev 빌드에서만
 * 동작한다. 버튼을 누르면 활성 시나리오를 갈아끼워(setScenario) 그다음 부트스트랩/소셜 로그인 응답을
 * 바꾼다 → 성공/취소/에러/충돌/연령/부트스트랩 상태 전이를 손으로 유발해 확인한다.
 */
export default function DevScenariosScreen() {
  const [activeKey, setActiveKey] = useState<ScenarioKey>(
    getActiveScenarioKey()
  );

  if (process.env.EXPO_PUBLIC_API_MOCK !== '1') {
    return (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-center text-gray-600">
          시나리오 스위처는 mock 모드(EXPO_PUBLIC_API_MOCK)에서만 열려요
        </Text>
      </View>
    );
  }

  const select = (key: ScenarioKey) => {
    setScenario(key);
    setActiveKey(key);
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 8, padding: 16 }}>
      <Text className="mb-2 text-lg font-bold">Mock 시나리오</Text>
      {SCENARIO_LIST.map((scenario) => {
        const key = scenario.key as ScenarioKey;
        const selected = key === activeKey;
        return (
          <Pressable
            key={scenario.key}
            onPress={() => select(key)}
            style={{
              borderRadius: 8,
              padding: 12,
              backgroundColor: selected ? '#2563eb' : '#374151',
            }}
          >
            <Text style={{ color: 'white' }}>{scenario.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
