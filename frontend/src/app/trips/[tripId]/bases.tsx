import { useLocalSearchParams } from 'expo-router';

import { TripBasesPage } from '@/pages/trip-new-step2';

/** 여행 단위 거점 화면(TRIP-1011 C) — 얇은 라우트, 배선은 `pages/trip-new-step2`가 진다
 * (`itinerary/method.tsx` 선례). params 는 여기서만 읽어 prop 으로 내린다.
 * TRIP-1082 — 입구가 둘이다: l04 '출발점 변경'은 `mode=edit`(거점 편집 얼굴), h04 '거점 숙소 다시
 * 고르기'는 mode 없이 온다. 정확히 'edit' 일 때만 내린다(다른 값에 편집 얼굴이 새면 h04 가 생성 CTA 를 잃는다). */
export default function TripBasesRoute() {
  const { tripId, mode } = useLocalSearchParams<{
    tripId: string;
    mode?: string;
  }>();

  return (
    <TripBasesPage
      tripId={tripId}
      mode={mode === 'edit' ? 'edit' : undefined}
    />
  );
}
