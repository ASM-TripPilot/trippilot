import { type ReactElement, useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import {
  nightlyBaseCards,
  toBaseSections,
} from '@/features/trip/model/baseSections';
import { deriveEndDate } from '@/features/trip/model/tripWizardStep1';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import {
  useAssignBase,
  useTripBases,
} from '@/features/trip/model/useTripBases';
import { StaySelectSheet } from '@/features/trip/ui/StaySelectSheet';
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
 * 옛 후보 하트 배정 모델(coverage 차단 게이트·연박 묶음·fixSheet)은 통째로 걷혔다(D2). 두 CTA는
 * 게이트 없이 h04(방식 선택)로 `replace`한다(브리프 AC-5, 현 `goToMethod` 계승 — 여행은 이미
 * 서버에 만들어져 위저드로 되돌아갈 이유가 없으므로 `push`가 아니라 `replace`로 파괴된 위저드
 * 화면을 스택에서 걷는다).
 *
 * S9(TRIP-673) 재연결 — S8이 no-op stub으로 둔 카드 탭을 숙소 선택 시트 오픈으로 잇는다:
 *  1. **카드 탭 → 시트 오픈** — `onPressCard(nightNumber)`가 `openNight`을 세우고, 그 밤 카드가
 *     있으면 `<StaySelectSheet>`를 화면의 형제로 조건부 마운트한다(자매 시트 관례).
 *  2. **드래프트·구간은 배선 소유** — 시트는 무상태다. 선택 savedStayId·시트 열림·실패 플래그를
 *     이 페이지가 `useState`로 지고, 지정 시 밤 ISO를 파생해 POST 인자를 만든다.
 *  3. **밤 구간 파생**(★1) — `NightlyBaseCard`엔 밤 ISO가 없어 `startDate + (nightNumber-1)일`로
 *     파생한다(`deriveEndDate` 재사용). `dateFrom`=밤 ISO, `dateTo`=밤+1일(체크아웃 배타).
 *  4. **지정 커밋** — `useAssignBase().mutate({tripId, data:{savedStayId,dateFrom,dateTo}}, {onSuccess,
 *     onError})`. 성공→시트 닫기(+선택 초기화), 실패→시트 유지 + 인라인 오류(INV-4). 무효화는
 *     `useAssignBase` 내부 부작용이라 배선이 직접 안 부른다(01b §7-1).
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
  const assignBase = useAssignBase();

  // 시트 드래프트는 배선이 소유한다(시트는 무상태) — 어느 밤이 열렸나·무엇을 골랐나·직전 지정이
  // 실패했나.
  const [openNight, setOpenNight] = useState<number | null>(null);
  const [selectedSavedStayId, setSelectedSavedStayId] = useState<string | null>(
    null
  );
  const [assignFailed, setAssignFailed] = useState(false);
  // in-flight 잠금(useRef — 상태와 달리 같은 틱에 즉시 읽힌다). 지정 요청이 날아가 응답을
  // 기다리는 동안 재탭이 잉여 POST 를 만들지 않게 한다. `isPending` 은 다음 렌더에야 반영돼
  // 같은 틱 이중탭을 못 막으므로, 그 창을 이 ref 가 닫는다(S8 재작성에서 드롭된 잠금 복원).
  const assignLockRef = useRef(false);

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
    // 저장 숙소 0 **그리고** 배정 0 일 때만 empty(S10). ⚠️ loading 뒤에 둔다 — 조회 중엔
    // savedStayList 가 [] 라도 empty 가 아니라 loading 이어야 한다(순서 급소, §3). 배정이 남아
    // 있으면(지정 후 저장 해제) empty 로 가리지 않고 박별 카드(default)를 그린다.
    if (savedStayList.length === 0 && assignments.length === 0) return 'empty';
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

  /** 카드 탭 → 그 밤의 시트를 연다. 새로 여는 밤마다 선택·실패·잠금을 비워 깨끗이 시작한다. */
  function openSheet(nightNumber: number): void {
    assignLockRef.current = false;
    setOpenNight(nightNumber);
    setSelectedSavedStayId(null);
    setAssignFailed(false);
  }

  function closeSheet(): void {
    assignLockRef.current = false;
    setOpenNight(null);
    setSelectedSavedStayId(null);
    setAssignFailed(false);
  }

  /** 지정 커밋 — 밤 ISO를 파생(★1)해 POST 인자를 만든다. 밤 ISO는 `NightlyBaseCard`에 없어
   * `startDate + (nightNumber-1)일`로 구한다(★계약②). `dateTo`는 체크아웃 배타라 밤+1일이다. */
  function handleAssign(): void {
    if (
      tripId === undefined ||
      startDate === undefined ||
      openNight === null ||
      selectedSavedStayId === null
    ) {
      return;
    }
    // 이미 지정이 날아가는 중이면 즉시 되돌린다(같은 틱 이중탭 차단). 성공은 closeSheet 가
    // 잠금까지 푼다. 실패는 시트를 유지해야 해 여기서 직접 푼다 — 안 풀면 실패 후 영구 잠김.
    if (assignLockRef.current) return;
    assignLockRef.current = true;
    const dateFrom = deriveEndDate(startDate, openNight - 1);
    const dateTo = deriveEndDate(startDate, openNight);
    assignBase.mutate(
      { tripId, data: { savedStayId: selectedSavedStayId, dateFrom, dateTo } },
      {
        onSuccess: closeSheet,
        onError: () => {
          assignLockRef.current = false;
          setAssignFailed(true);
        },
      }
    );
  }

  // 그 밤 카드가 있을 때만 시트를 마운트한다(`openNight`이 null이면 find가 undefined). 제목은
  // 카드 메타처럼 `{박수}박 · {지역}`, 날짜 라벨은 카드가 이미 요일을 붙여 낸 값을 그대로 쓴다.
  const openCard = cards.find((card) => card.nightNumber === openNight);

  return (
    <>
      <TripWizardStep2Screen
        variant={resolveVariant()}
        cards={cards}
        onPressCard={openSheet}
        onGenerate={goToMethod}
        onNoStayStart={goToMethod}
        onBrowseStays={() => router.push('/stays')}
        onBack={() => router.back()}
        onRetryAll={() => {
          void savedStays.refetch();
          void bases.refetch();
        }}
        onRestart={() => router.push('/trips/new/step1')}
      />
      {openCard !== undefined ? (
        <StaySelectSheet
          title={`${openCard.nightNumber}박 · ${openCard.region}`}
          dateLabel={openCard.dateLabel}
          candidates={savedStayList}
          selectedSavedStayId={selectedSavedStayId}
          onSelect={(savedStayId) => setSelectedSavedStayId(savedStayId)}
          onBrowse={() => router.push('/stays')}
          onAssign={handleAssign}
          assignPending={assignBase.isPending}
          assignFailed={assignFailed}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}
