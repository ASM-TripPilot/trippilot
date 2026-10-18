import { Stack } from 'expo-router';

/**
 * 온보딩 그룹 레이아웃 — 진행 판정 없이 스택만 그린다(TRIP-1421). 완료자 방어는 루트 게이트(SplashGate 의
 * Stack.Protected)가 하고, 진입 단계 판정은 index 가 한다. 여기서 `'/'`로 보내면 그룹 안의 `'/'`가 온보딩
 * index 로 되풀려 루프가 되고, 미완자를 매번 특정 단계로 보내면 하위 화면에서 튕긴다.
 */
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
