import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { postTripsTripIdMustVisits } from '@/shared/api/generated/trips/trips';
import type {
  CompanionType,
  CreateTripRequest,
} from '@/shared/api/generated/schemas';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { getAccessToken } from '@/shared/api/tokenManager';
import { toggleMulti } from '@/shared/pref/preferenceSelection';

import {
  formatBudgetAmount,
  parseBudgetAmount,
} from '@/features/trip/model/budgetAmount';
import { buildCreateTripRequest } from '@/features/trip/model/createTripRequest';
import {
  applyRangePick,
  shiftMonth,
  type TripDateRange,
} from '@/features/trip/model/tripDatePicker';
import {
  validateTripDraft,
  type TripDraft,
} from '@/features/trip/model/tripDraft';
import { mustVisitFailureNotice } from '@/features/trip/model/mustVisitSeed';
import {
  summaryBudget,
  summaryCompanion,
  summaryDestinations,
  summaryPeriod,
  summaryPreferences,
} from '@/features/trip/model/tripSummary';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useCreateTrip } from '@/features/trip/model/useCreateTrip';
import { usePreferencePrefill } from '@/features/trip/model/usePreferencePrefill';
import { CompanionEditSheet } from '@/features/trip/ui/CompanionEditSheet';
import { DestinationEditSheet } from '@/features/trip/ui/DestinationEditSheet';
import { PeriodEditSheet } from '@/features/trip/ui/PeriodEditSheet';
import { TripWizardStep1Screen } from '@/features/trip/ui/TripWizardStep1Screen';

import { BudgetEditSheet } from './BudgetEditSheet';
import { PrefOverrideSheet } from './PrefOverrideSheet';

/**
 * TRIP-665 g01 1/2 배선(신 default) — 스토어 ↔ 요약 셀렉터 ↔ 화면 ↔ 라우터 ↔ 서버를 잇는다.
 *
 * 왜 이 설계인가: 신 default 는 온보딩 요약 카드 5행 + 꼭 갈 곳 스트립까지고, 편집 시트(여행지·
 * 기간·동행·취향·예산)는 S2~S6 후속이다. 그래서 옛 인라인 컨트롤(프리셋·스테퍼·칩·예산 입력·
 * 날짜 카드·등록숙소 행·인라인 여행지 시트)을 배선째 걷어냈다 — 그것들이 물던 `useRegions`·
 * `useSavedStays` 도 함께 드롭한다(여행지 편집은 S2, 날짜 편집은 S3). 남기면 node 페이지 테스트가
 * 그 훅을 목하지 않아 provider 부재/`onUnhandledRequest:'error'` 로 크래시한다 — 즉 드롭이 강제된다.
 *
 * 데이터 흐름:
 *  1. **요약 5행** — `tripSummary.ts` 셀렉터(순수)가 스토어 드래프트 + 프리필을 완성형 문자열로
 *     도출한다. 화면은 그 문자열을 받아 그릴 뿐, 조립하지 않는다(값이 `null` 이면 미선택 →
 *     화면이 플레이스홀더를 그린다). 취향·예산 두 행은 스토어에 없는 파생 데이터(프리필 라벨·예산
 *     tier)를 페이지만 갖고 있어, 통일성을 위해 5행 전부 페이지가 도출한다.
 *  2. **`[다음]` 게이트** — `validateTripDraft`(TRIP-204 동결)를 여기서만 부른다. 편집 시트가
 *     스텁이라 사용자는 UI 로 드래프트를 바꿀 수 없다 → `canProceed` 는 **스토어 선상태에서만**
 *     참이 될 수 있다(맹점① — "다음 비활성"은 이 슬라이스의 구조적 귀결이지 결함이 아니다).
 *  3. **제출·오류 매핑** — 서버 400 은 `overseas`/`banner` 둘로만 갈리고 나머지 전부(미상 코드·
 *     응답 없음)는 배너로 떨어진다(INV-4 페일세이프). 화면은 완성된 문자열만 받는다.
 *  4. **꼭 갈 곳** — 자동 시드는 폐지됐다(사용자 결정, 새 여행은 항상 0곳으로 시작). 스트립은
 *     스토어 `mustVisits`(현재 채우는 경로 없음)를 그대로 그리고, 제출 성공 **뒤** 남은 시드를
 *     `POST /trips/{tripId}/must-visits` 로 등록한다(계약에 생성 요청 필드가 없어 2단이 강제된다).
 *     등록은 여행 생성 `try` **바깥**이다 — 한 블록으로 묶으면 등록 실패가 "여행 생성 실패"로 둔갑해
 *     사용자가 [다시 시도]로 여행을 하나 더 만든다.
 *
 * 의심할 지점: 요약 5행 문자열 도출·게이트·제출 바디는 이 파일의 조립 로직이라 렌더 테스트가
 * 왕복으로 잡는다. 반면 편집 시트 오픈 콜백은 스텁(S2~S6)이라 지금은 신호만 위로 올린다.
 */

