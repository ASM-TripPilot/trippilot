import { type ReactElement, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import type { StayRecommendView as StayRecommendViewModel } from '@/features/itinerary/model/stayRecommend';
import { LocationOffGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import { useAssignBase } from '@/features/trip/model/useTripBases';
import { useGetTripsTripId } from '@/shared/api/generated/trips/trips';
import { StateNotice } from '@/shared/ui/StateNotice';

import { StayRecommendView } from './StayRecommendView';

/**
 * TRIP-800 · h15 동선 기준 숙소 추천 배선. 화면은 이 중 어느 것도 모른다.
 *
 *  1. **추천 데이터는 밖에서 받는다**(`recommendations?`) — 실 추천 API 배선 전(TRIP-823)이라 라우트는
 *     이 prop 을 넘기지 않고, 통합 테스트만 넘긴다. 없거나 0건이면 가짜 추천 대신 정직한 안내 얼굴 +
 *     동작하는 탈출구(뒤로·숙소 둘러보기)를 그린다(INV-4). h14 거점 없음 카드가 이미 이 라우트로 온다.
 *  2. **선택은 여기서 쥔다** — 기본은 첫 카드.
 *  3. **거점 지정 = 여행 전체 기간**(`dateFrom`=시작, `dateTo`=종료 — 체크아웃 배타). 기간을 아직 못
 *     받았으면 요청을 만들 수 없어 CTA 를 잠그고, 당일치기(시작=종료)는 `dateTo > dateFrom` 위반이라
 *     사유를 보이고 잠근다.
 *  4. **성공하면 h14 로 복귀** — `canGoBack ? back : replace('/trips/{id}/itinerary')`(딥링크 폴백).
 *     실패는 화면 유지 + 인라인 안내 + 재시도.
 */

const ASSIGN_FAILED_NOTICE = '거점으로 지정하지 못했어요. 다시 시도해 주세요.';
const SAME_DAY_NOTICE = '당일 여행은 거점 숙소 없이 동선만 유지해요.';

export interface StayRecommendPageProps {
  tripId: string;
  /** 추천 뷰(테스트 주입 자리 — TRIP-823 배선 시 훅으로 바뀐다). 라우트는 넘기지 않는다. */
  recommendations?: StayRecommendViewModel;
}

export function StayRecommendPage({
  tripId,
  recommendations,
}: StayRecommendPageProps): ReactElement {
  const router = useRouter();
  const hasCandidates = (recommendations?.candidates.length ?? 0) > 0;
  // 추천이 없으면 지정할 일도 없어 기간을 조회하지 않는다.
  const trip = useGetTripsTripId(tripId, { query: { enabled: hasCandidates } });
  const assignBase = useAssignBase();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignFailed, setAssignFailed] = useState(false);
  // in-flight 잠금 — `isPending` 은 다음 렌더에야 반영돼 같은 틱 이중탭을 못 막는다(TripNewStep2 선례).
  // 성공은 화면을 떠나므로 잠근 채 두고, 실패만 풀어 재시도를 연다.
  const assignLockRef = useRef(false);

  function goBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/trips/${tripId}/itinerary`);
    }
  }

  function browseStays(): void {
    router.push('/stays');
  }

  if (recommendations === undefined || !hasCandidates) {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-canvas px-lg">
          <StateNotice
            testID="stay-recommend-empty"
            icon={<LocationOffGlyph />}
            title="지금은 동선 기준 추천을 보여 드릴 수 없어요"
            description="숙소를 직접 둘러보고 저장하면 거점으로 지정할 수 있어요."
            actions={[
              {
                testID: 'stay-recommend-empty-browse',
                label: '다른 숙소 둘러보기',
                variant: 'filled',
                onPress: browseStays,
              },
              {
                testID: 'stay-recommend-empty-back',
                label: '돌아가기',
                variant: 'outline',
                onPress: goBack,
              },
            ]}
          />
        </View>
      </SafeAreaView>
    );
  }

  const { candidates } = recommendations;
  const selected =
    candidates.find((candidate) => candidate.savedStayId === selectedId) ??
    candidates[0];
  const startDate = trip.data?.startDate;
  const endDate = trip.data?.endDate;
  const sameDay = startDate !== undefined && startDate === endDate;

  function handleConfirm(): void {
    if (
      assignLockRef.current ||
      startDate === undefined ||
      endDate === undefined ||
      sameDay
    ) {
      return;
    }
    assignLockRef.current = true;
    setAssignFailed(false);
    assignBase.mutate(
      {
        tripId,
        data: {
          savedStayId: selected.savedStayId,
          dateFrom: startDate,
          dateTo: endDate,
        },
      },
      {
        onSuccess: goBack,
        onError: () => {
          assignLockRef.current = false;
          setAssignFailed(true);
        },
      }
    );
  }

  let notice: string | null = null;
  if (assignFailed) notice = ASSIGN_FAILED_NOTICE;
  else if (sameDay) notice = SAME_DAY_NOTICE;

  return (
    <StayRecommendView
      view={recommendations}
      selectedId={selected.savedStayId}
      onSelect={setSelectedId}
      onConfirm={handleConfirm}
      onBrowseOther={browseStays}
      onBack={goBack}
      confirmDisabled={endDate === undefined || sameDay || assignBase.isPending}
      notice={notice}
    />
  );
}
