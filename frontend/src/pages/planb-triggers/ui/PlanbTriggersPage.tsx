import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { foldScope } from '@/features/planb/model/foldScope';
import { triggerWatchlist } from '@/features/planb/model/triggerWatchlist';
import { useTriggerWatchlist } from '@/features/planb/model/useTriggerWatchlist';
import { TriggerWatchlistScreen } from '@/features/planb/ui/TriggerWatchlistScreen';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * TRIP-562 · planb-triggers 배선(pages) — i09 감시 목록. `useTriggerWatchlist`(조회) →
 * `triggerWatchlist` 사영 1회(3항목 접기·배너 선택) → `TriggerWatchlistScreen`. 두 CTA·헤더 뒤로가기를
 * **라우팅으로만** 잇는다(쓰기 0, BR-U4-09 — 트리거는 제안까지만).
 *
 * 활성 CTA: `router.push('/trips/{id}/planb?scope=foldScope(scope)&triggerId=..')`(재계획 세션 진입,
 * `LiveItineraryPage.openReplan` 선례 동형). 수동 CTA: `router.push('/trips/{id}/planb')`(triggerId 없이,
 * BR-U4-10 — i10 미착수라 경로만).
 *
 * 로딩/오류는 `StateNotice` 재사용. **오류 시 3행을 '정상'으로 지어내지 않는다**(honest rendering —
 * '정상'은 건강검사 성공 주장이라 조회 실패에 붙이면 거짓). 발화 0(200+빈배열)은 성공이라 3행 전부
 * 정상·배너 부재로 정상 렌더한다.
 */

const NEUTRAL_BADGE = (
  <View className="h-[72px] w-[72px] rounded-pill bg-surface-strong" />
);

export interface PlanbTriggersPageProps {
  tripId: string;
}

export function PlanbTriggersPage({
  tripId,
}: PlanbTriggersPageProps): ReactElement {
  const query = useTriggerWatchlist(tripId);

  if (query.isPending) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View
          testID="planb-triggers-loading"
          className="flex-1 bg-canvas-alt"
        />
      </SafeAreaView>
    );
  }

  if (query.isError) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="planb-triggers-error"
            illustration={NEUTRAL_BADGE}
            title="감지 정보를 불러오지 못했어요"
            description="네트워크를 확인하고 다시 시도해주세요"
            actions={[]}
          />
        </View>
      </SafeAreaView>
    );
  }

  const { activeBanner, rows } = triggerWatchlist(query.data?.triggers ?? []);

  return (
    <TriggerWatchlistScreen
      activeBanner={activeBanner}
      rows={rows}
      onPressAlternative={() => {
        if (!activeBanner) return;
        router.push(
          `/trips/${tripId}/planb?scope=${foldScope(activeBanner.scope)}&triggerId=${activeBanner.triggerId}`
        );
      }}
      onPressManual={() => router.push(`/trips/${tripId}/planb`)}
      onBack={() => router.back()}
    />
  );
}
