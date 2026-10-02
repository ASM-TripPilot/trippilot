import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useSavedPlaces } from '@/features/save-place/model/savedPlaces';
import { regionPickerHref } from '@/features/explore/model/regionPickerPurpose';
import { wizardOriginParams } from '@/features/create-trip/model/wizardOrigin';
import {
  deleteTripsTripId,
  deleteTripsTripIdMustVisitsMustVisitId,
  getGetTripsQueryKey,
  getTripsTripIdMustVisits,
  patchTripsTripId,
  postTripsTripIdMustVisits,
} from '@/shared/api/generated/trips/trips';
import type {
  CompanionType,
  CreateTripRequest,
  MustVisit,
} from '@/shared/api/generated/schemas';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { isNotFound } from '@/shared/api/isNotFound';
import { getAccessToken } from '@/shared/api/tokenManager';
import { seoulDate } from '@/shared/date/seoulDate';
import { shiftMonth } from '@/shared/date/monthGrid';
import { toggleMulti } from '@/shared/pref/preferenceSelection';
import { showToast } from '@/shared/ui/Toast';

import {
  budgetForTier,
  formatBudgetAmount,
  isBudgetTier,
  parseBudgetAmount,
  tierForAmount,
  type BudgetTier,
} from '../model/budgetAmount';
import {
  buildCreateTripRequest,
  type CreateTripInput,
} from '../model/createTripRequest';
import {
  nightsSum,
  validateTripDraft,
  type TripDraft,
} from '@/features/create-trip/model/tripDraft';
import { deriveEndDate } from '@/features/create-trip/model/tripWizardStep1';
import { mustVisitFailureNotice } from '@/features/create-trip/model/mustVisitSeed';
import { planMustVisitSync } from '../model/mustVisitSync';
import {
  summaryBudget,
  summaryCompanion,
  summaryDestinations,
  summaryPeriod,
  summaryPreferences,
} from '@/features/create-trip/model/tripSummary';
import { useTripWizardStore } from '@/features/create-trip/model/tripWizardStore';
import { useCreateTrip } from '../model/useCreateTrip';
import { usePreferencePrefill } from '../model/usePreferencePrefill';
import { CompanionEditSheet } from './CompanionEditSheet';
import { DestinationEditSheet } from './DestinationEditSheet';
import { PeriodEditSheet } from './PeriodEditSheet';
import { TripWizardLeaveDialog } from './TripWizardLeaveDialog';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';

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
 *  5. **이미 만든 여행(TRIP-1113)** — 스토어에 `createdTripId`가 있으면 `[다음]`은 새로 만들지 않고
 *     `PATCH /trips/{id}`로 고친 뒤, 서버 꼭 갈 곳을 시드에 맞춘다(`planMustVisitSync` — 추가·삭제).
 *     PATCH 는 대체 의미라 본문은 생성과 같은 전체 값이고, 취향 스냅숏은 계약에 없어 싣지 않는다 —
 *     그래서 그 여행의 취향 행은 잠근다(토스트로 이유를 알린다).
 *
 * 의심할 지점: 요약 5행 문자열 도출·게이트·제출 바디는 이 파일의 조립 로직이라 렌더 테스트가
 * 왕복으로 잡는다. 반면 편집 시트 오픈 콜백은 스텁(S2~S6)이라 지금은 신호만 위로 올린다.
 */

/** 서버 400 의 `error.code` 가 국내 밖 목적지를 가리키는 값. openapi 에 enum 이 없어 **발명값**이다
 * (01b D4) — BE 확인 뒤 이 상수 한 줄만 바꾸면 된다. */
const OVERSEAS_DESTINATION_ERROR_CODE = 'OVERSEAS_DESTINATION';

/** 이미 만든 여행의 취향 행을 눌렀을 때 — PATCH 계약에 취향 스냅숏이 없어 바꿔도 반영되지 않는다
 * (TRIP-1113 결정 1, 발명 문구). */
const PREF_LOCKED_MESSAGE = '이미 만든 여행은 취향을 바꿀 수 없어요';

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

