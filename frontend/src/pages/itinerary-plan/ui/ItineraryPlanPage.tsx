import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
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
  BackChevronGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';
import { TimelineScreen } from '@/features/itinerary/ui/TimelineScreen';
import {
  getGetTripsTripIdItineraryQueryKey,
  useGetTripsTripId,
  useGetTripsTripIdItinerary,
  usePostTripsTripIdItineraryConfirm,
} from '@/shared/api/generated/trips/trips';
import { isNotFound } from '@/shared/api/isNotFound';
import { StateNotice, type StateNoticeAction } from '@/shared/ui/StateNotice';

/**
 * h25/h34 완성·확정 일정 배선(TRIP-299·300·354) — 두 조회를 잇는다. 시간표/지도 세그먼트
 * 토글은 제거됐다(TRIP-354 결정 D · 지도 상시 인라인) — 뷰 로컬 상태는 활성 날짜 하나뿐이다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **헤더는 두 조회의 조립이다** — 제목·기간은 `GET /trips`, 곳 수는 `GET /itinerary` 슬롯 합계.
 *  2. **404 는 전면 실패가 아니라 별도 얼굴이다** — "일정이 아직 없다"(`isNotFound`)를 `notFound`
 *     로 갈라 `resolvePlanState` 의 우선순위가 실패 겹침을 정리한다(INV-4).
 *  3. **날짜 전환은 재조회를 유발하지 않는다** — 활성 날은 `useState` 라 쿼리 키가 그대로고, 캐시된
 *     쿼리는 리렌더에 다시 나가지 않는다. Zustand 는 pages 층 금지라 로컬 상태로 든다.
 *  4. **탈출구는 4얼굴 전부에 있다**(TRIP-402) — loading·notFound·failed·listed 어디에 착지해도
 *     `handleBack` 을 공유하는 뒤로가기가 있고, 뒤로 갈 히스토리가 없으면(딥링크로 직접 진입)
 *     조용히 무동작하지 않고 홈(`/(tabs)`)으로 간다(침묵 no-op 금지 · INV-4). 빈 얼굴(notFound)은
 *     나갈 길 대신 "일정 만들기" 다음 행동도 준다.
 */

/** 딥링크로 뒤로 갈 히스토리 없이 열렸을 때의 홈 폴백 목적지. `/(tabs)/itinerary` 는 `trips[0]`
 * 로 다시 리다이렉트해 딥링크로 들어온 여행이 아닌 옛 일정에 착지하므로 쓰지 않는다(홈 탭). */
const HOME_FALLBACK = '/(tabs)';

/** 탈출구 앱바 — loading·notFound·failed 얼굴 위에 얹는 뒤로가기 한 줄. `TimelineScreen`(listed)
 * 앱바와 같은 형태·같은 `itinerary-view-back` testID 를 쓴다 — 얼굴은 상호 배타라 한 번에 하나만
 * 렌더돼 testID 가 안 겹친다. */
function PlanAppBar({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-sm pl-md pr-lg pt-lg">
      <Pressable
        testID="itinerary-view-back"
        accessibilityRole="button"
        accessibilityLabel="뒤로"
        onPress={onBack}
        hitSlop={8}
      >
        <BackChevronGlyph />
      </Pressable>
    </View>
  );
}

function PlanFace({
  testID,
  icon,
  title,
  description,
  actions,
  onBack,
}: {
  testID: string;
  icon: ReactNode;
  title: string;
  description: string;
  actions: StateNoticeAction[];
  onBack: () => void;
}): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <PlanAppBar onBack={onBack} />
        <View className="flex-1 items-center justify-center px-lg">
          <StateNotice
            testID={testID}
            icon={icon as ReactElement}
            title={title}
            description={description}
            actions={actions}
          />
        </View>
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
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 4얼굴 공통 뒤로가기. `router.canGoBack()` 은 expo-router 가 주는, 뒤로 갈 히스토리 유무를
  // boolean 으로 답하는 함수다 — 있으면 이전 화면으로, 없으면(딥링크로 직접 진입) 조용히
  // 무동작하지 않고 홈으로 `replace`(현재 화면을 히스토리에 안 남김) 한다(침묵 no-op 금지 · INV-4).
  function handleBack(): void {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(HOME_FALLBACK);
    }
  }

  // 빈 얼굴(notFound)의 "일정 만들기" 다음 행동 — 방식 선택(h04)으로 push. 리포 동적 라우트 push
  // 관용구(객체 1인자, DraftPage·MethodPage 선례)로 tripId 를 경로 파라미터에 싣는다.
  function goCreate(): void {
    router.push({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId },
    });
  }

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
        <View className="flex-1 bg-canvas">
          <PlanAppBar onBack={handleBack} />
        </View>
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
        onBack={handleBack}
        actions={[
          {
            testID: 'itinerary-plan-create-cta',
            label: '일정 만들기',
            variant: 'filled',
            onPress: goCreate,
          },
        ]}
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
        onBack={handleBack}
        actions={[]}
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
      status={itinerary.data?.status}
      confirmedSubtitle={confirmedSubtitle}
      confirmError={confirmError}
      onConfirm={handleConfirm}
      onSelectDay={setActiveDayIndex}
      onBack={handleBack}
    />
  );
}
