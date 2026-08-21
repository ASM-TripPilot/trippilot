import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { isAxiosError } from 'axios';

import type { SavedStay } from '@/shared/api/generated/schemas';
import { toBaseSections } from '@/features/trip/model/baseSections';
import {
  formatSectionRange,
  formatTripRange,
  unresolvedDaysView,
} from '@/features/trip/model/baseScreen';
import {
  applyDayPick,
  baseBlockReason,
  canSaveStayFix,
  extendedTripPeriod,
  isOutsideTripPeriod,
  tripDayOptions,
  type BaseBlockReason,
  type StayGateInput,
  type TripPeriod,
} from '@/features/trip/model/baseGate';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useSavedStays } from '@/features/trip/model/useSavedStays';
import {
  useExtendTripPeriod,
  useFixSavedStay,
} from '@/features/trip/model/useBaseFix';
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
  type TripWizardStep2ScreenProps,
} from '@/features/trip/ui/TripWizardStep2Screen';

/**
 * g02 거점 숙소 2/2 배선(TRIP-225 · TRIP-226) — 세 조회 · 네 쓰기 · 스토어 · 라우터를 잇는다.
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
 * TRIP-226이 더한 것은 **지정 전에 말해 주는 층**이다(INV-4 — 침묵 실패 금지).
 *
 *  5. **지정 전 판정은 `baseGate`가 소유한다** — 배선은 그 답을 문구로 옮길 뿐이다. 조건식을
 *     여기서 다시 짜면 저장 게이트와 차단 게이트가 갈라지고, 사용자는 시트에서 고치고도
 *     카드가 잠긴 상태를 본다(01b D3).
 *  6. **차단은 두 겹이다** — 화면 `disabled`와 이 파일의 `assignable()`. 버튼을 안 거친 경로가
 *     실재한다: 지정 실패 인라인이 떠 있는 동안 목록이 갱신되면 화면 버튼은 잠기지만
 *     **재시도 버튼은 남고**, 그 재시도가 같은 핸들러를 다시 부른다.
 *  7. **기간 밖은 거르지 않되 경고하고, 확장은 반드시 묻는다**(BR-U1-27 · D17). 확인 전에는
 *     요청도 스토어도 안 움직인다. 확인 뒤에는 `PATCH /trips` → **스토어 갱신** → `POST /bases`
 *     순서다 — 스토어를 빠뜨리면 서버 데이터는 맞는데 박 번호 라벨이 옛 시작일로 남는다
 *     (`firstNight = dateFrom − trip.startDate + 1`, BR-U1-28).
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
/** 날짜 역전(TRIP-226 AC-14) — 발명. 계약상 이런 숙소도 저장은 되므로 목록에 실제로 들어온다. */
const REVERSED_DATES_REASON = '체크아웃이 체크인보다 빨라요';
/** 좌표 미확정 — **발명이 아니다.** BR-U1-22 원문이자 e05 conflict(`1358:1578`) 실측 문구다. */
const COORD_BLOCKED_REASON = '지도에서 위치를 확인해 주세요';

/** 기간 밖 경고·확장 질의(BR-U1-27) — 둘 다 발명. */
const OUT_OF_PERIOD_NOTE = '여행 기간을 벗어나요';
const EXTEND_PROMPT = '여행 기간을 늘려서 지정할까요?';

/** 보완 진입 라벨. 좌표 축은 e05(`1358:1584`) 실측 문구, 날짜 축은 발명이다. */
const FIX_COORD_LABEL = '지도에서 위치 확인';
const FIX_DATES_LABEL = '날짜 입력하기';

/** 시트 안 저장 차단 사유 — 날짜 축만 카드와 문구가 갈린다(카드는 "지정할 수 없어요",
 * 시트는 "골라 주세요"). 발명. */
const SHEET_DATES_INCOMPLETE = '날짜를 모두 선택해 주세요';

/** 쓰기 실패 인라인 문구(01b D13) — 발명이다(02a §5-6 I-2). */
const ASSIGN_FAILED_MESSAGE = '지정하지 못했어요';
const UNASSIGN_FAILED_MESSAGE = '해제하지 못했어요';
const FIX_FAILED_MESSAGE = '저장하지 못했어요';
/** 404만 문구를 가른다 — **서버가 뜻을 정해 둔 사유**라(BR-U1-56) 단정이 아니다. 400·422·500은
 * `error.code`에 enum이 없어 원인을 알 수 없고, 추측해 적으면 거짓 설명이 된다(01b D5). */
