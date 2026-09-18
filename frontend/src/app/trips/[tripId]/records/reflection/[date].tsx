import { useLocalSearchParams } from 'expo-router';

import { DailyReflectionPage } from '@/pages/daily-reflection';

/**
 * j03 오늘의 회고 · 얇은 라우트 — 배선은 `pages/daily-reflection` 이 진다(`records/index.tsx` 선례).
 * params(`tripId`·`date`)는 여기서만 읽어 prop 으로 내린다. 탭 셸 교체 전이라 딥링크/캘린더(j07)
 * 경유로 도달한다. `(tabs)` 밖 파일시스템 라우트라 미인증 딥링크 노출 구조를 공유(데이터는 서버 401).
 */
export default function DailyReflectionRoute() {
  const { tripId, date } = useLocalSearchParams<{
    tripId: string;
    date: string;
  }>();

  return <DailyReflectionPage tripId={tripId} date={date} />;
}
