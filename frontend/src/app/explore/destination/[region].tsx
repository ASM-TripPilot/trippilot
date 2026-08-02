import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

/**
 * d03 목적지 상세 — **자리만**(TRIP-183).
 *
 * 왜 여기 있나: `typedRoutes: true`라 `router.push('/explore/destination/…')`가 타입으로
 * 막힌다 — 목적지 파일이 없으면 BR-U1-07의 "다음 목적지만 다르다"를 구현할 수 없다.
 * 그래서 **경로만** 만든다. 화면 내용(인기 스팟 그리드·"이 지역에서 묵을 곳" 등)은
 * `frontend-components.md` §2 `DestinationDetail` 이고 **밴드 d 티켓 몫**이다 —
 * 그 요구를 여기서 떠안지 않는다(TRIP-183 「경계 주의」).
 *
 * 선례: 정본 §2 `CommunityTeaser`도 "1차 자리만"으로 서 있다(BR-U1-05).
 */
export default function DestinationRoute() {
  const { region } = useLocalSearchParams<{ region?: string }>();

  return (
    <View className="flex-1 items-center justify-center gap-sm bg-canvas px-lg">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {region ?? '여행지'} 상세
      </Text>
      <Text className="text-center font-noto text-body text-muted">
        준비 중이에요
      </Text>
    </View>
  );
}
