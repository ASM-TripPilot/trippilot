import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';

import { useSavedPlaces } from '@/features/explore/model/savedPlaces';
import { postTripsTripIdMustVisits } from '@/shared/api/generated/trips/trips';
import type { CreateTripRequest } from '@/shared/api/generated/schemas';
import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { getAccessToken } from '@/shared/api/tokenManager';

import {
  formatBudgetAmount,
  parseBudgetAmount,
} from '@/features/trip/model/budgetAmount';
import { buildCreateTripRequest } from '@/features/trip/model/createTripRequest';
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
import { DestinationEditSheet } from '@/features/trip/ui/DestinationEditSheet';
import { TripWizardStep1Screen } from '@/features/trip/ui/TripWizardStep1Screen';

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

export interface TripNewStep1PageProps {
  /** 프리셋 계산 기준일('YYYY-MM-DD'). 신 default 는 프리셋·달력이 없어(편집은 S3 시트로 이연)
   * 지금은 소비처가 없다 — 날짜 편집 시트(S3)가 붙을 때 다시 쓰인다. 계약은 유지한다. */
  baseDate?: string;
}

export function TripNewStep1Page(_props: TripNewStep1PageProps): ReactElement {
  const router = useRouter();

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

  const preference = usePreferencePrefill();
  // 계정 취향 프리필(GET /me/preferences)은 이미 한국어 도메인 값이다(slug 아님) — 그대로 요약·
  // 스냅숏에 흐른다. 여행 단위 취향 override(BR-U1-38)는 편집 시트(S5)로 이연했으므로, 지금 실효
  // 취향은 항상 프리필이고 온보딩 상속이다(`fromOnboarding = true`).
  const prefillStyles = preference.data?.styles?.value ?? [];
  const prefillActivities = preference.data?.activities?.value ?? [];
  const preferenceChips = [...prefillStyles, ...prefillActivities];

  // 예산은 프리필에서만 온다(인라인 입력은 S6 으로 이연). 신뢰 경계(0 이상 정수)를 통과한 값만
  // 콤마 포맷 → 파싱해 제출 바디의 `budgetTotal` 로 쓴다(`budgetAmount` 순수 함수, 로케일 API 미사용).
  const rawAmount = preference.data?.budget?.rawAmount;
  const tierLabel = preference.data?.budget?.tier ?? undefined;
  const canPrefillBudget = isPrefillableBudget(rawAmount);
  const budgetText = canPrefillBudget ? formatBudgetAmount(rawAmount) : '';
  const parsedBudget = parseBudgetAmount(budgetText);

  // 요약 5행 도출 — 미선택은 셀렉터가 `null` 을 낸다(화면이 플레이스홀더로 그린다).
  const summaryDestinationsValue = summaryDestinations(destinations);
  const summaryPeriodValue = summaryPeriod(startDate, endDate);
  const summaryCompanionValue = summaryCompanion(companionType, party);
  const summaryPreferencesValue = summaryPreferences(preferenceChips, true);
  const summaryBudgetValue = canPrefillBudget
    ? summaryBudget(rawAmount, tierLabel)
    : null;

  const [submitError, setSubmitError] = useState<string>();
  const [overseasBlocked, setOverseasBlocked] = useState(false);
  const [mustVisitError, setMustVisitError] = useState<string>();
  const [pendingMustVisits, setPendingMustVisits] = useState<string[]>([]);
  // 여행지 편집 시트 개폐(TRIP-666) — 배선이 소유한다(화면은 무상태 D5). 시트는 화면의 형제로
  // 조건부 마운트한다(화면 슬롯 금지 — 화면 단독 렌더에서 시트/도시추가가 안 떠야 하는 프리즈 2건).
  const [destinationSheetOpen, setDestinationSheetOpen] = useState(false);

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
      // 예산은 프리필 값만 나간다(사용자 입력은 S6). `empty` 면 `undefined` 라 키가 안 붙는다
      // (`buildCreateTripRequest` 가 스프레드 전에 떼어 조건부로 다시 붙인다).
      budgetTotal:
        parsedBudget.kind === 'amount' ? parsedBudget.amount : undefined,
      // 취향 스냅숏(정책 A) — 프리필 실효 취향을 평평한 한국어 배열로 싣는다(BE 는 받은 것만
      // 저장하고 스스로 동결하지 않는다). 요약 취향 행과 같은 출처라 화면=서버가 맞는다.
      preferenceSnapshot: {
        styles: prefillStyles,
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

  // 여행지 외 4행(기간·동행·취향·예산) 편집 시트는 S3~S6 스텁이다 — 지금은 오픈 신호만 받는다.
  const openEditSheet = (): void => {};

  return (
    <>
      <TripWizardStep1Screen
        summaryDestinations={summaryDestinationsValue}
        summaryPeriod={summaryPeriodValue}
        summaryCompanion={summaryCompanionValue}
        summaryPreferences={summaryPreferencesValue}
        summaryBudget={summaryBudgetValue}
        onPressSummaryDestination={() => setDestinationSheetOpen(true)}
        onPressSummaryPeriod={openEditSheet}
        onPressSummaryCompanion={openEditSheet}
        onPressSummaryPreference={openEditSheet}
        onPressSummaryBudget={openEditSheet}
        mustVisits={mustVisits}
        onPressMore={() =>
          // 담은 곳이 있으면 담은 장소 화면(d02)으로, 없으면 새로 담을 탐색으로 보낸다(TRIP-367).
          router.push(
            savedPlaceList.length > 0
              ? '/explore/saved-places'
              : '/explore/places'
          )
        }
        onPressSeeAll={() => router.push('/explore/saved-places')}
        canProceed={canProceed}
        onNext={submit}
        onBack={() => router.back()}
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
    </>
  );
}
