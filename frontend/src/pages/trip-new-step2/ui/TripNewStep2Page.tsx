import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import {
  nightlyBaseCards,
  toBaseSections,
} from '@/features/trip/model/baseSections';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import { useTripBases } from '@/features/trip/model/useTripBases';
import {
  TripWizardStep2Screen,
  type Step2Variant,
} from '@/features/trip/ui/TripWizardStep2Screen';

/**
 * g02 거점 숙소 2/4 배선(TRIP-672 재작성) — 두 조회 · 스토어 · 라우터를 잇는다. 화면은 이 중
 * 어느 것도 모르고 완성된 카드 뷰모델만 받는다.
 *
 *  1. **박별 카드 파생** — `toBaseSections`(정렬·박 라벨 소유) → `nightlyBaseCards`(밤 목록·지역·
 *     날짜·숙소명 조인)로 밤 수(Σnights)만큼 카드를 만든다. 배정된 밤은 숙소명, 미배정 밤은
 *     화면이 "숙소 미정"으로 그린다(옵션 A).
 *  2. **변형 판정(옵션 A — empty 없음)** — `createdTripId` 부재 → notrip · 조회 실패 → error ·
 *     진행 중 → loading · 그 밖 → default. **empty가 없다**: 목적지가 있으면(step1에서 강제)
 *     배정이 0이어도 Σnights 카드가 전부 "숙소 미정"으로 뜬다.
 *  3. **조회 껐다 켜기** — 위저드는 `Stack.Protected` 밖이라 딥링크로 tripId 없이 열린다.
 *     `enabled: tripId !== undefined`로 그때 요청을 아예 안 보낸다.
 *
 * 옛 후보 하트 배정 모델(coverage 차단 게이트·연박 묶음·fixSheet·assign/unassign)은 통째로
 * 걷혔다(D2). 카드 탭은 S9(숙소 선택 시트) 미착수라 오픈 신호를 받을 대상이 없어 no-op이다 —
 * 그 계약을 재는 곳은 화면 층(`nightNumber`)이다. 두 CTA는 게이트 없이 h04(방식 선택)로
 * `replace`한다(브리프 AC-5, 현 `goToMethod` 계승 — 여행은 이미 서버에 만들어져 위저드로
 * 되돌아갈 이유가 없으므로 `push`가 아니라 `replace`로 파괴된 위저드 화면을 스택에서 걷는다).
 */
export function TripNewStep2Page(): ReactElement {
  const router = useRouter();
  const {
    createdTripId: tripId,
    startDate,
    destinations,
  } = useTripWizardStore();

  const savedStays = useSavedStays({ enabled: tripId !== undefined });
  const bases = useTripBases(tripId);

  const savedStayList = savedStays.data ?? [];
  const assignments = bases.data ?? [];
  // 딥링크 진입에서는 빈 문자열이 그대로 흘러간다 — 목적지가 없어 카드는 어차피 0장이다.
  const tripStartDate = startDate ?? '';

  const sections = toBaseSections(assignments, savedStayList, {
    startDate: tripStartDate,
  });
  const cards = nightlyBaseCards({
    destinations,
    startDate: tripStartDate,
    sections,
  });

  // 두 목록은 `saved-stays`·`bases`에서 나오므로 하나만 죽어도 골격이 없다 — 부분 표시를
  // 시도하면 상태 조합이 폭발한다.
  const loadFailed = savedStays.isError || bases.isError;
  const loading = savedStays.isPending || bases.isPending;

  function resolveVariant(): Step2Variant {
    if (tripId === undefined) return 'notrip';
    if (loadFailed) return 'error';
    if (loading) return 'loading';
    return 'default';
  }

  /** 두 출구 CTA의 공통 목적지 — 방식 선택(h04)으로 `replace`. `tripId`는 CTA가 보이는 얼굴에선
   * `notrip`이 먼저 이겨 항상 정의되지만, 그 사실을 컴파일러에 알리는 가드를 둔다. */
  function goToMethod(): void {
    if (tripId === undefined) return;
    router.replace({
      pathname: '/trips/[tripId]/itinerary/method',
      params: { tripId },
    });
  }

  return (
    <TripWizardStep2Screen
      variant={resolveVariant()}
      cards={cards}
      // S9(숙소 선택 시트) 미착수 — 오픈 신호를 받을 대상이 아직 없다(no-op stub).
      onPressCard={() => {}}
      onGenerate={goToMethod}
      onNoStayStart={goToMethod}
      onBack={() => router.back()}
      onRetryAll={() => {
        void savedStays.refetch();
        void bases.refetch();
      }}
      onRestart={() => router.push('/trips/new/step1')}
    />
  );
}
