import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { getGateDestination, type BootstrapDestination } from '@/features/auth';

// '/' 는 (onboarding)/index 와 (tabs)/index 둘에 걸리는데, 라우터는 가드를 모른 채 (onboarding) 쪽으로
// 푼다 — 그 그룹이 닫힌 상태(HOME 등)면 replace 가 조용히 버려진다. 그래서 게이트가 지금 연 그룹을 직접 가리킨다.
const HOME_HREF: Record<BootstrapDestination, Href> = {
  HOME: '/(tabs)',
  ONBOARDING: '/(onboarding)',
  LOGIN: '/login',
  RECONSENT: '/reconsent',
  FORCE_UPDATE: '/force-update',
};

/**
 * 없는 경로 화면(TRIP-935 R3) — expo-router 기본 영문 화면(Unmatched Route + Sitemap 링크)을
 * 대체한다. [홈으로]는 replace — 뒤로가기로 이 화면에 돌아오지 않게. 목적지는 게이트가 연 그룹이다.
 */
export default function NotFoundRoute() {
  return (
    <View className="flex-1 items-center justify-center gap-lg bg-canvas px-2xl">
      <Text className="font-noto-bold text-hero font-bold text-ink">
        페이지를 찾을 수 없어요
      </Text>
      <Text className="font-noto text-center text-body text-muted">
        주소가 바뀌었거나 없는 화면이에요
      </Text>
      <Pressable
        testID="not-found-home"
        accessibilityRole="button"
        onPress={() =>
          router.replace(HOME_HREF[getGateDestination() ?? 'HOME'])
        }
        className="h-[52px] w-full items-center justify-center rounded-button bg-primary"
      >
        <Text className="font-noto-bold text-card-title font-bold text-on-primary">
          홈으로
        </Text>
      </Pressable>
    </View>
  );
}
