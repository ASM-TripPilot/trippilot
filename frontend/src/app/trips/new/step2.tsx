import { Text, View } from 'react-native';

/**
 * g02 거점 숙소 — **자리만**(TRIP-206 AC-7).
 *
 * 왜 여기 있나: `typedRoutes: true`라 `router.push('/trips/new/step2')`가 타입으로 막힌다 —
 * 목적지 파일이 없으면 TRIP-206 AC-1(201 뒤 이동)을 구현할 수 없다. 그래서 **경로만**
 * 만든다. 화면 내용(거점 숙소 후보·커버리지 등)은 `frontend-components.md` §1 라우트
 * 골격이 명시한 대로 TRIP-84·TRIP-193(US-TRIP-04) 몫이고, 이 칸이 떠안지 않는다.
 *
 * 선례: `src/app/explore/destination/[region].tsx`(TRIP-183, 28줄)가 같은 이유로 서 있다.
 */
export default function TripWizardStep2Route() {
  return (
    <View className="flex-1 items-center justify-center gap-sm bg-canvas px-lg">
      <Text className="font-noto-bold text-section font-bold text-ink">
        거점 숙소
      </Text>
      <Text className="text-center font-noto text-body text-muted">
        준비 중이에요
      </Text>
    </View>
  );
}
