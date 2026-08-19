import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

/**
 * /stays/[stayId] — e02 숙소 상세 **임시 스텁 라우트**(TRIP-420).
 *
 * 카드 탭이 착지할 자리만 만든다 — `useLocalSearchParams`로 받은 param(어느 숙소인지)을
 * 표시하고 뒤로가기만 있다. 상세 데이터는 계약 3종(상세 GET·라이브가격·OTA outbound)이
 * openapi 에 전부 없어 **아무것도 조회하지 않는다**(INV-1 — 데이터 발명 금지). self-contained
 * 인라인 컴포넌트는 `explore/destination/[region].tsx` 스텁 선례와 동형이다.
 *
 * `useLocalSearchParams`는 **디코드된** 값을 준다 — 페이지가 `encodeURIComponent`로
 * `NAVER%3As1`을 push 해도 여기선 `NAVER:s1`을 받는다.
 *
 * // ponytail: 임시 스텁 — e03 풀 상세(US-STAY-03)는 TRIP-323
 */
export default function StaysDetailStubRoute() {
  const { stayId } = useLocalSearchParams<{ stayId?: string }>();

  return (
    <View
      testID="stay-detail-stub-root"
      className="flex-1 items-center justify-center gap-sm bg-canvas px-lg"
    >
      <Text className="font-noto-bold text-section font-bold text-ink">
        {stayId ?? '숙소'}
      </Text>
      <Text className="text-center font-noto text-body text-muted">
        숙소 상세는 준비 중이에요
      </Text>
      <Pressable
        testID="stay-detail-stub-back"
        accessibilityRole="button"
        onPress={() => router.back()}
        className="mt-md rounded-pill border border-hairline-strong px-lg py-sm"
      >
        <Text className="font-noto text-body text-ink">뒤로가기</Text>
      </Pressable>
    </View>
  );
}
