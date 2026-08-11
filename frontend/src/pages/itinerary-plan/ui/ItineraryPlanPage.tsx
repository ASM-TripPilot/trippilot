import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import {
  buildPlanDayTabs,
  formatConfirmedDateRange,
  formatNightsLabel,
  resolvePlanState,
} from '@/features/itinerary/model/planState';
import {
  AlertCircleGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import {
  TimelineScreen,
  type ViewSegmentValue,
} from '@/features/itinerary/ui/TimelineScreen';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItineraryConfirm,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice } from '@/shared/ui/StateNotice';

/**
 * h25 완성 일정 배선(TRIP-299) — 두 조회를 잇고, 뷰 세그먼트를 **페이지 로컬 UI 상태**로 든다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **헤더는 두 조회의 조립이다** — 제목·기간은 `GET /trips`, 곳 수는 `GET /itinerary` 슬롯 합계.
 *  2. **404 는 전면 실패가 아니라 별도 얼굴이다** — "일정이 아직 없다"(`isNotFound`)를 `notFound`
 *     로 갈라 `resolvePlanState` 의 우선순위가 실패 겹침을 정리한다(INV-4).
 *  3. **세그먼트 전환은 재조회를 유발하지 않는다** — 뷰는 `useState` 라 쿼리 키가 그대로고, 캐시된
 *     쿼리는 리렌더에 다시 나가지 않는다(AC6). Zustand 는 pages 층 금지라 로컬 상태로 든다.
 */

function PlanFace({
  testID,
  icon,
  title,
  description,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  description: string;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 items-center justify-center bg-canvas px-lg">
        <StateNotice
          testID={testID}
          icon={icon as ReactElement}
          title={title}
          description={description}
          actions={[]}
        />
      </View>
    </SafeAreaView>
  );
}

/** 확정 실패 인라인 안내(INV-4 침묵 금지). 409 세 원인·404 를 상태코드로 구별 못 하므로 문구는
 * 원인 단정 없이 재시도를 안내한다 — 정확한 문구는 심판이 아니라 비-공백만 잠근다(02a §8). */
const CONFIRM_ERROR_NOTE =
  '일정을 확정하지 못했어요. 잠시 후 다시 시도해 주세요';

export function ItineraryPlanPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<ViewSegmentValue>('timeline');
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const trip = useGetTripsTripId(tripId);
  const itinerary = useGetTripsTripIdItinerary(tripId);
  // TError=unknown 으로 열어 onError 의 error 를 axios 판정(isNotFound)에 그대로 태운다.
  const confirm = usePostTripsTripIdItineraryConfirm<unknown>();

  function handleConfirm(): void {
    setConfirmError(null);
    confirm.mutate(
      { tripId },
      {
        onSuccess: (data) => {
          // 응답이 곧 최신 Itinerary(CONFIRMED)라 조회 캐시에 직접 써넣는다 — 재조회 0회로
          // 읽기전용으로 전환된다. resetQueries/removeQueries 는 data 까지 버려 금지(02a ★3).
          queryClient.setQueryData(
            getGetTripsTripIdItineraryQueryKey(tripId),
            data
          );
        },
        onError: (error) => {
          setConfirmError(CONFIRM_ERROR_NOTE);
          // 404 는 되돌아갈 서버 상태가 없어 재조회하지 않는다. 그 밖(409 등)은 서버 진실이
          // 이미 확정일 수 있어 무효화로 재조회해 정합한다(무효화만 — data 는 보존).
          if (!isNotFound(error)) {
            void queryClient.invalidateQueries({
              queryKey: getGetTripsTripIdItineraryQueryKey(tripId),
            });
          }
        },
      }
    );
  }

  const days = itinerary.data?.days ?? [];
  const state = resolvePlanState({
    loading: trip.isPending || itinerary.isPending,
    notFound: isNotFound(itinerary.error),
    failed: trip.isError || itinerary.isError,
    days,
  });

  if (state.kind === 'loading') {
    return (
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <View className="flex-1 bg-canvas" />
      </SafeAreaView>
    );
  }

  if (state.kind === 'notFound') {
    return (
      <PlanFace
        testID="itinerary-view-notfound"
        icon={<InfoCircleGlyph size={32} tone="primaryText" />}
        title="아직 완성된 일정이 없어요"
        description="일정을 만들면 여기에서 볼 수 있어요"
      />
    );
  }

  if (state.kind === 'failed') {
    return (
      <PlanFace
        testID="itinerary-view-failed"
        icon={<AlertCircleGlyph size={32} tone="primaryText" />}
        title="일정을 불러오지 못했어요"
        description="네트워크를 확인하고 다시 시도해주세요"
      />
    );
  }

  const totalPlaces = state.days.reduce(
    (sum, day) => sum + day.slots.length,
    0
  );
  const header = {
    title: trip.data?.title ?? '',
    nightsLabel: formatNightsLabel(
      trip.data?.startDate ?? '',
      trip.data?.endDate ?? ''
    ),
    totalPlaces,
  };

  // 확정 배너 부제 = `{날짜범위} · {여행 제목} · {총 N}곳`. 헤더가 이미 페이지 조립인 리포 패턴과
  // 동형 — 화면은 이 완성 문자열만 받는다. N 은 전 일자 슬롯 합(totalPlaces).
  const confirmedSubtitle = `${formatConfirmedDateRange(
    trip.data?.startDate ?? '',
    trip.data?.endDate ?? ''
  )} · ${trip.data?.title ?? ''} · ${totalPlaces}곳`;

  return (
    <TimelineScreen
      header={header}
      days={buildPlanDayTabs(state.days)}
      slots={state.days[activeDayIndex]?.slots ?? []}
      activeDayIndex={activeDayIndex}
      segment={segment}
      status={itinerary.data?.status}
      confirmedSubtitle={confirmedSubtitle}
      confirmError={confirmError}
      onConfirm={handleConfirm}
      onSelectDay={setActiveDayIndex}
      onSegmentChange={setSegment}
      onBack={() => router.back()}
    />
  );
}
