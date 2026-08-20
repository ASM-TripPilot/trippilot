import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import {
  buildMustVisitPins,
  joinMustVisits,
  resolveMustVisitListView,
} from '@/features/itinerary/model/mustVisitList';
import { MustVisitPickerScreen } from '@/features/itinerary/ui/MustVisitPickerScreen';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import type { AddMustVisitRequest } from '@/shared/api/generated/schemas';
import {
  deleteTripsTripIdMustVisitsMustVisitId,
  getGetTripsTripIdMustVisitsQueryKey,
  postTripsTripIdMustVisits,
  useDeleteTripsTripIdMustVisitsMustVisitId,
  useGetTripsTripIdMustVisits,
} from '@/shared/api/generated/trips/trips';
import { getAccessToken } from '@/shared/api/tokenManager';

/**
 * h05 배선 — 두 조회를 잇고, 좌표를 지도 핀으로 만들고, 해제·강등을 보내고, h07 로 보낸다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다:
 *  1. **두 feature 를 잇는 자리다.** 등록 건은 `shared/api` 생성 훅에서, 이름·사진·**좌표**는
 *     `features/explore` 의 담기 훅에서 온다. 화면(`features/itinerary`)이 후자를 직접 부르면
 *     features 간 import 라 리포 관례 위반이다(`TripNewStep1Page` 선례).
 *  2. **게스트 접기** — `useSavedPlaces` 는 `enabled: isAuthed` 라 미로그인이면 요청이 안 나가고
 *     `isPending` 이 **영원히 true** 다. 그대로 얼굴 판정에 태우면 끝나지 않는 자리표시가 뜬다.
 *  3. **실패는 얼굴을 갈아 끼우지 않는다** — 이미 도착한 목록이 있으면 실패는 `staleFailed` 로
 *     곁에 붙는다(문제로그 2026-08-04 · 이 계열 화면 세 번째).
 *  4. 해제는 `must_visit` 만 지운다 — 담기(`saved-places`)는 건드리지 않는다(INV-U1-04 ·
 *     BR-U1-04 양방향 독립). 사용자가 탐색 화면의 ♥ 까지 잃으면 되돌릴 방법이 없다.
 *  5. **강등(FIXED→ANYTIME)의 2단 위험을 감당한다** — 아래 블록 주석.
 *
 * ⚠️ **강등에는 원자성이 없다.** must-visits 는 POST·GET·DELETE 셋뿐이고 `PATCH`/`PUT` 이
 * 없어 타입 변경 경로가 **DELETE → POST 2단**뿐이다(h07 승격이 겪은 것과 같은 위험이 반대
 * 방향으로 온다). 그래서 h07 `MustVisitTimePage` 의 구조를 그대로 쓴다:
 *  1. **순서를 지킨다** — DELETE 가 먼저다. POST 를 먼저 보내면 중복 금지(INV-U1-18)로 409 다.
 *  2. **침묵하지 않는다** — 세 갈래(`lost`·`kept`·409)가 각각 다른 사실을 말한다(BR-U1-55).
 *  3. **재시도는 POST 만 다시 낸다** — DELETE 를 또 내면 없는 id 로 404 가 나거나 방금 성공한
 *     등록을 지운다. 그래서 실패 상태가 "다시 낼 요청" 을 통째로 들고 있는다.
 *
 * ponytail: 원자성 없음 — 서버에 must-visit 수정 오퍼레이션(`PATCH`)이 생기면 이 2단 전체가
 * 1회 호출로 대체된다(그때 `DemoteFailure`·재시도 슬롯도 함께 사라진다).
 */

/** DELETE 는 성공했고 POST 가 실패했다 — 사용자의 항목이 실제로 사라진 상태다. */
const DEMOTE_LOST = '바꾸지 못해 목록에서 빠졌어요. 다시 시도해 주세요';
/** DELETE 자체가 실패했다 — 항목은 그대로다. */
const DEMOTE_KEPT = '바꾸지 못했어요. 다시 시도해 주세요';
/** 409 = 목표 상태와 결과 상태가 같다. 실패로 세지 않되 침묵하지도 않는다. */
const DEMOTE_DUPLICATE = '이미 아무 때나로 담겨 있어요';

type DemoteFailure =
  /** 잃었다 — 되돌리려면 이 요청을 다시 내야 한다. */
  | { kind: 'lost'; request: AddMustVisitRequest }
  /** 지키고 있다 — 서버 상태가 안 바뀌었으므로 처음부터 다시 하면 된다. */
  | { kind: 'kept' };

