import { type ReactElement, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { goBackOr } from '@/shared/lib/goBackOr';

import type { StayRecommendView as StayRecommendViewModel } from '../model/stayRecommend';
import { ItineraryLocationOffGlyph } from '@/features/itinerary';
import { useAssignBase } from '@/features/assign-trip-base';
import { useGetTripsTripId } from '@/shared/api/index.hooks';
import { SAVED_LIST_LOAD_FAILED_TOAST } from '@/shared/ui/savedListLoadToast';
import { StateNotice } from '@/shared/ui/StateNotice';
import { showToast } from '@/shared/ui/Toast';
import { usePressLock } from '@/shared/lib/pressGuard';
import {
  CuratedStaysSection,
  CuratedStaysSheet,
  useCuratedStaysController,
} from '@/widgets/curated-stays';

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
 *  5. **추천이 비면 인기 숙소**(TRIP-1582, Figma 5066:4325) — 이 여행 첫 목적지(regionCode 가 있으면 코드, 없으면
 *     이름을 city 로)의 인기 숙소를 묻는다. 오면 안내 문구를 바꿔 줄 + 「Trip.com에서 전체 숙소 보기」를, 없으면
 *     지금 안내 그대로 + 전체 보기만 보인다. 여행 기간·인원을 아웃바운드 맥락으로 싣는다. 시트는 화면 루트 형제.
 */

const ASSIGN_FAILED_NOTICE = '거점으로 지정하지 못했어요. 다시 시도해 주세요.';
const SAME_DAY_NOTICE = '당일 여행은 거점 숙소 없이 동선만 유지해요.';
/** 여행 조회가 실패해 기간을 모른다(TRIP-1749 결정 3) — 꺼진 CTA 만 남기지 않고 이유를 말한다(INV-4). */
const TRIP_FAILED_NOTICE =
  '여행 기간을 불러오지 못했어요. 돌아가서 다시 열어 주세요.';
const CURATED_NOTICE =
  '이번 동선 기준 추천은 아직 없어요 · 대신 인기 숙소를 보여 드려요';

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
  // 추천이 있으면 거점 지정 기간, 없으면 인기 숙소 지역·여행 맥락에 쓴다(TRIP-1582).
  const trip = useGetTripsTripId(tripId);
  // 추천이 있는 얼굴은 인기 숙소를 묻지 않는다(지역을 안 넘기면 조회 0).
  const destination = hasCandidates
    ? undefined
    : [...(trip.data?.destinations ?? [])].sort((a, b) => a.seq - b.seq)[0];
  const curated = useCuratedStaysController({
    regionCode: destination?.regionCode ?? undefined,
    city: destination?.regionCode ? undefined : destination?.region,
    regionName: destination?.region,
    trip: trip.data && {
      checkin: trip.data.startDate,
      checkout: trip.data.endDate,
      adults: trip.data.party,
    },
    variant: 'sheet',
    testIDPrefix: 'stay-recommend-curated',
  });
  const assignBase = useAssignBase();

  // TRIP-1754 — 인기 숙소 하트가 그려지는 얼굴(추천 없음 + 줄 있음 — 추천이 있으면 curated.hidden 이 이미 true)에서만, 저장 목록 확정 실패가 켜지는 순간 토스트 1회.
  // 조기 return 보다 앞(Rules of Hooks).
  const heartsShown = !curated.hidden;
  const savedListFailed = heartsShown && curated.savedListFailureConfirmed;
  useEffect(() => {
    if (savedListFailed) showToast(SAVED_LIST_LOAD_FAILED_TOAST);
  }, [savedListFailed]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignFailed, setAssignFailed] = useState(false);
  // in-flight 잠금 — `isPending` 은 다음 렌더에야 반영돼 같은 틱 이중탭을 못 막는다(TripNewStep2 선례).
  // 성공은 화면을 떠나므로 잠근 채 두고, 실패만 풀어 재시도를 연다.
  const assignLock = usePressLock();

  function goBack(): void {
    goBackOr(router, `/trips/${tripId}/itinerary`);
  }

  function browseStays(): void {
    router.push('/stays');
  }

  if (recommendations === undefined || !hasCandidates) {
    return (
      <>
        <SafeAreaView
          edges={['top', 'bottom']}
          style={{ flex: 1 }}
          className="bg-canvas"
        >
          {curated.hidden ? (
            <>
              <View className="flex-1 items-center justify-center bg-canvas px-lg">
                <StateNotice
                  testID="stay-recommend-empty"
                  icon={<ItineraryLocationOffGlyph />}
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
              {/* 인기 숙소가 없어도(조회 중·실패·빈 목록) Trip.com 전체 보기는 남는다(TRIP-1582). */}
              <View className="pb-lg">
                <CuratedStaysSection controller={curated} />
              </View>
            </>
          ) : (
            // 인기 숙소 얼굴(Figma 5066:4325) — 제목 · 안내 · 줄 · 전체 보기. 탈출구(돌아가기)는 그대로 남긴다.
            <View className="flex-1 justify-center gap-md bg-canvas">
              <View className="gap-xs px-lg">
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  인기 숙소
                </Text>
                <Text
                  testID="stay-recommend-curated-notice"
                  className="font-noto text-label text-muted"
                >
                  {CURATED_NOTICE}
                </Text>
              </View>
              <CuratedStaysSection controller={curated} />
              <View className="px-lg">
                <Pressable
                  testID="stay-recommend-empty-back"
                  accessibilityRole="button"
                  onPress={goBack}
                  className="h-[50px] w-full items-center justify-center rounded-button border border-hairline-strong bg-canvas"
                >
                  <Text className="font-noto-bold text-card-title font-bold text-ink">
                    돌아가기
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </SafeAreaView>
        <CuratedStaysSheet controller={curated} />
      </>
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
      startDate === undefined ||
      endDate === undefined ||
      sameDay ||
      !assignLock.acquire()
    ) {
      return;
    }
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
          assignLock.release();
          setAssignFailed(true);
        },
      }
    );
  }

  let notice: string | null = null;
  if (assignFailed) notice = ASSIGN_FAILED_NOTICE;
  // 기간을 이미 받았으면 재조회 실패는 안내하지 않는다 — [확정]은 켜져 있다(03b 경고-2).
  else if (trip.isError && endDate === undefined) notice = TRIP_FAILED_NOTICE;
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
