import type { ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  buildMustVisitPins,
  joinMustVisits,
  resolveMustVisitListView,
} from '@/features/itinerary/model/mustVisitList';
import { MustVisitPickerScreen } from '@/features/itinerary/ui/MustVisitPickerScreen';
import type { GenerateItineraryRequestGenerationMode } from '@/shared/api/generated/schemas';
import {
  getGetTripsTripIdMustVisitsQueryKey,
  useDeleteTripsTripIdMustVisitsMustVisitId,
  useGetTripsTripIdMustVisits,
} from '@/shared/api/generated/trips/trips';
import { getAccessToken } from '@/shared/api/tokenManager';

/**
 * h05 배선 — 두 조회를 잇고, 좌표를 지도 핀으로 만들고, 해제를 보내고, h07·h09 로 보낸다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **두 feature 를 잇는 자리다.** 등록 건은 `shared/api` 생성 훅에서, 이름·사진·**좌표**는
 *     `features/explore` 의 담기 훅에서 온다. 화면(`features/itinerary`)이 후자를 직접 부르면
 *     features 간 import 라 리포 관례 위반이다(`TripNewStep1Page` 선례).
 *  2. **게스트 접기** — `useSavedPlaces` 는 `enabled: isAuthed` 라 미로그인이면 요청이 안 나가고
 *     `isPending` 이 **영원히 true** 다. 그대로 얼굴 판정에 태우면 끝나지 않는 자리표시가 뜬다.
 *  3. **실패는 얼굴을 갈아 끼우지 않는다** — 이미 도착한 목록이 있으면 실패는 `staleFailed` 로
 *     model 에 실려 나간다(문제로그 2026-08-04). h02 화면은 그 안내를 안 그리지만(TRIP-785),
 *     model 은 유지돼 h03 이 소비한다.
 *  4. 해제는 `must_visit` 만 지운다 — 담기(`saved-places`)는 건드리지 않는다(INV-U1-04 ·
 *     BR-U1-04 양방향 독립). 사용자가 탐색 화면의 ♥ 까지 잃으면 되돌릴 방법이 없다.
 */

export function MustVisitListPage({
  tripId,
  mode,
}: {
  tripId: string;
  /** copick 갈래 신호(TRIP-504). undefined=완전AI(기존 동작 불변, 후방호환 additive).
   * CO_PLAN 이면 다음/건너뛰기가 CO_PLAN generating + 첫 슬롯 successRoute 로 잇는다(AC-5). */
  mode?: GenerateItineraryRequestGenerationMode;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();

  const isAuthed = getAccessToken() !== null;
  const mustVisits = useGetTripsTripIdMustVisits(tripId);
  const savedPlaces = useSavedPlaces({ isAuthed });
  const removeMustVisit = useDeleteTripsTripIdMustVisitsMustVisitId();

  const savedPlacesLoading = isAuthed && savedPlaces.isPending;

  const items = joinMustVisits({
    mustVisits: mustVisits.data ?? [],
    savedPlaces: savedPlaces.savedPlaces,
  });
  const view = resolveMustVisitListView({
    items,
    loading: mustVisits.isPending || savedPlacesLoading,
    // 해제 실패도 여기로 온다 — 실패하면 목록은 그대로인데 화면은 아무 말도 안 하게 된다
    // (BR-U1-55 침묵 실패 금지). 재시도(재조회)가 서버 진실을 다시 그려 준다.
    failed:
      mustVisits.isError || savedPlaces.isError || removeMustVisit.isError,
  });

  function invalidateMustVisits(): void {
    void queryClient.invalidateQueries({
      queryKey: getGetTripsTripIdMustVisitsQueryKey(tripId),
    });
  }

  function handleRemove(input: { mustVisitId: string }): void {
    removeMustVisit.mutate(
      { tripId, mustVisitId: input.mustVisitId },
      { onSuccess: invalidateMustVisits }
    );
  }

  function handleRetry(): void {
    // 실패 표시를 만든 **세 축을 전부** 걷는다. 뮤테이션 실패를 그대로 두면 재조회가 성공해도
    // 알림이 남고, 담은 장소 쪽이 실패했는데 must-visits 만 다시 부르면 몇 번을 눌러도 이름이
    // 돌아오지 않는다. 실패한 축만 다시 부른다 — 게스트는 그 쿼리가 아예 안 도는 축이다.
    removeMustVisit.reset();
    void mustVisits.refetch();
    if (savedPlaces.isError) void savedPlaces.refetch();
  }

  // 다음/건너뛰기는 둘 다 h09(생성 중)로 간다. copick 갈래(mode=CO_PLAN)면 h04 에서 실려 온 신호를
  // 그대로 h09 로 넘기고, successRoute 를 **첫 슬롯 경로 템플릿**으로 싣는다(01b Q3·AC-5). h05 시점엔
  // slotKey 를 아직 모르므로 `[slotKey]` 세그먼트가 든 템플릿이고, h09 가 생성 후 실 slotKey 를
  // 채운다(GeneratingPage). 완전AI 갈래(mode 없음)는 기존 FULLY_AI generating 그대로다(무회귀).
  function goToGenerating(): void {
    if (mode === 'CO_PLAN') {
      router.push({
        pathname: '/trips/[tripId]/itinerary/generating',
        params: {
          tripId,
          mode: 'CO_PLAN',
          successRoute: '/trips/[tripId]/itinerary/copick/[slotKey]',
        },
      });
      return;
    }
    router.push({
      pathname: '/trips/[tripId]/itinerary/generating',
      params: { tripId },
    });
  }

  return (
    <MustVisitPickerScreen
      view={view}
      pins={buildMustVisitPins({
        items,
        savedPlaces: savedPlaces.savedPlaces,
      })}
      onBack={() => router.back()}
      // 다음/건너뛰기 둘 다 h09(생성 중)로 잇는다(TRIP-454 AC-2 · TRIP-504 AC-5). copick 갈래면
      // CO_PLAN 신호+첫 슬롯 successRoute 를 싣는다(위 `goToGenerating`). 화면 계약은 무수정.
      onProceed={goToGenerating}
      onSkip={goToGenerating}
      onPressItem={(sourcePoiId) =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/must-visits/[poiId]',
          params: { tripId, poiId: sourcePoiId },
        })
      }
      onRemove={handleRemove}
      onRetry={handleRetry}
    />
  );
}