const STAY_GONE_MESSAGE = '목록에서 사라진 숙소예요';
/** 담은 숙소가 있는데 거점을 하나도 안 지정하고 진행하면, 후보 풀 기준점(앵커)이 0이라 생성이
 * AI 경계에서 폴백(INV-4)으로 떨어져 추천 없는 최소 일정만 나온다. 그 사실을 진행 전에 보인다
 * (TRIP-490). Figma 프레임 부재라 문구는 발명값 — 게이트②/실기에서 정정 대상. */
const FALLBACK_WITHOUT_BASE_NOTICE =
  '거점 숙소를 지정하지 않으면 추천 없이 최소한의 일정만 만들어져요';

const BLOCKED_REASON_TEXT: Record<BaseBlockReason, string> = {
  DATES_MISSING: ASSIGN_BLOCKED_REASON,
  DATES_REVERSED: REVERSED_DATES_REASON,
  COORD_UNCONFIRMED: COORD_BLOCKED_REASON,
};

const SHEET_BLOCKED_REASON: Record<BaseBlockReason, string> = {
  DATES_MISSING: SHEET_DATES_INCOMPLETE,
  DATES_REVERSED: REVERSED_DATES_REASON,
  COORD_UNCONFIRMED: COORD_BLOCKED_REASON,
};

/** 두 날짜 축은 같은 시트로 간다(01b D2) — 목적지가 같으므로 버튼도 하나이고 라벨만 갈린다. */
const FIX_LABEL_TEXT: Record<BaseBlockReason, string> = {
  DATES_MISSING: FIX_DATES_LABEL,
  DATES_REVERSED: FIX_DATES_LABEL,
  COORD_UNCONFIRMED: FIX_COORD_LABEL,
};

/** 좌표가 없는 숙소의 지도 시작점(서울시청, 특별한 의미는 없다). 핀을 찍으려면 먼저 지도가
 * 떠 있어야 한다 — `StayRegisterScreen`의 `PIN_MAP_DEFAULT_CENTER`와 같은 판단이고, 교차
 * feature import를 피해 값을 다시 적는다. */
const FIX_MAP_DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };

type FailureMap = Record<string, string | undefined>;

/** 시트가 고쳐 나가는 값. 목록의 숙소를 복사해 시작하고, 저장 전까지 서버와 무관하다. */
interface FixDraft {
  savedStayId: string;
  lat: number | null;
  lng: number | null;
  coordConfirmed: boolean;
  pinDropped: boolean;
  checkIn: string | null;
  checkOut: string | null;
}

/** 지정해도 되는 숙소 + 요청에 실을 두 날짜. `undefined`면 보내지 않는다. */
interface AssignTarget {
  stay: SavedStay;
  dateFrom: string;
  dateTo: string;
}

function isMissingResource(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}

/** 시트 초안에서 게이트 입력만 뽑는다 — 저장 게이트(`canSaveStayFix`)와 사유 문구
 * (`baseBlockReason`)가 **같은 값**을 보게 하는 자리다. */
function fixGateInput(draft: FixDraft): StayGateInput {
  return {
    coordConfirmed: draft.coordConfirmed,
    checkIn: draft.checkIn,
    checkOut: draft.checkOut,
  };
}

