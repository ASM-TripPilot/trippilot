import type { ReactElement } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { summaryStats } from '@/features/reflection/model/summaryStats';
import {
  daySubtitle,
  distanceSourceLabel,
  resolveSummaryView,
  shareEnabled,
  toOrderedVisitList,
} from '@/features/reflection/model/summaryView';
import { useTripSummary } from '@/features/reflection/model/useTripSummary';
import {
  TripSummaryScreen,
  type DayCardVM,
} from '@/features/reflection/ui/TripSummaryScreen';
import { formatKoreanDate } from '@/shared/date/formatKoreanDate';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-572 · trip-summary 페이지 — j04 요약 조회·조립·배선의 단일 출처(FSD).
 *
 * 화면(`TripSummaryScreen`)은 무상태라, 조회한 `TripSummaryEnvelope` 를 순수 모델
 * (summaryStats·resolveSummaryView·toOrderedVisitList·distanceSourceLabel·daySubtitle·shareEnabled)
 * 에 통과시켜 완성 VM 을 만드는 **유일한 자리**. 화면은 이 함수 중 무엇도 직접 참조하지 않는다.
 *
 * 얼굴: `isError` → 안내(다시 시도) · `!ready \| 조회 중 \| 요약 없음` → "요약 준비 중" 안내(공유 버튼
 * 자체가 없어 BR-U5-48 을 흡수) · 그 외 → 요약 화면. 진짜 생성실패는 별도 상태가 아니라 `ready` 게이트로
 * 흡수한다(ready 만이 유일 신호, 01b 결정3).
 *
 * ⚠️ 계약 공백: `DayHighlight` 에 좌표가 없어 지도 좌표(`mapCenter`/`mapPins`)를 못 넘긴다 — 화면은
 * 늘 "지도 준비 중" 자리표시로 접힌다(가짜 기본 센터 지도 금지, 571 경고-2 동형). 실 좌표 배선은 계약
 * 확장 후속 티켓. 페이지 조립 로직(얼굴 판정·VM 조립·배선)은 `DailyReflectionPage`(j03)와 동형으로
 * jest 무심판이다 — 6-b 실기가 유일한 그물(자율/야간이라 이번엔 SKIP).
 */

export interface TripSummaryPageProps {
  tripId: string;
}

const PENDING_ILLUSTRATION = (
  <View className="h-[72px] w-[72px] rounded-full bg-surface-soft" />
);

export function TripSummaryPage({
  tripId,
}: TripSummaryPageProps): ReactElement {
  const summary = useTripSummary(tripId);
  const envelope = summary.envelope;
  const data = summary.summary;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  if (summary.isError) {
    return (
      <StateNotice
        testID="reflection-summary-error"
        illustration={PENDING_ILLUSTRATION}
        title="요약을 불러오지 못했어요"
        description="잠시 후 다시 시도해 주세요"
        actions={[
          {
            testID: 'reflection-summary-retry',
            label: '다시 시도',
            variant: 'filled',
            onPress: () => {
              summary.refetch();
            },
          },
        ]}
      />
    );
  }

  // 종료·요약 전(ready:false)·조회 중·요약 없음 — 요약 화면을 그리지 않아 공유 진입점 자체가 없다.
  // stats·highlights 결측(계약 위반 응답)도 여기로 접는다 — 아래 조립이 data.stats/highlights 를
  // 무방비로 건드려 크래시하던 반쪽 방어를 단일 지점으로 봉합(5-b 경고-1, 571 경고-1 동형).
  if (
    summary.isPending ||
    envelope?.ready !== true ||
    !data ||
    !data.stats ||
    !data.highlights
  ) {
    return (
      <StateNotice
        testID="reflection-summary-pending"
        illustration={PENDING_ILLUSTRATION}
        title="여행 요약을 준비하고 있어요"
        description="여행이 끝나면 자동으로 요약을 만들어 드려요"
        actions={[]}
      />
    );
  }

  const stats = summaryStats(data.stats);
  const dayCards: DayCardVM[] = data.highlights.map((highlight) => ({
    key: highlight.date,
    dateLabel: formatKoreanDate(highlight.date),
    countLabel: `Day${highlight.dayOrder} · ${highlight.visitCount}곳`,
    subtitle: daySubtitle(highlight.places),
  }));

  return (
    <TripSummaryScreen
      stats={stats}
      distanceSourceLabel={distanceSourceLabel(data.stats.distanceSource)}
      view={resolveSummaryView(data.stats)}
      dayCards={dayCards}
      orderedVisits={toOrderedVisitList(data.highlights)}
      shareEnabled={shareEnabled(envelope)}
      onShare={() => {
        // 공유 진입점(BR-U5-48) — 공유 시트/딥링크 배선은 후속 티켓(범위 밖).
      }}
      onBack={handleBack}
    />
  );
}