/** 요약 행·시트 재오픈 칩의 등급(TRIP-1091) — 스토어에 커밋된 금액이 > 0 이면 그 금액의 역산 등급,
 * 아니면(미적용·0·invalid) 프리필 tier. 프리필 금액은 역산하지 않는다 — 한 번도 안 건드린 여행은
 * 온보딩 등급 그대로다(서버는 rawAmount·tier 정합을 검사하지 않는다). */
function appliedBudgetTier(
  storeText: string,
  prefillTier: string | undefined
): string | undefined {
  const applied = parseBudgetAmount(storeText);
  return applied.kind === 'amount' && applied.amount > 0
    ? tierForAmount(applied.amount)
    : prefillTier;
}

/** 위저드를 나간 뒤 뒤로 갈 곳이 없을 때(딥링크 진입) 가는 곳 — `ItineraryPlanPage` 선례. */
const HOME_FALLBACK = '/(tabs)';

/**
 * TRIP-1114 · 이탈 확인 다이얼로그의 요청·잠금 배선. 다이얼로그가 열릴 때만 마운트된다 —
 * `useQueryClient` 를 페이지 본체에서 부르면 provider 없이 페이지를 그리는 노드 테스트가 던진다.
 *
 * - 나가기(저장)나 삭제를 누르면 세 버튼을 모두 잠근다(`lockedRef`). 상태가 아니라 ref 라 같은 틱
 *   두 번째 누름에도 이미 켜진 값을 읽고, 누름 가드(400ms)가 닫힌 뒤의 탭도 막는다. 저장 연타(01b Q7)도
 *   이 잠금이 막는다.
 * - 204·404(이미 없음)면 `createdTripId` 만 비우고(드래프트 유지, BR-U1-33) 목록 캐시를 무효화한다.
 *   500·네트워크면 잠금을 풀고 실패 문구를 띄운다 — 다시 누르면 다시 보낸다(INV-4).
 * - 화면이 먼저 사라졌으면(스와이프 이탈) 응답이 와도 이동하지 않는다(`mountedRef`). 지워진 것은
 *   사실이라 id 비우기·무효화는 그래도 한다.
 */
