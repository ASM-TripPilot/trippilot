import { useRouter } from 'expo-router';

import { LocationPage } from '@/pages/onboarding/onboarding-location';
import { getPushPermission } from '@/shared/push';

/**
 * 기존 계정이 HOME 에 들어올 때 미결정 위치 권한을 한 번 안내하는 카드(TRIP-1601) — 온보딩 `LocationPage` 재사용.
 * 다음은 알림도 미결정이면 알림 카드, 아니면 홈이다. 조회가 실패하면 "미결정 아님"으로 접어 홈으로 간다(사용자를 막지 않는다).
 * 가드(`Stack.Protected`)는 `SplashGate` 몫 — HOME 가드 안에 선언돼 있다.
 */
export default function PermissionLocationRoute() {
  const router = useRouter();

  const goNext = async () => {
    const pushUndetermined = await getPushPermission().then(
      (status) => status === 'UNDETERMINED',
      () => false
    );
    // '/' 가 아니라 '/(tabs)' — '/' 는 (onboarding) 인덱스와 겹쳐 HOME 계정에겐 무시된다(TRIP-1597).
    router.replace(pushUndetermined ? '/permission-push' : '/(tabs)');
  };

  return <LocationPage onNext={() => void goNext()} />;
}