/** 서버 400 의 `error.code` 가 국내 밖 목적지를 가리키는 값. openapi 에 enum 이 없어 **발명값**이다
 * (01b D4) — BE 확인 뒤 이 상수 한 줄만 바꾸면 된다. */
const OVERSEAS_DESTINATION_ERROR_CODE = 'OVERSEAS_DESTINATION';

/** 제출 실패 배너 본문 — Figma 가 확정한 유일한 문구다(`2226:2128`). 미상 코드·미상 필드·응답
 * 자체 없음도 이 문구로 떨어진다(새 문구를 발명하는 대신 확정된 문구 하나를 재사용). */
const SUBMIT_ERROR_MESSAGE = '네트워크를 확인하고 다시 시도해주세요';

/** touched 게이트를 타지 않는 서버 400 → 화면 표면 갈래(01b D4). `overseas` 만 아는 코드로
 * 걸러내고, 원인을 확신할 수 없는 나머지 전부는 배너로 떨어뜨린다. */
type ServerSubmitFailure = 'overseas' | 'banner';

function classifyServerFailure(error: unknown): ServerSubmitFailure {
  if (!isAxiosError(error) || !error.response) {
    // 응답 자체가 없다 — 네트워크 실패. Figma 배너 본문이 정확히 이 갈래의 문구다.
    return 'banner';
  }
  const body = error.response.data as { error?: { code?: string } } | undefined;
  if (body?.error?.code === OVERSEAS_DESTINATION_ERROR_CODE) {
    return 'overseas';
  }
  return 'banner';
}

/** 프리필 신뢰 경계 — `rawAmount` 는 서버 응답이고 계약(`integer, nullable`)에 `minimum` 이 없다.
 * 예산으로 성립하는 값(0 이상 정수)일 때만 요약 예산 행·제출 바디에 태운다. `0` 도 포함한다
 * (truthy 가 아니라 `Number.isInteger` 판정이라 걸리지 않는다). */
function isPrefillableBudget(
  value: number | null | undefined
): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** 오늘 날짜 'YYYY-MM-DD'(실시계). `baseDate` 미주입 시의 프로덕션 폴백 — 페이지(배선)라 시계를
 * 읽어도 되지만(화면·순수 함수만 시계 금지, `tripWizardStep1Boundary.test.ts` 스캔 밖), 이 폴백
 * 반환값은 심판이 없다(라우트가 `baseDate`를 안 나름, 02a §3 선재 갭 · `StayRegisterPage` 선례). */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface TripNewStep1PageProps {
  /** 달력 기준 '오늘' 주입점('YYYY-MM-DD') — 기간 편집 시트(S3)의 과거 셀 비활성·이전 달 하한
   * 기준이다. 테스트가 이 값을 주입해 결정론이 된다. 미지정이면 실시계(`todayIso()`)로 폴백한다
   * (프로덕션 경로, `StayRegisterPage` 선례). */
  baseDate?: string;
}