function LeaveDialogContainer({
  tripId,
  onExit,
  onStay,
}: {
  tripId: string;
  onExit: () => void;
  onStay: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const lockedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function save(): void {
    if (lockedRef.current) return;
    lockedRef.current = true;
    onExit();
  }

  function remove(): void {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setFailed(false);
    // 삭제는 끝났다 — 이동을 먼저 하고 그다음 정리한다. id 비우기는 다음 렌더에서 이 컨테이너를
    // 내리므로 지금 순서를 뒤집어도 이동은 일어난다(5-b 실측) — 순서는 읽기 쉬움을 위한 것이고
    // 이 순서를 잠그는 테스트는 없다.
    const done = (): void => {
      if (mountedRef.current) onExit();
      useTripWizardStore.setState({ createdTripId: undefined });
      queryClient.invalidateQueries({ queryKey: getGetTripsQueryKey() });
    };
    deleteTripsTripId(tripId).then(done, (error: unknown) => {
      if (isNotFound(error)) {
        done();
        return;
      }
      lockedRef.current = false;
      if (mountedRef.current) setFailed(true);
    });
  }

  return (
    <TripWizardLeaveDialog
      failed={failed}
      onSave={save}
      onDelete={remove}
      onStay={() => {
        if (!lockedRef.current) onStay();
      }}
    />
  );
}

export interface TripNewStep1PageProps {
  /** 달력 기준 '오늘' 주입점('YYYY-MM-DD') — 기간 편집 시트(S3)의 과거 셀 비활성·이전 달 하한
   * 기준이다. 테스트가 이 값을 주입해 결정론이 된다. 미지정이면 실시계(`seoulDate`·KST)로 폴백한다
   * (프로덕션 경로, `StayRegisterPage` 선례). */
  baseDate?: string;
}

export function TripNewStep1Page({
  baseDate,
}: TripNewStep1PageProps): ReactElement {
  const router = useRouter();
  const resolvedToday = baseDate ?? seoulDate(new Date());

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
  // TRIP-1027: 시작만 커밋한다 — 끝은 스토어가 `시작 + Σnights`로 파생한다.
  const setStartDate = useTripWizardStore((state) => state.setStartDate);
  // 동행 편집 시트(TRIP-668)가 "적용"에서 쓰는 두 커밋 액션. 기간 시트와 같은 커밋-온-어플라이 —
  // 드래프트는 아래 `draftParty`/`draftCompanion`(배선 소유)에 쌓이고 여기서만 스토어에 반영된다.
  const setParty = useTripWizardStore((state) => state.setParty);
  const selectCompanion = useTripWizardStore((state) => state.selectCompanion);
  // 취향 편집 시트(TRIP-669)가 "적용"에서 쓰는 커밋 액션 + 현재 오버라이드(요약·제출의 실효
  // 취향을 정하는 값, 축마다 하나 — TRIP-1092). 시트는 무상태(D3)라 드래프트는 아래 `prefDraft*`가 소유한다.
  const prefStyleOverride = useTripWizardStore(
    (state) => state.prefStyleOverride
  );
  const setPrefStyleOverride = useTripWizardStore(
    (state) => state.setPrefStyleOverride
  );
  const prefActivityOverride = useTripWizardStore(
    (state) => state.prefActivityOverride
  );
  const setPrefActivityOverride = useTripWizardStore(
    (state) => state.setPrefActivityOverride
  );
  // 예산 편집 시트(TRIP-670)가 "적용"에서 쓰는 커밋 액션 + 사용자 입력 원문(제출 복원의 재료).
  // S1 이 인라인 예산 블록을 지우며 고아가 된 축을 S6 이 첫 소비한다.
  const storeBudgetText = useTripWizardStore((state) => state.budgetText);
  const setBudgetText = useTripWizardStore((state) => state.setBudgetText);

  const preference = usePreferencePrefill();
  // 계정 취향 프리필(GET /me/preferences)은 이미 한국어 도메인 값이다(slug 아님) — 그대로 요약·
  // 스냅숏에 흐른다. 여행 단위 취향 override(BR-U1-38)는 편집 시트(TRIP-669)가 소유한다 — 실효 취향은
  // 오버라이드 ?? 프리필이다(아래 `effectiveStyles`). 시트의 `fromOnboarding` 은 프리필 유무로 정해진다.
  const prefillStyles = preference.data?.styles?.value ?? [];
  const prefillActivities = preference.data?.activities?.value ?? [];
  // 실효 취향(TRIP-669 D2) — 축마다 오버라이드가 있으면(빈 `[]` 포함) 그것, 없으면(undefined) 프리필.
  // 요약 취향 행·제출 스냅숏의 단일 출처다(TRIP-1092: activities 도 시트가 덮어쓴다 — D5 폐기).
  const effectiveStyles = prefStyleOverride ?? prefillStyles;
  const effectiveActivities = prefActivityOverride ?? prefillActivities;
  const hasOverride =
    prefStyleOverride !== undefined || prefActivityOverride !== undefined;
  // 자연·쇼핑은 두 축에 같은 라벨로 있다 — 행에는 한 번만(styles 먼저, Set 은 첫 등장 순서 유지).
  const preferenceChips = [
    ...new Set([...effectiveStyles, ...effectiveActivities]),
  ];
  const prefFromOnboarding =
    prefillStyles.length > 0 || prefillActivities.length > 0;

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
  const budgetTierLabel = appliedBudgetTier(storeBudgetText, tierLabel);

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
  // 세 갈래(TRIP-732):
  //  · 금액 > 0 → 금액 2톤("120만원 · 1인 총액 · {tier}").
  //  · 프리필 금액이 **아예 없고**(kind==='empty') tier 만 있으면 → tier-only(empty 얼굴
  //    "중간 · 1인 총액 · 온보딩"). 금액도 tier 도 없으면 셀렉터가 null 을 낸다.
  //  · 명시적 0(kind==='amount' && amount===0)·invalid → null="예산 선택". rawAmount=0 은 "미선택"이라
  //    표시=제출 대칭이 유지된다(budgetSheet AC-S6D-1 — 0 이면 요약도 "예산 선택", 제출도 미전송).
  const summaryBudgetValue =
    parsedBudget.kind === 'amount' && parsedBudget.amount > 0
      ? summaryBudget(parsedBudget.amount, budgetTierLabel)
      : parsedBudget.kind === 'empty'
        ? summaryBudget(0, tierLabel)
        : null;

  const [submitError, setSubmitError] = useState<string>();
  const [overseasBlocked, setOverseasBlocked] = useState(false);
  const [mustVisitError, setMustVisitError] = useState<string>();
  const [pendingMustVisits, setPendingMustVisits] = useState<string[]>([]);
  // 여행지 편집 시트 개폐(TRIP-666) — 배선이 소유한다(화면은 무상태 D5). 시트는 화면의 형제로
  // 조건부 마운트한다(화면 슬롯 금지 — 화면 단독 렌더에서 시트/도시추가가 안 떠야 하는 프리즈 2건).
  const [destinationSheetOpen, setDestinationSheetOpen] = useState(false);
  // 기간 편집 시트(TRIP-667) — 시트가 무상태(★1)라 개폐·보는 달·고른 시작을 전부 배선이 소유한다.
  // `periodMonth`는 today 의 달로 시작한다(달 초기값은 마운트 1회). TRIP-1027: 셀 탭은 매번 새
  // 시작이고, 시트에 보이는 끝은 `시작 + 지금 Σnights`다(사용자가 끝을 고르지 않는다).
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [periodMonth, setPeriodMonth] = useState(() =>
    resolvedToday.slice(0, 7)
  );
  const [periodStart, setPeriodStart] = useState<string>();
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
  const [prefDraftActivities, setPrefDraftActivities] = useState<string[]>([]);
  // 예산 편집 시트(TRIP-670) — 시트가 무상태(D4)라 개폐·편집 드래프트를 배선이 소유한다.
  // 열 때 effective 예산 문자열·`appliedBudgetTier`(커밋 금액 역산 ?? 프리필 tier)에서 초기화하고, 금액/tier press 는 이 드래프트만
  // 갱신한다(적용 전 store 불변) — "적용"에서만 `setBudgetText` 로 커밋한다(tier 는 커밋 안 함).
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [draftAmountText, setDraftAmountText] = useState('');
  const [draftTier, setDraftTier] = useState<string>();
  const draftBudget = parseBudgetAmount(draftAmountText);
  const draftBudgetKind = draftBudget.kind;

  // 제출 경로 잠금(useRef — 상태와 달리 같은 틱에 즉시 읽힌다, 연타 두 번째가 옛 값을 읽지
  // 않게). 요청(등록·PATCH·동기화)이 날아가는 동안만 켜진다 — 성공 뒤에는 풀어 둬야 step2 에서
  // 돌아와 값을 바꾼 `[다음]`이 PATCH 로 나간다(TRIP-1113 AC-2b).
  const submitLockedRef = useRef(false);

  // 이탈 확인(TRIP-1114) — 이 세션에서 이미 여행을 만들었을 때만 ‹ 가 다이얼로그를 연다.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const exitWizard = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(HOME_FALLBACK);
  };

  const createTrip = useCreateTrip();

  const isAuthed = getAccessToken() !== null;
  const savedPlaces = useSavedPlaces({ isAuthed });
  // ⚠️ 게스트는 `enabled: isAuthed` 라 요청이 안 나가고 `isPending` 이 영원히 true 다 — 그대로
  // 게이트에 태우면 비회원이 여행을 영영 못 만든다. `isAuthed &&` 로 접어 "정말 조회 중"만 막는다.
  const savedPlacesLoading = isAuthed && savedPlaces.isPending;

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
    // 성공 — 잠금을 푼다. 되돌아와 재탭해도 여행이 또 생기지 않는 것은 이제 `createdTripId`가
    // 막는다(아래 `submit` 이 PATCH 로 보낸다, TRIP-1113).
    submitLockedRef.current = false;
    router.push('/trips/new/step2');
  }

  /** 요청이 끝날 때까지(성공·실패 무관) 제출 경로를 잠근다 — 이미 잠겨 있으면 아무것도 안 한다. */
  async function withSubmitLock(task: () => Promise<void>): Promise<void> {
    if (submitLockedRef.current) return;
    submitLockedRef.current = true;
    try {
      await task();
    } finally {
      submitLockedRef.current = false;
    }
  }

  /**
   * 이미 만든 여행의 꼭 갈 곳(서버)을 지금 시드에 맞춘 뒤 2/2 로 간다(TRIP-1113 AC-3). 서버 목록을
   * **매번 새로 조회**해 계획하므로 [다시 시도]는 저절로 남은 차이만 보낸다. 실패는 전부 꼭 갈 곳
   * 배너 하나로 모은다 — 조회 실패는 무엇이 남았는지 모르니 시드 전부를 실패로 센다(01b Q5), 삭제
   * 실패도 같은 문구에 합산한다(01b Q4 — "등록" 어휘는 새 티켓 후보). 추가 409 는 목표 상태라 성공이다.
   */
  async function syncMustVisits(tripId: string): Promise<void> {
    const seedPoiIds = useTripWizardStore
      .getState()
      .mustVisits.map((seed) => seed.sourcePoiId);
    let registered: MustVisit[];
    try {
      registered = await getTripsTripIdMustVisits(tripId);
    } catch {
      setMustVisitError(
        mustVisitFailureNotice(seedPoiIds.length, seedPoiIds.length)
      );
      return;
    }

    const plan = planMustVisitSync({ registered, seedPoiIds });
    const [added, deleted] = await Promise.all([
      Promise.allSettled(
        plan.toAdd.map((poiId) =>
          postTripsTripIdMustVisits(tripId, { poiId, type: 'ANYTIME' })
        )
      ),
      Promise.allSettled(
        plan.toDelete.map((mustVisitId) =>
          deleteTripsTripIdMustVisitsMustVisitId(tripId, mustVisitId)
        )
      ),
    ]);
    const failed =
      added.filter(
        (result) =>
          result.status === 'rejected' && !isAlreadyRegistered(result.reason)
      ).length +
      deleted.filter((result) => result.status === 'rejected').length;

    if (failed > 0) {
      setMustVisitError(
        mustVisitFailureNotice(added.length + deleted.length, failed)
      );
      return;
    }
    setMustVisitError(undefined);
    router.push('/trips/new/step2');
  }

  /** 이미 만든 여행을 화면 값으로 고친다(TRIP-1113 AC-1·2). PATCH 가 실패하면 사유와 무관하게 제출
   * 배너 하나다(결정 3) — 그 [다시 시도]는 다시 여기로 온다(여행을 새로 만들지 않는다). 동기화는
   * PATCH 가 성공한 **뒤에만** 한다. */
  async function editTrip(tripId: string): Promise<void> {
    setSubmitError(undefined);
    try {
      // 생성과 같은 규칙으로 조립한다 — 입력에 취향 스냅숏이 없으니 결과에도 없다.
      await patchTripsTripId(tripId, buildCreateTripRequest(tripFields()));
    } catch {
      setSubmitError(SUBMIT_ERROR_MESSAGE);
      return;
    }
    await syncMustVisits(tripId);
  }

  function retryMustVisits(): void {
    if (createdTripId === undefined) return;
    // 생성 직후 등록 실패는 남은 poiId 만 다시 등록하고, 이미 만든 여행의 동기화 실패는 조회부터
    // 다시 맞춘다(`syncMustVisits`는 `pendingMustVisits`를 쓰지 않아 늘 비어 있다).
    if (pendingMustVisits.length > 0) {
      void registerMustVisits(createdTripId, pendingMustVisits);
      return;
    }
    const tripId = createdTripId;
    void withSubmitLock(() => syncMustVisits(tripId));
  }

  /** 생성·수정 본문의 공통 필드 — PATCH 가 대체 의미라(빠진 선택 필드는 기본값으로 덮인다) 두 요청이
   * 같은 전체 값을 싣는다. */
  function tripFields(): CreateTripInput {
    return {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      party,
      companionType,
      destinations,
      // 예산은 effective(사용자 입력 우선, 미입력 시 프리필)로 나간다(TRIP-670 D3 복원). `empty`·
      // `invalid`·**0** 이면 `undefined` 라 키가 안 붙는다. `>0` 로 좁혀 요약(`summaryBudget` 은
      // `amount<=0`→null="예산 선택")과 제출을 같은 규칙에 맞춘다(S6D 표시=제출 대칭). 0 이 파싱
      // 성질로는 유효값이라도 표시가 미선택이면 제출도 미전송이어야 둘이 안 갈라진다.
      budgetTotal:
        parsedBudget.kind === 'amount' && parsedBudget.amount > 0
          ? parsedBudget.amount
          : undefined,
    };
  }

  async function submit(): Promise<void> {
    if (!canProceed || createTrip.isPending || submitLockedRef.current) return;

    // 여행은 이미 만들어졌고 등록만 남았으면(재시도 경로) 여행을 또 안 만들고 남은 등록만 잇는다.
    if (createdTripId !== undefined && pendingMustVisits.length > 0) {
      await registerMustVisits(createdTripId, pendingMustVisits);
      return;
    }

    // 이미 만든 여행이 있으면 새로 만들지 않고 고친다(TRIP-1113). 렌더 값이 아니라 스토어를 **지금**
    // 읽는다 — 생성 성공 직후 리렌더 전에 한 번 더 눌려도 옛 `undefined`로 여행을 또 만들지 않게.
    const existingTripId = useTripWizardStore.getState().createdTripId;
    if (existingTripId !== undefined) {
      await withSubmitLock(() => editTrip(existingTripId));
      return;
    }

    setSubmitError(undefined);
    setOverseasBlocked(false);

    // `CreateTripRequest`(변수)로 타이핑해야 `preferenceSnapshot` 을 실을 수 있다 —
    // `CreateTripInput`(Omit)은 그 키를 리터럴에서 막는다.
    const input: CreateTripRequest = {
      ...tripFields(),
      // 취향 스냅숏(정책 A) — 실효 취향(오버라이드 ?? 프리필)을 평평한 한국어 배열로 싣는다
      // (BE 는 받은 것만 저장하고 스스로 동결하지 않는다). 요약 취향 행과 같은 출처라 화면=서버가
      // 맞는다(두 축 모두, TRIP-1092).
      preferenceSnapshot: {
        styles: effectiveStyles,
        activities: effectiveActivities,
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

  /** 예산 시트 열기 — 드래프트를 effective 예산 문자열(스토어 유효 ? 스토어 : 프리필)·등급(커밋 금액 > 0
   * 이면 역산, 아니면 프리필 tier — TRIP-1091, 요약 행과 같은 출처)에서 초기화한다(D3). 스토어는 `getState()`로 여는 순간 값을 읽고(`openCompanionSheet` 선례), 프리필은
   * render 클로저값(react-query 라 store 를 안 타 클로저가 곧 최신값). */
  function openBudgetSheet(): void {
    // 프리필 미도착이면 열지 않는다(S6G) — 빈 드래프트로 열리는 것을 막아 취향 시트와 결을 맞춘다.
    // 신호는 preference.isPending(≠isLoading — 담은목록 축이 섞이면 게스트를 오차단, ★3).
    if (preference.isPending) return;
    const currentBudgetText = useTripWizardStore.getState().budgetText;
    // 등급만 있고 금액이 없는 온보딩(TRIP-1107)이면 칩 press 와 같은 대표 금액으로 연다 — 드래프트만
    // 채우고 요약 행·제출은 그대로다(결정 1 A: 적용 전엔 budgetTotal 을 싣지 않는다).
    const tierAmountText = isBudgetTier(tierLabel)
      ? formatBudgetAmount(budgetForTier(tierLabel))
      : '';
    setDraftAmountText(
      parseBudgetAmount(currentBudgetText).kind === 'amount'
        ? currentBudgetText
        : prefillBudgetText !== ''
          ? prefillBudgetText
          : tierAmountText
    );
    setDraftTier(appliedBudgetTier(currentBudgetText, tierLabel));
    setBudgetSheetOpen(true);
  }

  /** "적용" — 드래프트 금액을 store 에 커밋(`setBudgetText`) + 닫기. tier 는 커밋 대상이 아니다
   * (honest — 스토어·요청 어디에도 안 감, 표시·프리필 축 전용). 금액이 아니면(invalid·empty) 커밋·닫기를
   * 건너뛴다 — invalid 는 S6E(잘못된 입력의 조용한 소멸 방지), empty 는 TRIP-984 D8(빈 적용이 이미
   * 커밋된 금액을 지우거나 시트만 닫히는 침묵 실패 방지, 버튼도 비활성). */
  function applyBudget(): void {
    if (parseBudgetAmount(draftAmountText).kind !== 'amount') return;
    setBudgetText(draftAmountText);
    setBudgetSheetOpen(false);
  }

  /** tier 칩 — 드래프트 tier 와 함께 대표 금액(온보딩 범위 가운데값, 박수 무관 — TRIP-1067)을 금액 칸에 채운다.
   * press 핸들러에서 직접 쓴다 — tier 변화에 매달면 이미 켜진 칩 재press 때 채움이 안 일어난다.
   * press 할 때만 계산하므로 인원·여행지가 바뀌어도, 시트를 다시 열어도 재계산하지 않는다. */
  function selectBudgetTier(tier: BudgetTier): void {
    setDraftTier(tier);
    setDraftAmountText(formatBudgetAmount(budgetForTier(tier)));
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
    // 이미 만든 여행이면 열지 않고 이유를 알린다(TRIP-1113 결정 1) — 바꾸게 두면 화면에 서버에 없는
    // 취향이 남는다. 새 여행 진입(`reset()`)이면 id 가 비어 저절로 풀린다.
    if (createdTripId !== undefined) {
      showToast({
        message: PREF_LOCKED_MESSAGE,
        testID: 'trip-wizard-pref-locked-toast',
      });
      return;
    }
    // 프리필 미도착이면 열지 않는다(S5G — 데이터 손실 봉합). GET /me/preferences 도착 전 열면
    // 드래프트가 빈 []로 열리고, 적용 시 `[] ?? prefill`(빈 배열은 값이라 ?? 폴백 안 함)로 온보딩
    // 취향이 영구 유실된다. 신호는 preference.isPending(예산 시트와 동일, ★3).
    if (preference.isPending) return;
    // 두 축 모두 이 가드 안에서 초기화한다 — 밖에서 따로 하면 같은 유실이 활동 축에 생긴다.
    const {
      prefStyleOverride: styleOverride,
      prefActivityOverride: activityOverride,
    } = useTripWizardStore.getState();
    setPrefDraftStyles([...(styleOverride ?? prefillStyles)]);
    setPrefDraftActivities([...(activityOverride ?? prefillActivities)]);
    setPrefSheetOpen(true);
  }

  /** 칩 토글 — `toggleMulti` 의 전해제 `null` 을 `[]` 로 매핑한다(★ null-vs-empty, D2). 안 하면
   * 드래프트가 null 이 되고 적용 시 `effectiveStyles = null ?? prefill` 로 프리필로 되돌아간다. */
  function togglePrefStyle(label: string): void {
    setPrefDraftStyles((current) => toggleMulti(current, label) ?? []);
  }

  /** 활동 칩 토글 — 스타일과 같은 null→[] 매핑, 드래프트는 축마다 따로(TRIP-1092). */
  function togglePrefActivity(label: string): void {
    setPrefDraftActivities((current) => toggleMulti(current, label) ?? []);
  }

  /** "적용" — 두 축 드래프트를 함께 오버라이드로 커밋(빈 `[]` 도 그대로) + 닫기. */
  function applyPrefSheet(): void {
    setPrefStyleOverride(prefDraftStyles);
    setPrefActivityOverride(prefDraftActivities);
    setPrefSheetOpen(false);
  }

  /** "적용" — 시작을 골랐을 때만 커밋한다(안 골랐으면 버튼이 진짜 disabled 라 여긴 안전 이중 방어
   * 겸 TS 좁히기). `setStartDate`가 시작을 저장하고 끝을 파생한 뒤 시트를 닫는다(TRIP-1027). */
  function applyPeriod(): void {
    if (periodStart === undefined) return;
    setStartDate(periodStart);
    setPeriodSheetOpen(false);
  }

  // 꼭 갈 곳 고르기(d02 select) — 「더 담기」·「전체 보기」가 함께 쓴다. 위저드 출처 표식을 싣는다.
  const mustVisitSelectHref = {
    pathname: '/explore/saved-places',
    params: {
      mode: 'select',
      region: destinations.map((d) => d.region),
      ...wizardOriginParams(),
    },
  } as const;

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
          // 담은 곳 수와 무관하게 늘 d02 select 로 보낸다(TRIP-1093 결정 2) — 새로 담기는 d02 의
          // 「탐색에서 더 담기」로, 꼭 갈 곳은 거기서 체크 → 완료로만 들어간다. 여행 지역은 표준명
          // 원문·순서 그대로(TRIP-689), 목적지가 없으면 빈 배열이라 전국 전체가 뜬다.
          router.push(mustVisitSelectHref)
        }
        // 전체 보기도 더 담기와 같은 인자다(TRIP-706 · TRIP-1093).
        onPressSeeAll={() => router.push(mustVisitSelectHref)}
        canProceed={canProceed}
        onNext={submit}
        // 여행을 안 만들었으면 지금처럼 바로 나간다(01b Q5). 스와이프·하드웨어 뒤로는 가로채지 않는다(결정 1).
        onBack={() =>
          createdTripId === undefined ? router.back() : setLeaveOpen(true)
        }
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
          onAddCity={() => router.push(regionPickerHref('trip'))}
          onApply={() => setDestinationSheetOpen(false)}
          onClose={() => setDestinationSheetOpen(false)}
          mustVisitCount={mustVisits.length}
        />
      ) : null}
      {/* 기간 편집 시트도 화면의 형제로 조건부 마운트 — 셀 탭은 새 시작을 고르고, "적용"에서만
          스토어에 커밋한다(여행지 시트의 즉시반영과 반대, D6). */}
      {periodSheetOpen ? (
        <PeriodEditSheet
          today={resolvedToday}
          month={periodMonth}
          range={
            periodStart === undefined
              ? {}
              : {
                  start: periodStart,
                  end: deriveEndDate(periodStart, nightsSum(destinations)),
                }
          }
          onPickDate={setPeriodStart}
          onPrevMonth={() =>
            setPeriodMonth((current) => shiftMonth(current, -1))
          }
          onNextMonth={() =>
            setPeriodMonth((current) => shiftMonth(current, 1))
          }
          onApply={applyPeriod}
          onClose={() => setPeriodSheetOpen(false)}
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
          onClose={() => setCompanionSheetOpen(false)}
        />
      ) : null}
      {/* 취향 편집 시트도 화면의 형제로 조건부 마운트 — 칩 press 는 배선의 `toggleMulti`(null→[])로
          드래프트만 전이시키고, "적용"에서만 오버라이드로 커밋한다(동행 시트와 같은 커밋-온-어플라이). */}
      {prefSheetOpen ? (
        <PrefOverrideSheet
          selected={prefDraftStyles}
          onToggle={togglePrefStyle}
          selectedActivities={prefDraftActivities}
          onToggleActivity={togglePrefActivity}
          onApply={applyPrefSheet}
          onClose={() => setPrefSheetOpen(false)}
          fromOnboarding={prefFromOnboarding}
        />
      ) : null}
      {/* 예산 편집 시트도 화면의 형제로 조건부 마운트 — tier·금액 press 는 드래프트만 바꾸고
          (적용 전 store 불변), "적용"에서만 `setBudgetText` 로 커밋한다(커밋-온-어플라이). tier 는
          어디에도 커밋/전송 안 한다(honest — 표시·프리필 축 전용). */}
      {budgetSheetOpen ? (
        <BudgetEditSheet
          amountText={draftAmountText}
          tier={draftTier}
          budgetError={
            // 페이지가 드래프트 금액 오류(파싱 실패·빈 금액)를 도출해 시트 슬롯에 내린다(S6E — 시트는 props-only 라
            // amountText 로 스스로 오류를 도출하지 않는다). 카피는 오케 확정값.
            draftBudgetKind === 'invalid'
              ? '숫자만 입력해 주세요'
              : draftBudgetKind === 'empty'
                ? '금액을 입력해 주세요'
                : undefined
          }
          onChangeAmount={setDraftAmountText}
          onSelectTier={selectBudgetTier}
          onApply={applyBudget}
          onClose={() => setBudgetSheetOpen(false)}
          applyDisabled={draftBudgetKind === 'empty'}
        />
      ) : null}
      {/* 이탈 확인은 맨 위에 겹친다. 삭제가 성공해 id 가 비면 저절로 내려간다. */}
      {leaveOpen && createdTripId !== undefined ? (
        <LeaveDialogContainer
          tripId={createdTripId}
          onExit={exitWizard}
          onStay={() => setLeaveOpen(false)}
        />
      ) : null}
    </>
  );
}