export function MustVisitListPage({
  tripId,
}: {
  tripId: string;
}): ReactElement {
  const router = useRouter();
  const queryClient = useQueryClient();

  const isAuthed = getAccessToken() !== null;
  const mustVisits = useGetTripsTripIdMustVisits(tripId);
  const savedPlaces = useSavedPlaces({ isAuthed });
  const removeMustVisit = useDeleteTripsTripIdMustVisitsMustVisitId();

  const [demoteFailure, setDemoteFailure] = useState<DemoteFailure | null>(
    null
  );
  const [demoteDuplicate, setDemoteDuplicate] = useState(false);
  // 응답이 오기 전 두 번째 확인이 두 번째 강등을 만들면 DELETE 가 두 번 나간다. 상태 갱신은
  // 다음 렌더에야 보이므로 같은 틱의 두 번째 누름을 못 막는다 — ref 는 쓰는 즉시 보인다
  // (`MustVisitTimePage.submitLockedRef` 와 같은 이유).
  const submitLockedRef = useRef(false);

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
    // 강등 실패는 **여기로 오지 않는다** — 자기 사유와 자기 재시도를 따로 들고 다닌다.
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

  async function sendDemotePost(request: AddMustVisitRequest): Promise<void> {
    // 상태(`demoteDuplicate`)는 다음 렌더에야 보인다 — 이 함수 안에서 갈래를 가르려면
    // 지역 값이어야 한다.
    let duplicated = false;
    try {
      await postTripsTripIdMustVisits(tripId, request);
    } catch (error) {
      if (!isAlreadyRegistered(error)) {
        // DELETE 는 이미 성공했다 — 되돌리려면 이 요청을 그대로 다시 내야 한다.
        setDemoteFailure({ kind: 'lost', request });
        submitLockedRef.current = false;
        return;
      }
      duplicated = true;
    }
    // 이 요청이 성공했다고 **다른 항목의 실패까지** 지우지 않는다. `lost` 는 서버에서 이미
    // 사라진 항목의 "다시 낼 요청" 을 담은 **유일한 사본**이라, 함께 버리면 사용자가 그 항목을
    // 영구히 잃는다(03b §2). 지우는 것은 방금 성공한 그 항목의 실패뿐이다.
    setDemoteFailure((prev) =>
      prev?.kind === 'lost' && prev.request.poiId !== request.poiId
        ? prev
        : null
    );
    setDemoteDuplicate(duplicated);
    submitLockedRef.current = false;
    // 409 든 성공이든 무엇이 남아 있는지는 서버가 안다 — 서버 진실을 다시 그린다.
    invalidateMustVisits();
  }

  /**
   * 요청을 **받았는지** 돌려준다. 잠금 중이면 `false` — 화면은 그때 확인 시트를 닫지 않는다.
   * 값 없이 돌아오면 확인 시트가 닫혀 버려 **사용자에게 남는 신호가 0** 이 된다: 경고를 읽고
   * `바꾸기` 까지 눌렀는데 아무 일도 아무 말도 없는 침묵 실패다(BR-U1-55 · 03b §3).
   */
  function handleDemote(input: {
    mustVisitId: string;
    sourcePoiId: string;
  }): boolean {
    if (submitLockedRef.current) return false;
    submitLockedRef.current = true;
    setDemoteDuplicate(false);

    void (async () => {
      try {
        await deleteTripsTripIdMustVisitsMustVisitId(tripId, input.mustVisitId);
      } catch {
        // 항목은 그대로다 — POST 를 보내지 않는다(보내면 409로 막히고 요청만 는다).
        setDemoteFailure({ kind: 'kept' });
        submitLockedRef.current = false;
        return;
      }
      // 날짜·시각을 다시 실어 보내지 않는다 — 강등은 그것을 버리는 방향이고, 남겨 보내면
      // 서버가 `ANYTIME` 인데 시각이 있는 모순된 등록 건을 갖게 된다.
      await sendDemotePost({ poiId: input.sourcePoiId, type: 'ANYTIME' });
    })();
    return true;
  }

  function handleRetryDemote(): void {
    if (demoteFailure?.kind !== 'lost' || submitLockedRef.current) return;
    submitLockedRef.current = true;
    void sendDemotePost(demoteFailure.request);
  }

  const demoteErrorText =
    demoteFailure?.kind === 'lost'
      ? DEMOTE_LOST
      : demoteFailure?.kind === 'kept'
        ? DEMOTE_KEPT
        : demoteDuplicate
          ? DEMOTE_DUPLICATE
          : undefined;

  return (
    <MustVisitPickerScreen
      view={view}
      pins={buildMustVisitPins({
        items,
        savedPlaces: savedPlaces.savedPlaces,
      })}
      demoteErrorText={demoteErrorText}
      onBack={() => router.back()}
      // 다음/건너뛰기 둘 다 h09(생성 중)로 잇는다(TRIP-454 AC-2). h09 는 이제 존재하므로
      // 상시 차단·사유 문구가 사라졌다 — 화면 계약(`onProceed`/`onSkip` 활성)은 무수정이다.
      onProceed={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/generating',
          params: { tripId },
        })
      }
      onSkip={() =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/generating',
          params: { tripId },
        })
      }
      onPressItem={(sourcePoiId) =>
        router.push({
          pathname: '/trips/[tripId]/itinerary/must-visits/[poiId]',
          params: { tripId, poiId: sourcePoiId },
        })
      }
      onRemove={handleRemove}
      onRetry={handleRetry}
      onDemote={handleDemote}
      // 다시 낼 요청이 있는 실패에만 재시도를 준다 — `kept` 는 서버 상태가 안 바뀌었으므로
      // 다시 할 일이 "칩을 다시 누르는 것" 이지 같은 요청 재전송이 아니다(h07 선례).
      onRetryDemote={
        demoteFailure?.kind === 'lost' ? handleRetryDemote : undefined
      }
    />
  );
}
