import { Redirect } from 'expo-router';

/** 웹엔 푸시가 없어 안내 카드를 건너뛰고 홈으로 보낸다(TRIP-1648). */
export default function PermissionPushWebRoute() {
  return <Redirect href="/(tabs)" />;
}
