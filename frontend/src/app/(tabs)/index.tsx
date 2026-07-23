import { HOME_NO_TRIP_PROPS } from '@/features/home/model/homeFixtures';
import { HomeScreen } from '@/features/home/screens/HomeScreen';

// 홈 탭 라우트 — 실물 HomeScreen을 그리는 얇은 래퍼(onboardingPrefRoutes 7-2 관례).
// 실착지 상태는 no-trip(게이트① G-1 결정) — 온보딩 완료 직후 실사용자는 여행 0이라
// 의미상 정직하다(가짜 부산 여행을 실화면에 두지 않음).
export default function HomeRoute() {
  return <HomeScreen {...HOME_NO_TRIP_PROPS} />;
}
