import { type ReactElement, useState } from 'react';
import { useRouter } from 'expo-router';

import { basesChanged } from '../model/basesChanged';
import { useTripBases } from '@/features/assign-trip-base';
import { BaseRegenerateDialog } from './BaseRegenerateDialog';
import type { BaseAssignment } from '@/shared/api/index.schemas';
import { useGetTripsTripId } from '@/shared/api/index.hooks';

import { BaseNightsFlow } from './TripNewStep2Page';

/**
 * TRIP-1011 C — 여행 단위 거점 화면(`/trips/[tripId]/bases`, 3/4 "거점 숙소 다시 고르기"로 push).
 * 위저드 스토어가 아니라 서버 여행(`GET /trips/{tripId}`)의 기간·여행지로 2/4 와 같은 공통 배선을
 * 부른다 — 3/4 로는 일정 탭 카드로도 들어오므로 스토어엔 다른 여행 값이 남아 있을 수 있다.
 *
 * 두 CTA 는 3/4 로 돌아간다(push 로 왔으면 back, 딥링크면 replace). tripId 가 늘 있어 notrip 얼굴은
 * 안 나오지만 화면 prop 이 필수라 "처음부터"에도 같은 복귀를 넘긴다(빈 핸들러 금지).
 *
 * TRIP-1082 — `mode="edit"`(l04 '출발점 변경' 입구)면 거점 편집 얼굴이다. [완료]·헤더 ‹ 는 같은 판정을 탄다:
 *  - 들어와서 **처음 받은 서버 배정**(`isFetchedAfterMount` 첫 true 시점)을 스냅샷으로 두고, 지금 배정과
 *    밤 단위로 비교한다(`basesChanged`). 들어오기 전 캐시(l04 가 채운 값)는 기준이 아니다.
 *  - 바뀌었고 다시 만들 일정이 있는 여행(PLANNED/CONFIRMED · 일정 > 0)이면 묻는다(BR-U6-21). 그 밖엔
 *    떠난다 — ACTIVE·ENDED 는 서버가 재생성을 거절하므로 묻지 않는다.
 *  - [일정 다시 만들기]는 홈까지 걷고 생성 화면(h09)을 push 만 한다(TRIP-1263) — POST 는 h09 가 소유한다.
 */
export function TripBasesPage({
  tripId,
  mode,
}: {
  tripId: string;
  mode?: 'edit';
}): ReactElement {
  const router = useRouter();
  const trip = useGetTripsTripId(tripId);
  const editing = mode === 'edit';
  // 배선(BaseNightsFlow)과 같은 쿼리 키라 요청이 늘지 않는다. 편집이 아니면 구독하지 않는다.
  const bases = useTripBases(editing ? tripId : undefined);
  const [snapshot, setSnapshot] = useState<BaseAssignment[] | null>(null);
  const [asking, setAsking] = useState(false);

  // 렌더 중 상태 갱신(이전 렌더 값 기억 패턴) — 스냅샷은 한 번만 찍힌다.
  if (
    editing &&
    snapshot === null &&
    bases.isFetchedAfterMount &&
    bases.data !== undefined
  ) {
    setSnapshot(bases.data);
  }

  function backToMethod(): void {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId },
    });
  }

  /** 편집 출구 — 딥링크 폴백은 편집 입구(l04)다. h04 로 보내면 확정 여행이 3/4 방식 선택에 떨어진다. */
  function leaveEdit(): void {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/my/stays');
  }

  function finishEdit(): void {
    const changed =
      snapshot !== null && basesChanged(snapshot, bases.data ?? []);
    const status = trip.data?.status;
    const canRegenerate =
      (status === 'PLANNED' || status === 'CONFIRMED') &&
      (trip.data?.itineraryDayCount ?? 0) > 0;
    if (changed && canRegenerate) {
      setAsking(true);
      return;
    }
    leaveEdit();
  }

  function regenerate(): void {
    // TRIP-1263 — 홈까지 걷고 push(MustVisitListPage.goToGenerating 과 같은 진입 정리).
    router.dismissTo('/(tabs)');
    router.push({
      pathname: '/trips/[tripId]/itinerary/generating',
      params: { tripId, mode: 'FULLY_AI' },
    });
  }

  return (
    <>
      <BaseNightsFlow
        tripId={tripId}
        startDate={trip.data?.startDate}
        endDate={trip.data?.endDate}
        destinations={trip.data?.destinations ?? []}
        onExit={backToMethod}
        onBack={editing ? finishEdit : backToMethod}
        onRestart={backToMethod}
        tripLoad={trip}
        onDone={editing ? finishEdit : undefined}
      />
      {asking ? (
        <BaseRegenerateDialog onKeep={leaveEdit} onRegenerate={regenerate} />
      ) : null}
    </>
  );
}
