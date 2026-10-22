import { useRouter } from 'expo-router';

import { PushPage } from '@/pages/onboarding/onboarding-push';

/** 기존 계정이 HOME 에 들어올 때 미결정 알림 권한을 한 번 안내하는 카드(TRIP-1601) — 온보딩 `PushPage` 재사용, 끝은 홈이다. */
export default function PermissionPushRoute() {
  const router = useRouter();

  return <PushPage onNext={() => router.replace('/(tabs)')} />;
}
