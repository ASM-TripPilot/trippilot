import { Stack } from 'expo-router';

/**
 * 여행 생성 위저드 셸(BR-U1-33) — `(tabs)` 밖 몰입 화면이라 탭바가 구조적으로 안 붙는다.
 * 진행 표시(`1 / 2`)는 각 화면(`TripWizardStep1Screen` 등)이 스스로 그린다 — 이 레이아웃은
 * 네이티브 헤더만 끈다.
 */
export default function TripWizardLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
