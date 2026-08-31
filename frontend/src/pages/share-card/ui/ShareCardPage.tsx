import type { ReactElement } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import {
  SHARE_FORMATS,
  buildShareCard,
} from '@/features/reflection/model/shareCard';
import { useTripSummary } from '@/features/reflection/model/useTripSummary';
import { ShareCardScreen } from '@/features/reflection/ui/ShareCardScreen';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-574 · share-card 페이지 — j06 공유 카드 조회·조립·배선의 단일 출처(FSD).
 *
 * 두 소스를 잇는 유일한 자리: `useTripSummary`(통계·동선)와 `useGetTripsTripId`(제목·기간·지역)를
 * `buildShareCard` 에 통과시켜 완성 VM 을 만들고 `ShareCardScreen`(무상태)에 넘긴다. 화면은 조립 함수
 * 어느 것도 직접 참조하지 않는다(구조 가드 G3 이 소스로 강제).
 *
 * ⚠️ 온디바이스 렌더(BR-U5-46): 서버 이미지 생성·저장 심볼 0 — 캡처/저장/공유는 화면 로컬 degrade
 * (captureShareImage armed:false). 페이지 조립 로직은 `TripSummaryPage`(j04)·`DailyReflectionPage`(j03)
 * 와 동형으로 jest 무심판 — 6-b 실기·프리뷰가 유일한 그물(자율/야간이라 이번엔 SKIP).
 */

export interface ShareCardPageProps {
  tripId: string;
}

const PENDING_ILLUSTRATION = (
  <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
);

export function ShareCardPage({ tripId }: ShareCardPageProps): ReactElement {
  const summary = useTripSummary(tripId);
  const trip = useGetTripsTripId(tripId);

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  if (summary.isPending || trip.isPending) {
    return (
      <StateNotice
        testID="reflection-share-pending"
        illustration={PENDING_ILLUSTRATION}
        title="공유 카드를 준비하고 있어요"
        description="잠시만 기다려 주세요"
        actions={[]}
      />
    );
  }

  const card = buildShareCard({
    summary: summary.summary,
    trip: trip.data,
    format: SHARE_FORMATS[0],
  });

  // 캡션·해시태그는 온디바이스 편집만(서버 저장 없음, §7) — 여행 제목·지역으로 시드한다.
  const caption = trip.data ? `${trip.data.title} 여행의 기록` : '';
  const hashtagText = (trip.data?.destinations ?? [])
    .map((dest) => `#${dest.region}여행`)
    .join(' ');

  return (
    <ShareCardScreen
      card={card}
      formats={SHARE_FORMATS}
      caption={caption}
      hashtagText={hashtagText}
      onBack={handleBack}
    />
  );
}
