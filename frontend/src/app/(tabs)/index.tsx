import { HOME_NO_TRIP_PROPS } from '@/features/home/model/homeFixtures';
import { HomeScreen } from '@/features/home/ui/HomeScreen';

// 홈 탭 라우트 — 실물 HomeScreen을 그리는 얇은 래퍼(onboardingPrefRoutes 7-2 관례).
// 신 프레임(TRIP-316)의 발견·영감 피드는 여행 유무와 무관하므로(가정 B) no-trip·default가
// 렌더가 동일하다 — no-trip 픽스처를 쓰는 것은 온램프 노출을 명시하는 중립적 선택이다.
export default function HomeRoute() {
  return <HomeScreen {...HOME_NO_TRIP_PROPS} />;
}
