import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';

import { toBaseSections } from '@/features/trip/model/baseSections';
import {
  formatSectionRange,
  formatTripRange,
  unresolvedDaysView,
} from '@/features/trip/model/baseScreen';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import {
  useAssignBase,
  useTripBases,
  useTripCoverage,
  useUnassignBase,
} from '@/features/trip/model/useTripBases';
import {
  TripWizardStep2Screen,
  type BaseCandidateRow,
  type BaseSectionRow,
  type Step2Variant,
} from '@/features/trip/ui/TripWizardStep2Screen';

/**
 * g02 거점 숙소 2/2 배선(TRIP-225) — 세 조회 · 두 쓰기 · 스토어 · 라우터를 잇는다.
 * **판정은 전부 여기 있고 화면은 그 결과만 받는다.**
 *
 *  1. **다섯 얼굴 판정** — `createdTripId` 부재(01b D7) → 전면 실패(D14) → 로딩 → 저장 숙소가
 *     0이고 배정도 0(D3) → 그 밖은 default. 배정이 남아 있으면 저장 숙소가 0이어도 empty가
 *     아니다 — 그 행을 지우면 그 날짜 구간이 공백으로 오해된다(D5와 같은 이유).
 *  2. **진행 차단** — 권위는 `Coverage.blocked` 하나다(INV-2 · D16-b). `blocked`를 **아는데
 *     false일 때만** 연다: 커버리지를 모르는 상태(로딩·조회 실패)는 페일클로즈로 막는다
 *     (INV-U1-16 · D15, `tripDraft.ts` 5-c의 페일오픈→페일클로즈 반전과 같은 판단).
 *     보조 CTA(`숙소 없이 시작하기`)는 어느 실패에서도 열려 있다(BR-U1-40·47).
 *  3. **누른 카드/행 하나만 잠근다**(D12) — 목록 전체를 잠그면 다른 숙소를 연달아 지정할
 *     때마다 기다려야 한다. ⚠️ 잠금이 `useRef`인 이유는 상태 갱신이 다음 렌더에야 보이기
 *     때문이다: 같은 틱에 연달아 들어온 두 번째 누름이 아직 옛 값을 읽어 요청이 두 번 나간다
 *     (`TripNewStep1Page`의 `submitLockedRef`와 같은 사고). 화면에 그릴 pending은 그 ref를
 *     비추는 상태다 — 권위는 ref 하나이고 상태는 사본이다.
 *  4. **쓰기 실패는 그 자리에**(D13) — 전면 얼굴로 갈아 끼우면 방금까지 보던 목록을 잃는다.
 *     409를 성공으로 접는 것은 이 층이 아니라 `useAssignBase`다(D13-b) — 재조회 경로와 한
 *     몸이라 그쪽이 유일한 자리다.
 *
 * `toBaseSections`(TRIP-224)의 첫 소비자다 — 정렬과 박 번호는 그 함수가 소유하고 이 파일은
 * 결과를 그대로 넘긴다.
 */

/** 짝 맞는 저장 숙소가 없을 때의 대체 문구(01b D5). `toBaseSections`는 빈 문자열을 내고
 * 정본에 없는 문구를 발명하지 않는다 — 그것을 화면 문구로 바꾸는 것이 배선의 몫이다. */
const MISSING_STAY_NAME = '숙소 정보 없음';

/** 날짜 없는 저장 숙소의 지정 차단 사유(BR-U1-26 · INV-U1-09 · 01b D4). 그 상태의 프레임이
 * Figma에 없어 이 칸의 발명이다(02a §5-6 I-1) — 뒤집히면 이 한 줄만 바꾼다. */
const ASSIGN_BLOCKED_REASON = '날짜가 없어 지정할 수 없어요';

/** 쓰기 실패 인라인 문구(01b D13) — 같은 이유로 발명이다(02a §5-6 I-2). */
const ASSIGN_FAILED_MESSAGE = '지정하지 못했어요';
const UNASSIGN_FAILED_MESSAGE = '해제하지 못했어요';