export function TripNewStep2Page(): ReactElement {
  const router = useRouter();

  // 드래프트 상자를 통째로 구독한다 — 이 화면이 떠 있는 동안 그 상자에 쓰는 것은 이 화면
  // 자신(`setPeriod`)뿐이라 선택자로 쪼개서 아낄 렌더가 없고, 쪼개면 **값이 같은 갱신**을
  // 화면이 아예 못 본다(구독이 값 비교로 끊긴다).
  //
  // ⚠️ 되돌리지 마라. 리포의 다른 소비자(step1·위저드 셸)는 전부 선택자를 쓰므로 이 형태가
  // 튀어 보이는데, 이 자리를 선택자로 바꾸면 **실기 동작은 하나도 안 바뀌면서**
  // `TripNewStep2Page.gate.test.tsx`의 ★1 두 케이스가 red가 된다. 그 케이스가 "목록이
  // 갱신됐다"를 흉내내는 레버가 `setPeriod(같은 값)`이고, 값이 같으면 선택자 구독은 그
  // 갱신을 못 보기 때문이다. 즉 이 형태를 강제하는 것은 실기 요구가 아니라 그 레버다
  // (03b W-1 · 후속 티켓 후보).
  const {
    createdTripId: tripId,
    startDate,
    endDate,
    destinations,
    setPeriod,
  } = useTripWizardStore();

  // 세 조회는 한 손잡이로 함께 꺼진다(01b D7) — 위저드는 `Stack.Protected` 밖이라 딥링크로
  // 열리고, 그때 tripId 없이 쏘면 전부 404가 된다.
  const savedStays = useSavedStays({ enabled: tripId !== undefined });
  const bases = useTripBases(tripId);
  const coverage = useTripCoverage(tripId);
  const assignBase = useAssignBase();
  const unassignBase = useUnassignBase();
  const fixSavedStay = useFixSavedStay();
  const extendTripPeriod = useExtendTripPeriod();

  const inFlightRef = useRef<Set<string>>(new Set());
  const [inFlight, setInFlight] = useState<string[]>([]);
  const [assignErrors, setAssignErrors] = useState<FailureMap>({});
  const [changeErrors, setChangeErrors] = useState<FailureMap>({});
  const [extendTarget, setExtendTarget] = useState<string | undefined>(
    undefined
  );
  const [fixDraft, setFixDraft] = useState<FixDraft | undefined>(undefined);
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState<string | undefined>(undefined);

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

  // 스토어가 비어 있는 딥링크 진입에서는 빈 문자열이 그대로 흘러간다 — `baseGate`가 그 갈래를
  // "기간을 모른다"로 받아 기간 밖을 주장하지 않는다.
  const tripPeriod: TripPeriod = {
    startDate: startDate ?? '',
    endDate: endDate ?? '',
  };

  const sections = toBaseSections(assignments, savedStayList, {
    startDate: tripPeriod.startDate,
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

  // 담은 숙소는 있는데 거점이 하나도 없으면(지정 못 했거나 안 함) 진행 결과가 폴백이 된다 —
  // 그 사실을 경고로 보인다(TRIP-490). 담은 숙소가 애초에 0인 정당한 no-stay 사용자는
  // `empty` 얼굴이라 이 자리(default/loading의 CtaBlock)에 도달하지 않아 경고를 안 본다.
  const fallbackWarning =
    savedStayList.length > 0 && assignments.length === 0
      ? FALLBACK_WITHOUT_BASE_NOTICE
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
    const reason = baseBlockReason(stay);
    return {
      savedStayId: stay.savedStayId,
      name: stay.name,
      // 배지는 현재 여행의 배정에서 파생된다(BR-U1-20 · INV-U1-07) — `SavedStay`에는 그런
      // 필드가 애초에 없다.
      isBase: baseStayIds.has(stay.savedStayId),
      assignedLabel:
        nightLabel === undefined ? undefined : `${nightLabel}에 지정됨`,
      assignPending: inFlight.includes(stay.savedStayId),
      blockedReason:
        reason === undefined ? undefined : BLOCKED_REASON_TEXT[reason],
      fixLabel: reason === undefined ? undefined : FIX_LABEL_TEXT[reason],
      // 경고는 상주하되 지정을 막지 않는다 — 막는 축은 `blockedReason` 하나다(D8 · D17).
      outOfPeriodNote: isOutsideTripPeriod(stay, tripPeriod)
        ? OUT_OF_PERIOD_NOTE
        : undefined,
      extendPrompt:
        extendTarget === stay.savedStayId ? EXTEND_PROMPT : undefined,
      errorText: assignErrors[stay.savedStayId],
    };
  });

  /** 지정 전 2선(★1) — 화면이 이미 막지만 배선도 스스로 문을 잠근다. 그냥 보내고 서버 400을
   * 받는 구현은 사용자에게 원인을 설명하지 못한다(`error.code`에 enum이 없다). */
  function findStay(savedStayId: string): SavedStay | undefined {
    return savedStayList.find((one) => one.savedStayId === savedStayId);
  }

  function assignable(savedStayId: string): AssignTarget | undefined {
    const stay = findStay(savedStayId);
    if (stay === undefined) return undefined;
    if (baseBlockReason(stay) !== undefined) return undefined;
    const { checkIn, checkOut } = stay;
    // 위 판정이 날짜 없음을 이미 걸렀다 — 컴파일러에게 그 사실을 알리는 줄이다.
    if (checkIn == null || checkOut == null) return undefined;
    return { stay, dateFrom: checkIn, dateTo: checkOut };
  }

  /** 확장이 필요하면 **먼저** 끝내고 배정한다. 나란히 쏘면 서버가 아직 옛 기간을 들고 있어
   * 배정이 400으로 되받고, 사용자는 "확인을 눌렀는데 실패했습니다"만 본다. */
  async function runAssign(
    target: AssignTarget,
    extendTo: TripPeriod | null
  ): Promise<void> {
    if (tripId === undefined) return;
    const savedStayId = target.stay.savedStayId;
    if (!beginLock(savedStayId)) return;

    setAssignErrors((prev) => ({ ...prev, [savedStayId]: undefined }));
    try {
      if (extendTo !== null) {
        await extendTripPeriod.mutateAsync({
          tripId,
          data: {
            startDate: extendTo.startDate,
            endDate: extendTo.endDate,
            destinations,
          },
        });
        // 서버만 고치고 화면 기억을 안 고치면 박 번호가 옛 시작일 기준으로 남는다(BR-U1-28).
        setPeriod(undefined, extendTo.startDate, extendTo.endDate);
      }
      await assignBase.mutateAsync({
        tripId,
        // 날짜 선택 UI를 신설하지 않는다(01b D1) — 계약이 3필드 전부 필수라 출처가 필요했고,
        // BR-U1-26("날짜 없이 저장은 되나 배정은 불가")이 이 해석의 근거다.
        data: {
          savedStayId,
          dateFrom: target.dateFrom,
          dateTo: target.dateTo,
        },
      });
    } catch (error) {
      const missing = isMissingResource(error);
      setAssignErrors((prev) => ({
        ...prev,
        [savedStayId]: missing ? STAY_GONE_MESSAGE : ASSIGN_FAILED_MESSAGE,
      }));
      // 낡은 것은 목록뿐이다 — 배정·커버리지까지 다시 쏘면 멀쩡히 그려진 화면이 통째로
      // 다시 로딩된다.
      if (missing) void savedStays.refetch();
    } finally {
      endLock(savedStayId);
    }
  }

  function assign(savedStayId: string): void {
    const target = assignable(savedStayId);
    if (target === undefined) return;
    // 임의 확장 금지(BR-U1-27) — 여기서 요청도 스토어도 건드리지 않고 묻기만 한다.
    if (isOutsideTripPeriod(target.stay, tripPeriod)) {
      setExtendTarget(savedStayId);
      return;
    }
    void runAssign(target, null);
  }

  function confirmExtend(savedStayId: string): void {
    setExtendTarget(undefined);
    const target = assignable(savedStayId);
    if (target === undefined) return;
    void runAssign(target, extendedTripPeriod(target.stay, tripPeriod));
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

  const fixStay =
    fixDraft === undefined ? undefined : findStay(fixDraft.savedStayId);

  /** 초안이 아직 열려 있을 때만 고친다 — 세 핸들러가 같은 `undefined` 가드를 각자 들지 않게
   * 한 자리로 모은다. */
  function updateFixDraft(change: (draft: FixDraft) => FixDraft): void {
    setFixDraft((prev) => (prev === undefined ? prev : change(prev)));
  }

  function openFix(savedStayId: string): void {
    const stay = findStay(savedStayId);
    if (stay === undefined) return;
    setFixDraft({
      savedStayId,
      lat: stay.lat ?? null,
      lng: stay.lng ?? null,
      coordConfirmed: stay.coordConfirmed,
      pinDropped: false,
      checkIn: stay.checkIn ?? null,
      checkOut: stay.checkOut ?? null,
    });
    setFixError(undefined);
  }

  async function saveFix(): Promise<void> {
    if (fixDraft === undefined || fixStay === undefined) return;
    // 시트 버튼이 이미 막지만 여기서도 검사한다 — 시트의 `[다시 시도]`에는 `disabled`가 없어
    // 버튼 잠금을 우회한다. 저장 게이트는 언제나 이 함수 하나다(01b D3).
    if (!canSaveStayFix(fixGateInput(fixDraft))) return;

    setFixSaving(true);
    setFixError(undefined);
    try {
      await fixSavedStay.mutateAsync({
        savedStayId: fixStay.savedStayId,
        data: {
          // `name`이 계약의 유일한 필수 필드다 — 안 실으면 서버가 400을 준다.
          name: fixStay.name,
          lat: fixDraft.lat,
          lng: fixDraft.lng,
          coordConfirmed: fixDraft.coordConfirmed,
          checkIn: fixDraft.checkIn,
          checkOut: fixDraft.checkOut,
        },
      });
      setFixDraft(undefined);
    } catch {
      // 시트를 닫지 않는다 — 닫으면 방금 찍은 핀과 고른 날짜를 전부 잃는다(01b D13).
      setFixError(FIX_FAILED_MESSAGE);
    } finally {
      setFixSaving(false);
    }
  }

  let fixSheet: TripWizardStep2ScreenProps['fixSheet'];
  if (fixDraft !== undefined && fixStay !== undefined) {
    const gateInput = fixGateInput(fixDraft);
    // 잠글지는 `canSaveStayFix`가, 뭐라고 말할지는 `baseBlockReason`이 정한다. 두 함수는
    // 서로를 정의하므로(`baseGate.ts`) 답이 갈릴 수 없다 — 32조합 전수가 그 동치를 잠근다.
    const sheetReason = baseBlockReason(gateInput);
    fixSheet = {
      savedStayId: fixStay.savedStayId,
      stayName: fixStay.name,
      center: {
        lat: fixDraft.lat ?? FIX_MAP_DEFAULT_CENTER.lat,
        lng: fixDraft.lng ?? FIX_MAP_DEFAULT_CENTER.lng,
      },
      coordConfirmed: fixDraft.coordConfirmed,
      pinDropped: fixDraft.pinDropped,
      // 지도를 못 띄우는 상태는 시트가 아니라 여기서 판정한다 — 지도 컴포넌트는 자기 실패
      // 표면을 그릴 뿐이고, 저장이 왜 영영 안 열리는지는 아무도 말해 주지 않는다(INV-4).
      mapUnavailable: !process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY,
      dayOptions: tripDayOptions(tripPeriod),
      checkIn: fixDraft.checkIn,
      checkOut: fixDraft.checkOut,
      saveDisabled: !canSaveStayFix(gateInput),
      saveBlockedReason:
        sheetReason === undefined
          ? undefined
          : SHEET_BLOCKED_REASON[sheetReason],
      saving: fixSaving,
      errorText: fixError,
      onPinDrop: (lat, lng) =>
        updateFixDraft((draft) => ({
          ...draft,
          lat,
          lng,
          pinDropped: true,
        })),
      onConfirmCoord: () =>
        updateFixDraft((draft) => ({ ...draft, coordConfirmed: true })),
      onPickDay: (date) =>
        updateFixDraft((draft) => ({ ...draft, ...applyDayPick(draft, date) })),
      onSave: () => void saveFix(),
      onRetrySave: () => void saveFix(),
      onClose: () => setFixDraft(undefined),
    };
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

  /** 두 출구 CTA의 공통 목적지 — 방식 선택(h04)으로 `replace`한다(TRIP-400). `push`가 아니라
   * `replace`인 이유는 여행이 이미 서버에 만들어져(위저드로 되돌아갈 이유가 없고, back은
   * `router.back()`이라) 파괴된 위저드 화면을 스택에서 걷어내야 하기 때문이다. `tripId`는
   * 타입상 `string | undefined`지만 CTA가 보이는 얼굴에선 `notrip`이 먼저 이겨 항상 정의된다
   * — 그 사실을 컴파일러에게 알리는 가드다(`runAssign`/`unassign`과 같은 관례). */
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
      subtitle={formatTripRange(tripPeriod.startDate, tripPeriod.endDate)}
      sections={sectionRows}
      candidates={candidates}
      generateDisabled={generateDisabled}
      unresolved={unresolved}
      fallbackWarning={fallbackWarning}
      coverageFailed={coverage.isError}
      fixSheet={fixSheet}
      onFix={openFix}
      onExtendConfirm={confirmExtend}
      onExtendCancel={() => setExtendTarget(undefined)}
      onBack={() => router.back()}
      onAssign={assign}
      onRetryAssign={assign}
      onChange={(baseAssignmentId) => void unassign(baseAssignmentId)}
      onRetryChange={(baseAssignmentId) => void unassign(baseAssignmentId)}
      onGenerate={goToMethod}
      onNoStayStart={goToMethod}
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