export function TripNewStep1Page({
  baseDate,
}: TripNewStep1PageProps): ReactElement {
  const router = useRouter();
  const resolvedToday = baseDate ?? todayIso();

  // 스토어 드래프트 — 요약 도출·게이트 판정의 재료(읽기 전용 구독). 액션은 편집 시트(S2~S6)가
  // 물므로 default 페이지는 상태만 읽는다.
  const destinations = useTripWizardStore((state) => state.destinations);
  const startDate = useTripWizardStore((state) => state.startDate);
  const endDate = useTripWizardStore((state) => state.endDate);
  const party = useTripWizardStore((state) => state.party);
  const companionType = useTripWizardStore((state) => state.companionType);
  const mustVisits = useTripWizardStore((state) => state.mustVisits);
  const createdTripId = useTripWizardStore((state) => state.createdTripId);
  const setCreatedTripId = useTripWizardStore(
    (state) => state.setCreatedTripId
  );
  // 여행지 편집 시트(TRIP-666)가 즉시 스토어에 쓰는 두 액션(D3 즉시반영) — 시트는 스토어를
  // 모르고, 페이지가 이 둘을 콜백으로 배선해 "적용 없이도 바로 반영"이 성립한다.
  const setNights = useTripWizardStore((state) => state.setNights);
  const removeDestination = useTripWizardStore(
    (state) => state.removeDestination
  );
  // 기간 편집 시트(TRIP-667)가 "적용"에서 쓰는 커밋 액션. 시트는 스토어를 모르고(무상태 D5),
  // 페이지가 이 액션을 콜백으로 배선한다 — 여행지 시트의 즉시반영과 달리 **적용에서만** 커밋한다(D6).
  const setPeriod = useTripWizardStore((state) => state.setPeriod);
  // 동행 편집 시트(TRIP-668)가 "적용"에서 쓰는 두 커밋 액션. 기간 시트와 같은 커밋-온-어플라이 —
  // 드래프트는 아래 `draftParty`/`draftCompanion`(배선 소유)에 쌓이고 여기서만 스토어에 반영된다.
  const setParty = useTripWizardStore((state) => state.setParty);
  const selectCompanion = useTripWizardStore((state) => state.selectCompanion);
  // 취향 편집 시트(TRIP-669)가 "적용"에서 쓰는 커밋 액션 + 현재 오버라이드(요약·제출의 실효
  // 취향을 정하는 단일 값). 시트는 무상태(D3)라 드래프트는 아래 `prefDraftStyles`가 소유한다.
  const prefStyleOverride = useTripWizardStore(
    (state) => state.prefStyleOverride
  );
  const setPrefStyleOverride = useTripWizardStore(
    (state) => state.setPrefStyleOverride
  );
  // 예산 편집 시트(TRIP-670)가 "적용"에서 쓰는 커밋 액션 + 사용자 입력 원문(제출 복원의 재료).
  // S1 이 인라인 예산 블록을 지우며 고아가 된 축을 S6 이 첫 소비한다.
  const storeBudgetText = useTripWizardStore((state) => state.budgetText);
  const setBudgetText = useTripWizardStore((state) => state.setBudgetText);

  const preference = usePreferencePrefill();
  // 계정 취향 프리필(GET /me/preferences)은 이미 한국어 도메인 값이다(slug 아님) — 그대로 요약·
  // 스냅숏에 흐른다. 여행 단위 취향 override(BR-U1-38)는 편집 시트(S5)로 이연했으므로, 지금 실효
  // 취향은 항상 프리필이고 온보딩 상속이다(`fromOnboarding = true`).
  const prefillStyles = preference.data?.styles?.value ?? [];
  const prefillActivities = preference.data?.activities?.value ?? [];
  // 실효 취향(TRIP-669 D2) — 오버라이드가 있으면(빈 `[]` 포함) 그것, 없으면(undefined) 프리필.
  // 요약 취향 행·제출 스냅숏 styles 의 단일 출처다. activities 는 시트가 안 건드려 프리필 원본 유지(D5).
  const effectiveStyles = prefStyleOverride ?? prefillStyles;
  const hasOverride = prefStyleOverride !== undefined;
  const preferenceChips = [...effectiveStyles, ...prefillActivities];

  // 예산은 프리필에서만 온다(인라인 입력은 S6 으로 이연). 신뢰 경계(0 이상 정수)를 통과한 값만
  // 콤마 포맷 → 파싱해 제출 바디의 `budgetTotal` 로 쓴다(`budgetAmount` 순수 함수, 로케일 API 미사용).
  const rawAmount = preference.data?.budget?.rawAmount;
  const tierLabel = preference.data?.budget?.tier ?? undefined;
  const canPrefillBudget = isPrefillableBudget(rawAmount);
  const prefillBudgetText = canPrefillBudget
    ? formatBudgetAmount(rawAmount)
    : '';
  // 제출 복원(TRIP-670 D3) — 사용자가 시트에서 편집한 스토어 값이 유효하면 그것, 아니면 프리필.
  // TRIP-207 "사용자 입력 우선"을 S1(프리필-only)이 되돌린 것을 S6 이 되살린다.
  const effectiveBudgetText =
    parseBudgetAmount(storeBudgetText).kind === 'amount'
      ? storeBudgetText
      : prefillBudgetText;
  const parsedBudget = parseBudgetAmount(effectiveBudgetText);

  // 요약 5행 도출 — 미선택은 셀렉터가 `null` 을 낸다(화면이 플레이스홀더로 그린다).
  const summaryDestinationsValue = summaryDestinations(destinations);
  const summaryPeriodValue = summaryPeriod(startDate, endDate);
  const summaryCompanionValue = summaryCompanion(companionType, party);
  // 오버라이드가 있으면 "+ 온보딩" 접미를 뗀다(D4 — 바꿨는데 "온보딩" 표식이 남으면 거짓).
  const summaryPreferencesValue = summaryPreferences(
    preferenceChips,
    !hasOverride
  );
  // 요약 예산 행은 effective(편집값 우선, 아니면 프리필)를 쓴다 — 자매 4행과 정합.
  // rawAmount(프리필)만 쓰면 시트에서 바꿔도 요약이 안 바뀌어 "편집이 안 먹는" 것처럼 보인다(TRIP-670 5-c).
  const summaryBudgetValue =
    parsedBudget.kind === 'amount'
      ? summaryBudget(parsedBudget.amount, tierLabel)
      : null;

  const [submitError, setSubmitError] = useState<string>();
  const [overseasBlocked, setOverseasBlocked] = useState(false);
  const [mustVisitError, setMustVisitError] = useState<string>();
  const [pendingMustVisits, setPendingMustVisits] = useState<string[]>([]);
  // 여행지 편집 시트 개폐(TRIP-666) — 배선이 소유한다(화면은 무상태 D5). 시트는 화면의 형제로
  // 조건부 마운트한다(화면 슬롯 금지 — 화면 단독 렌더에서 시트/도시추가가 안 떠야 하는 프리즈 2건).
  const [destinationSheetOpen, setDestinationSheetOpen] = useState(false);
  // 기간 편집 시트(TRIP-667) — 시트가 무상태(★1)라 개폐·보는 달·고른 범위를 전부 배선이 소유한다.
  // `periodMonth`는 today 의 달로 시작하고(달 초기값은 마운트 1회), 셀 탭은 `applyRangePick`으로
  // `periodRange`를 전이시켜 시트를 재렌더한다(전이가 여기서만 일어난다).
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(() =>
    resolvedToday.slice(0, 7)
  );
  const [periodRange, setPeriodRange] = useState<TripDateRange>({});
  // 동행 편집 시트(TRIP-668) — 시트가 무상태(D4)라 개폐·편집 드래프트를 배선이 소유한다.
  // 열 때 store 현재값에서 초기화하고(D3 프리필), 스테퍼·칩 press 는 이 드래프트만 갱신한다
  // (적용 전 store 불변) — "적용"에서만 `setParty`+`selectCompanion` 으로 커밋한다.
  const [companionSheetOpen, setCompanionSheetOpen] = useState(false);
  const [draftParty, setDraftParty] = useState(1);
  const [draftCompanion, setDraftCompanion] = useState<CompanionType>();
  // 취향 편집 시트(TRIP-669) — 시트가 무상태(D3)라 개폐·편집 드래프트를 배선이 소유한다.
  // 열 때 실효 취향(오버라이드 ?? 프리필)에서 초기화하고, 칩 press 는 이 드래프트만 전이시킨다
  // (적용 전 store 불변) — "적용"에서만 `setPrefStyleOverride` 로 커밋한다.
  const [prefSheetOpen, setPrefSheetOpen] = useState(false);
  const [prefDraftStyles, setPrefDraftStyles] = useState<string[]>([]);
  // 예산 편집 시트(TRIP-670) — 시트가 무상태(D4)라 개폐·편집 드래프트를 배선이 소유한다.
  // 열 때 effective 예산 문자열·프리필 tier 에서 초기화하고, 금액/tier press 는 이 드래프트만
  // 갱신한다(적용 전 store 불변) — "적용"에서만 `setBudgetText` 로 커밋한다(tier 는 커밋 안 함).
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [draftAmountText, setDraftAmountText] = useState('');
  const [draftTier, setDraftTier] = useState<string>();

  // 제출 경로 잠금(useRef — 상태와 달리 같은 틱에 즉시 읽힌다, 연타 두 번째가 옛 값을 읽지
  // 않게). 두 뜻을 겸한다: ① 등록 요청이 날아가는 중 ② 이미 성공해 이 화면의 일이 끝남.
  const submitLockedRef = useRef(false);
  // 2/2 로 넘어간 적이 있는가 — `[다음]` 재탭을 이동으로 돌려보내는 문이 본다.
  const navigatedRef = useRef(false);

  const createTrip = useCreateTrip();

  const isAuthed = getAccessToken() !== null;
  const savedPlaces = useSavedPlaces({ isAuthed });
  // ⚠️ 게스트는 `enabled: isAuthed` 라 요청이 안 나가고 `isPending` 이 영원히 true 다 — 그대로
  // 게이트에 태우면 비회원이 여행을 영영 못 만든다. `isAuthed &&` 로 접어 "정말 조회 중"만 막는다.
  const savedPlacesLoading = isAuthed && savedPlaces.isPending;
  const savedPlaceList = savedPlaces.savedPlaces;

  // loading 얼굴 신호(TRIP-671 D4) — 프리필·담은목록 중 하나라도 조회 중이면 화면을 스켈레톤으로
  // 갈아 끼운다(combined, Figma 가 단일 "불러오는 중" 부제라 두 조회를 한 플래그로 접는다). 게스트는
  // `savedPlacesLoading` 가 이미 접혀 있어(위 참조) 담은목록 축이 영구 pending 으로 새지 않는다.
  const isLoading = preference.isPending || savedPlacesLoading;

  const draft: TripDraft = {
    destinations,
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    party,
  };
  const violations = validateTripDraft(draft);

  const periodFilled =
    startDate !== undefined &&
    startDate !== '' &&
    endDate !== undefined &&
    endDate !== '';

  // 담은 목록 도착 전이면 잠깐 막는다(BR-U1-55 침묵 실패 회피) — 그때 제출하면 시드가 비어 꼭
  // 갈 곳이 한 건도 등록되지 않은 여행이 조용히 만들어진다. 게스트 예외는 위 `savedPlacesLoading`.
  const canProceed =
    destinations.length > 0 &&
    periodFilled &&
    violations.length === 0 &&
    parsedBudget.kind !== 'invalid' &&
    !savedPlacesLoading;

  // 드래프트가 바뀌면 옛 제출 실패 배너를 걷는다(화면과 배너가 서로 다른 이야기를 하지 않게).
  // 편집은 S2~S6 스텁이라 지금은 스토어 seed 로만 바뀌지만, 배너 배선 계약은 유지한다.
  useEffect(() => {
    setSubmitError(undefined);
  }, [destinations, startDate, endDate, party, companionType]);

  /**
   * 여행이 만들어진 **뒤** 남은 시드를 등록한다(BR-U1-48 `ANYTIME` 고정).
   * `Promise.allSettled` — "3곳 중 1곳 실패"를 세어 문구로 만들어야 해 `all`(하나 실패 시 즉시
   * 던짐)로는 만들 수 없다. 실패해도 여행을 롤백하지 않는다(BR-U1-51) — 이동만 멈추고 배너를 세운다.
   */
  async function registerMustVisits(
    tripId: string,
    poiIds: string[]
  ): Promise<void> {
    if (submitLockedRef.current) return;
    submitLockedRef.current = true;

    const results = await Promise.allSettled(
      poiIds.map((poiId) =>
        postTripsTripIdMustVisits(tripId, { poiId, type: 'ANYTIME' })
      )
    );
    const stillFailed = poiIds.filter((_, index) => {
      const result = results[index];
      return (
        result.status === 'rejected' && !isAlreadyRegistered(result.reason)
      );
    });

    setPendingMustVisits(stillFailed);
    if (stillFailed.length > 0) {
      // 화면에 남아 배너를 보여준다 — 여기서만 잠금을 푼다(배너의 [다시 시도]가 다시 타야 하므로).
      submitLockedRef.current = false;
      setMustVisitError(
        mustVisitFailureNotice(poiIds.length, stillFailed.length)
      );
      return;
    }

    setMustVisitError(undefined);
    // 성공 — 잠금을 **풀지 않는다**(스택에 남은 step1 으로 되돌아와 재탭해도 여행이 하나 더
    // 만들어지면 안 된다). 다만 죽어 보이지 않게 이동만은 다시 하도록 이동 사실을 기록한다.
    navigatedRef.current = true;
    router.push('/trips/new/step2');
  }

  function retryMustVisits(): void {
    if (createdTripId === undefined || pendingMustVisits.length === 0) return;
    void registerMustVisits(createdTripId, pendingMustVisits);
  }

  async function submit(): Promise<void> {
    // 이미 넘어간 뒤면 새로 만들지 않고 그 여행의 2/2 로 다시 보낸다. 조건이 `submitLockedRef`
    // 가 아니라 `navigatedRef` 인 이유: 잠금은 등록이 날아가는 중에도 켜져 있어 그것으로 열면
    // 등록이 끝나기 전에 2/2 로 새어 나간다.
    if (navigatedRef.current) {
      router.push('/trips/new/step2');
      return;
    }
    if (!canProceed || createTrip.isPending || submitLockedRef.current) return;

    // 여행은 이미 만들어졌고 등록만 남았으면(재시도 경로) 여행을 또 안 만들고 남은 등록만 잇는다.
    if (createdTripId !== undefined && pendingMustVisits.length > 0) {
      await registerMustVisits(createdTripId, pendingMustVisits);
      return;
    }

    setSubmitError(undefined);
    setOverseasBlocked(false);

    // `CreateTripRequest`(변수)로 타이핑해야 `preferenceSnapshot` 을 실을 수 있다 —
    // `CreateTripInput`(Omit)은 그 키를 리터럴에서 막는다.
    const input: CreateTripRequest = {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      party,
      companionType,
      destinations,
      // 예산은 effective(사용자 입력 우선, 미입력 시 프리필)로 나간다(TRIP-670 D3 복원). `empty`·
      // `invalid` 면 `undefined` 라 키가 안 붙는다(`buildCreateTripRequest` 가 조건부로 다시 붙인다).
      budgetTotal:
        parsedBudget.kind === 'amount' ? parsedBudget.amount : undefined,
      // 취향 스냅숏(정책 A) — 실효 취향(오버라이드 ?? 프리필)을 평평한 한국어 배열로 싣는다
      // (BE 는 받은 것만 저장하고 스스로 동결하지 않는다). 요약 취향 행과 같은 출처라 화면=서버가
      // 맞는다. activities 는 시트가 안 건드려 프리필 원본을 그대로 싣는다(D5).
      preferenceSnapshot: {
        styles: effectiveStyles,
        activities: prefillActivities,
      },
    };

    // `try` 의 사정거리를 요청 한 줄로 좁힌다 — 성공 뒤 부작용에서 난 예외까지 여기서 받으면
    // 이미 만들어진 여행이 "네트워크 실패"로 보이고 다시 시도가 여행을 하나 더 만든다.
    let trip: Awaited<ReturnType<typeof createTrip.mutateAsync>>;
    try {
      trip = await createTrip.mutateAsync({
        data: buildCreateTripRequest(input),
      });
    } catch (error) {
      const failure = classifyServerFailure(error);
      if (failure === 'overseas') {
        setOverseasBlocked(true);
      } else {
        setSubmitError(SUBMIT_ERROR_MESSAGE);
      }
      return;
    }

    // g02(TRIP-84·TRIP-193)가 읽는 소비자 — 라우트가 id 를 안 나른다.
    setCreatedTripId(trip.tripId);

    // ↓ 여기서부터는 위 `try` 바깥이다. 여행은 이미 만들어졌으므로 아래 실패는 등록 실패다.
    // ⚠️ 시드를 여기서 **다시 읽는다** — `await` 동안 담은 목록이 도착해 늘어도 `[다음]`을 누른
    // 순간 렌더의 옛 값이 아니라 지금 값을 싣는다.
    await registerMustVisits(
      trip.tripId,
      useTripWizardStore.getState().mustVisits.map((seed) => seed.sourcePoiId)
    );
  }

  /** 예산 시트 열기 — 드래프트를 effective 예산 문자열(스토어 유효 ? 스토어 : 프리필)·프리필 tier 에서
   * 초기화한다(D3). 스토어는 `getState()`로 여는 순간 값을 읽고(`openCompanionSheet` 선례), 프리필은
   * render 클로저값(react-query 라 store 를 안 타 클로저가 곧 최신값). */
  function openBudgetSheet(): void {
    const currentBudgetText = useTripWizardStore.getState().budgetText;
    setDraftAmountText(
      parseBudgetAmount(currentBudgetText).kind === 'amount'
        ? currentBudgetText
        : prefillBudgetText
    );
    setDraftTier(tierLabel);
    setBudgetSheetOpen(true);
  }

  /** "적용" — 드래프트 금액을 store 에 커밋(`setBudgetText`) + 닫기. tier 는 커밋 대상이 아니다
   * (honest — 스토어·요청 어디에도 안 감, 표시·프리필 축 전용). */
  function applyBudget(): void {
    setBudgetText(draftAmountText);
    setBudgetSheetOpen(false);
  }

  /** 동행 시트 열기 — 드래프트를 store 현재값에서 초기화한다(D3 프리필). 렌더 클로저가 아니라
   * `getState()`로 **여는 순간의** store 값을 읽는다(구독 재렌더 타이밍과 무관, `submit()`과 동형). */
  function openCompanionSheet(): void {
    const state = useTripWizardStore.getState();
    setDraftParty(state.party);
    setDraftCompanion(state.companionType);
    setCompanionSheetOpen(true);
  }

  /** 혼자 선택 시 draftParty 를 1 로 고정(D2 — 시트는 `disabled` 파생만, 값 고정은 배선). */
  function pickCompanion(type: CompanionType): void {
    setDraftCompanion(type);
    if (type === '혼자') setDraftParty(1);
  }

  /** "적용" — 드래프트를 store 에 커밋(각 1회) + 닫기. 동행 미선택이면 `selectCompanion` 은
   * 안 부른다(companionType 이 optional, 타입 좁히기 겸 발명 회피 — 02a §8-3). */
  function applyCompanion(): void {
    setParty(draftParty);
    if (draftCompanion !== undefined) selectCompanion(draftCompanion);
    setCompanionSheetOpen(false);
  }

  /** 취향 시트 열기 — 드래프트를 실효 취향에서 초기화한다(effective = 오버라이드 ?? 프리필, AC-2).
   * 오버라이드는 `getState()`로 여는 순간 값을 읽고(store 직접 세팅 직후 press 대비, `openCompanionSheet`
   * 선례), 프리필은 render 클로저값(react-query 라 store 를 안 타 클로저가 곧 최신값이다). */
  function openPrefSheet(): void {
    const override = useTripWizardStore.getState().prefStyleOverride;
    setPrefDraftStyles([...(override ?? prefillStyles)]);
    setPrefSheetOpen(true);
  }

  /** 칩 토글 — `toggleMulti` 의 전해제 `null` 을 `[]` 로 매핑한다(★ null-vs-empty, D2). 안 하면
   * 드래프트가 null 이 되고 적용 시 `effectiveStyles = null ?? prefill` 로 프리필로 되돌아간다. */
  function togglePrefStyle(label: string): void {
    setPrefDraftStyles((current) => toggleMulti(current, label) ?? []);
  }

  /** "적용" — 드래프트를 오버라이드로 커밋(빈 `[]` 도 그대로) + 닫기. */
  function applyPrefSheet(): void {
    setPrefStyleOverride(prefDraftStyles);
    setPrefSheetOpen(false);
  }

  /** "적용" — 범위가 완성됐을 때만 커밋한다(시트가 미완성이면 버튼이 진짜 disabled 라 여긴 안전
   * 이중 방어 겸 TS 좁히기). `setPeriod`가 프리셋 없이(undefined) start·end 를 저장하고 시트를 닫는다. */
  function applyPeriod(): void {
    if (periodRange.start === undefined || periodRange.end === undefined)
      return;
    setPeriod(undefined, periodRange.start, periodRange.end);
    setPeriodSheetOpen(false);
  }

  return (
    <>
      <TripWizardStep1Screen
        summaryDestinations={summaryDestinationsValue}
        summaryPeriod={summaryPeriodValue}
        summaryCompanion={summaryCompanionValue}
        summaryPreferences={summaryPreferencesValue}
        summaryBudget={summaryBudgetValue}
        onPressSummaryDestination={() => setDestinationSheetOpen(true)}
        onPressSummaryPeriod={() => setPeriodSheetOpen(true)}
        onPressSummaryCompanion={openCompanionSheet}
        onPressSummaryPreference={openPrefSheet}
        onPressSummaryBudget={openBudgetSheet}
        mustVisits={mustVisits}
        onPressMore={() =>
          // 담은 곳이 있으면 담은 장소 화면(d02)으로, 없으면 새로 담을 탐색으로 보낸다(TRIP-367).
          router.push(
            savedPlaceList.length > 0
              ? '/explore/saved-places'
              : '/explore/places'
          )
        }
        onPressSeeAll={() => router.push('/trips/new/must-visits')}
        canProceed={canProceed}
        onNext={submit}
        onBack={() => router.back()}
        isLoading={isLoading}
        submitError={submitError}
        onRetrySubmit={submit}
        mustVisitError={mustVisitError}
        onRetryMustVisits={retryMustVisits}
        overseasBlocked={overseasBlocked}
        onCloseOverseasDialog={() => setOverseasBlocked(false)}
        onPickDomesticRegion={() => setOverseasBlocked(false)}
      />
      {/* 시트는 화면의 형제로 조건부 마운트 — 스테퍼·삭제는 스토어에 즉시 쓰고(D3), "적용"은
          닫기뿐이다(재커밋 없음). 도시 추가는 지역 카탈로그 라우트로 이탈한다. */}
      {destinationSheetOpen ? (
        <DestinationEditSheet
          destinations={destinations}
          onChangeNights={setNights}
          onRemove={removeDestination}
          onAddCity={() => router.push('/explore/region?purpose=trip')}
          onApply={() => setDestinationSheetOpen(false)}
        />
      ) : null}
      {/* 기간 편집 시트도 화면의 형제로 조건부 마운트 — 셀 탭은 배선의 `applyRangePick`으로 범위를
          전이시키고, "적용"에서만 스토어에 커밋한다(여행지 시트의 즉시반영과 반대, D6). */}
      {periodSheetOpen ? (
        <PeriodEditSheet
          today={resolvedToday}
          month={periodMonth}
          range={periodRange}
          onPickDate={(date) =>
            setPeriodRange((current) => applyRangePick(current, date))
          }
          onPrevMonth={() =>
            setPeriodMonth((current) => shiftMonth(current, -1))
          }
          onNextMonth={() =>
            setPeriodMonth((current) => shiftMonth(current, 1))
          }
          onApply={applyPeriod}
        />
      ) : null}
      {/* 동행 편집 시트도 화면의 형제로 조건부 마운트 — 스테퍼·칩 press 는 드래프트만 바꾸고
          (적용 전 store 불변), "적용"에서만 커밋한다(기간 시트와 같은 커밋-온-어플라이, D1). */}
      {companionSheetOpen ? (
        <CompanionEditSheet
          party={draftParty}
          companionType={draftCompanion}
          onChangeParty={(next) => setDraftParty(Math.max(1, next))}
          onSelectCompanion={pickCompanion}
          onApply={applyCompanion}
        />
      ) : null}
      {/* 취향 편집 시트도 화면의 형제로 조건부 마운트 — 칩 press 는 배선의 `toggleMulti`(null→[])로
          드래프트만 전이시키고, "적용"에서만 오버라이드로 커밋한다(동행 시트와 같은 커밋-온-어플라이). */}
      {prefSheetOpen ? (
        <PrefOverrideSheet
          selected={prefDraftStyles}
          onToggle={togglePrefStyle}
          onApply={applyPrefSheet}
        />
      ) : null}
      {/* 예산 편집 시트도 화면의 형제로 조건부 마운트 — tier·금액 press 는 드래프트만 바꾸고
          (적용 전 store 불변), "적용"에서만 `setBudgetText` 로 커밋한다(커밋-온-어플라이). tier 는
          어디에도 커밋/전송 안 한다(honest — 표시·프리필 축 전용). */}
      {budgetSheetOpen ? (
        <BudgetEditSheet
          amountText={draftAmountText}
          tier={draftTier}
          onChangeAmount={setDraftAmountText}
          onSelectTier={setDraftTier}
          onApply={applyBudget}
        />
      ) : null}
    </>
  );
}
