import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

/**
 * 장소(POI) 상세 — **스텁 자리만**(TRIP-446).
 *
 * 왜 여기 있나: `typedRoutes: true`라 `router.push('/explore/places/…')`가 타입으로 막힌다 —
 * 장소 상세 파일이 없으면 d01 랜딩 카드 → 상세(T3) 배선을 구현할 수 없다. 그래서 **경로만**
 * 세운다. 단건 조회 계약(`GET /places/{poiId}`)이 아직 없어(목록만 존재) 화면 내용은 스텁이다 —
 * 없는 필드를 지어내지 않는다(INV-1). 실제 상세(밴드 d)는 단건 계약 결정 후 별도 티켓 몫.
 *
 * 선례: `explore/destination/[region].tsx`도 같은 이유("경로만 먼저")로 서 있다.
 */

// 딥링크로 이 화면에 직접 떨어지면(explore/**는 (tabs) 밖) 뒤로 갈 히스토리가 없다 —
// 그때 back()은 침묵 no-op이 되어 사용자가 갇힌다. 홈으로 replace해 탈출구를 준다(TRIP-402 규율).
const HOME_FALLBACK = '/(tabs)';

export default function PlaceDetailRoute() {
  const router = useRouter();
  const { poiId } = useLocalSearchParams<{ poiId?: string }>();

  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(HOME_FALLBACK);
    }
  }

  return (
    <View
      testID="place-detail-stub-root"
      className="flex-1 items-center justify-center gap-sm bg-canvas px-lg"
    >
      <Pressable
        testID="place-detail-stub-back"
        accessibilityRole="button"
        onPress={handleBack}
        hitSlop={8}
      >
        <Text className="font-noto text-body text-muted">← 뒤로</Text>
      </Pressable>
      <Text className="font-noto-bold text-section font-bold text-ink">
        장소 상세
      </Text>
      <Text className="text-center font-noto text-body text-muted">
        준비 중이에요
      </Text>
      {/* 받은 식별자만 에코한다 — 없는 필드를 지어내지 않는다(스텁). */}
      <Text
        testID="place-detail-stub-poi"
        className="font-noto text-label text-muted"
      >
        {poiId ?? '장소'}
      </Text>
    </View>
  );
}
