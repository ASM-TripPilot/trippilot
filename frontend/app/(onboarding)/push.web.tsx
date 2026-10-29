import { Redirect } from 'expo-router';

/** 웹엔 푸시가 없어 안내 카드를 건너뛴다(TRIP-1648) — 온보딩 순서상 다음은 취향 1/2. */
export default function PushWebRoute() {
  return <Redirect href="/(onboarding)/pref1" />;
}