/** 위저드를 빠져나가는 목적지. 일정 생성 화면(g03)이 아직 없어 일정 탭으로 보낸다 —
 * 주 CTA와 보조 CTA가 같은 곳으로 가는 것은 g03이 서면 갈린다(TRIP-229). */
const AFTER_WIZARD_ROUTE = '/(tabs)/itinerary' as const;

type FailureMap = Record<string, string | undefined>;

export function TripNewStep2Page(): ReactElement {
  const router = useRouter();

  const tripId = useTripWizardStore((state) => state.createdTripId);
  const startDate = useTripWizardStore((state) => state.startDate);
  const endDate = useTripWizardStore((state) => state.endDate);

  // 세 조회는 한 손잡이로 함께 꺼진다(01b D7) — 위저드는 `Stack.Protected` 밖이라 딥링크로
  // 열리고, 그때 tripId 없이 쏘면 전부 404가 된다.
  const savedStays = useSavedStays({ enabled: tripId !== undefined });
  const bases = useTripBases(tripId);
  const coverage = useTripCoverage(tripId);
  const assignBase = useAssignBase();
  const unassignBase = useUnassignBase();

  const inFlightRef = useRef<Set<string>>(new Set());
  const [inFlight, setInFlight] = useState<string[]>([]);
  const [assignErrors, setAssignErrors] = useState<FailureMap>({});
  const [changeErrors, setChangeErrors] = useState<FailureMap>({});

  /** 이미 날아가는 중이면 `false` — 그때는 요청을 만들지 않는다. */
  function beginLock(id: string): boolean {
    if (inFlightRef.current.has(id)) return false;
    inFlightRef.current.add(id);
    setInFlight([...inFlightRef.current]);
    return true;
  }

  function endLock(id: string): void {
    inFlightRef.current.delete(id);
    setInFlight([...inFlightRef.current]);
  }

  const savedStayList = savedStays.data ?? [];
  const assignments = bases.data ?? [];

  const sections = toBaseSections(assignments, savedStayList, {
    startDate: startDate ?? '',
  });

  const baseStayIds = new Set(
    assignments.map((assignment) => assignment.savedStayId)
  );
  const nightLabelByStayId = new Map(
    sections.map((section) => [section.savedStayId, section.nightLabel])
  );

  const coverageData = coverage.data;
  // 서버가 준 값 그대로다 — 클라이언트가 날짜를 세서 이 값을 만들지 않는다(INV-2 · D16-b).
  const blocked = coverageData?.blocked;
  const generateDisabled = blocked !== false;
  const unresolved =
    coverageData !== undefined && blocked === true
      ? unresolvedDaysView(coverageData.days)
      : undefined;

  const sectionRows: BaseSectionRow[] = sections.map((section) => ({
    baseAssignmentId: section.baseAssignmentId,
    nightLabel: section.nightLabel,
    dateLabel: formatSectionRange(section.dateFrom, section.dateTo),
    stayName: section.stayName === '' ? MISSING_STAY_NAME : section.stayName,
    changePending: inFlight.includes(section.baseAssignmentId),
    errorText: changeErrors[section.baseAssignmentId],
  }));

  const candidates: BaseCandidateRow[] = savedStayList.map((stay) => {
    const nightLabel = nightLabelByStayId.get(stay.savedStayId);
    const datesMissing = stay.checkIn == null || stay.checkOut == null;
    return {
      savedStayId: stay.savedStayId,
      name: stay.name,
      // 배지는 현재 여행의 배정에서 파생된다(BR-U1-20 · INV-U1-07) — `SavedStay`에는 그런
      // 필드가 애초에 없다.
      isBase: baseStayIds.has(stay.savedStayId),
      assignedLabel:
        nightLabel === undefined ? undefined : `${nightLabel}에 지정됨`,
      assignPending: inFlight.includes(stay.savedStayId),
      blockedReason: datesMissing ? ASSIGN_BLOCKED_REASON : undefined,
      errorText: assignErrors[stay.savedStayId],
    };
  });

  async function assign(savedStayId: string): Promise<void> {
    if (tripId === undefined) return;
    const stay = savedStayList.find(
      (candidate) => candidate.savedStayId === savedStayId
    );
    if (stay === undefined) return;
    // 페일클로즈(BR-U1-26) — 화면이 이미 막지만 배선도 스스로 문을 잠근다. 그냥 보내고
    // 서버 400을 받는 구현은 사용자에게 원인을 설명하지 못한다.
    const { checkIn, checkOut } = stay;
    if (checkIn == null || checkOut == null) return;
    if (!beginLock(savedStayId)) return;

    setAssignErrors((prev) => ({ ...prev, [savedStayId]: undefined }));
    try {
      await assignBase.mutateAsync({
        tripId,
        // 날짜 선택 UI를 신설하지 않는다(01b D1) — 계약이 3필드 전부 필수라 출처가 필요했고,
        // BR-U1-26("날짜 없이 저장은 되나 배정은 불가")이 이 해석의 근거다.
        data: { savedStayId, dateFrom: checkIn, dateTo: checkOut },
      });
    } catch {
      setAssignErrors((prev) => ({
        ...prev,
        [savedStayId]: ASSIGN_FAILED_MESSAGE,
      }));
    } finally {
      endLock(savedStayId);
    }
  }

  async function unassign(baseAssignmentId: string): Promise<void> {
    if (tripId === undefined) return;
    if (!beginLock(baseAssignmentId)) return;

    setChangeErrors((prev) => ({ ...prev, [baseAssignmentId]: undefined }));
    try {
      // `변경`은 해제까지다(01b D6) — 다시 고르는 것은 후보 목록에서 하고, 재배정 시트는
      // TRIP-190 경계다.
      await unassignBase.mutateAsync({ tripId, baseAssignmentId });
    } catch {
      setChangeErrors((prev) => ({
        ...prev,
        [baseAssignmentId]: UNASSIGN_FAILED_MESSAGE,
      }));
    } finally {
      endLock(baseAssignmentId);
    }
  }

  // 두 목록이 `saved-stays`·`bases`에서 나오므로 하나만 죽어도 골격이 없다 — 부분 표시를
  // 시도하면 상태 조합이 폭발한다(01b D14). `coverage` 실패는 여기 없다: 목록은 살리고
  // 주 CTA만 막는다(D15).
  const loadFailed = savedStays.isError || bases.isError;
  const loading = savedStays.isPending || bases.isPending || coverage.isPending;

  function resolveVariant(): Step2Variant {
    if (tripId === undefined) return 'notrip';
    if (loadFailed) return 'error';
    if (loading) return 'loading';
    if (savedStayList.length === 0 && sectionRows.length === 0) return 'empty';
    return 'default';
  }

  return (
    <TripWizardStep2Screen
      variant={resolveVariant()}
      subtitle={formatTripRange(startDate ?? '', endDate ?? '')}
      sections={sectionRows}
      candidates={candidates}
      generateDisabled={generateDisabled}
      unresolved={unresolved}
      coverageFailed={coverage.isError}
      onBack={() => router.back()}
      onAssign={(savedStayId) => void assign(savedStayId)}
      onRetryAssign={(savedStayId) => void assign(savedStayId)}
      onChange={(baseAssignmentId) => void unassign(baseAssignmentId)}
      onRetryChange={(baseAssignmentId) => void unassign(baseAssignmentId)}
      onGenerate={() => router.push(AFTER_WIZARD_ROUTE)}
      onNoStayStart={() => router.push(AFTER_WIZARD_ROUTE)}
      onExploreStays={() => router.push('/stays')}
      onRetryAll={() => {
        void savedStays.refetch();
        void bases.refetch();
        void coverage.refetch();
      }}
      onRestart={() => router.push('/trips/new/step1')}
      onRetryCoverage={() => void coverage.refetch()}
    />
  );
}
