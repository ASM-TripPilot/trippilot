import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGetTrips } from '@/shared/api/generated/trips/trips';
import { InfoCircleGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * (tabs) 일정 진입 라우트 — 죽은 껍데기가 아니라 활성 여행으로 리다이렉트하거나 빈 상태를 준다(AC9).
 *
 * 여행이 있으면 그 일정으로 **문자열 href** 리다이렉트한다(객체 href 는 마커가 관찰 못 함 · onboarding
 * 선례). 없으면 빈 상태 + [여행 만들기]. "여러 여행 중 활성 하나 고르기" 규칙은 정본에 없어 첫
 * 여행으로 보낸다(다중 선택 규칙을 발명하지 않는다).
 */
export default function ItineraryTab() {
  const router = useRouter();
  const trips = useGetTrips();
  const list = trips.data ?? [];

  if (list.length > 0) {
    return <Redirect href={`/trips/${list[0].tripId}/itinerary`} />;
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID="itinerary-tab-empty"
          icon={<InfoCircleGlyph size={32} tone="primaryText" />}
          title="아직 여행이 없어요"
          description="여행을 만들면 일정을 세울 수 있어요"
          actions={[
            {
              testID: 'itinerary-tab-create-trip',
              label: '여행 만들기',
              variant: 'filled',
              onPress: () => router.push('/trips/new/step1'),
            },
          ]}
        />
      </View>
    </SafeAreaView>
  );
}
