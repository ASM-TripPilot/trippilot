import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { useRouter } from 'expo-router';

import { REGIONS } from '@/features/explore/model/regions';
import type { CompanionType } from '@/shared/api/generated/schemas';

import {
  buildCreateTripRequest,
  type CreateTripInput,
} from '@/features/trip/model/createTripRequest';
import {
  nightsSum,
  tripLength,
  validateTripDraft,
  type TripDraft,
} from '@/features/trip/model/tripDraft';
import {
  presetRange,
  type PeriodPresetCode,
} from '@/features/trip/model/tripWizardStep1';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { useCreateTrip } from '@/features/trip/model/useCreateTrip';
import { usePreferencePrefill } from '@/features/trip/model/usePreferencePrefill';
import { TripWizardStep1Screen } from '@/features/trip/ui/TripWizardStep1Screen';

/**
 * TRIP-205/206 g01 1/2 배선 — 스토어 ↔ 화면 ↔ 라우터 ↔ 서버를 한 줄기로 잇는다.
 *
 * 이 파일이 지는 책임 — 화면은 이 중 어느 것도 모른다(프리뷰·경계 제약, AC-14):
 *  1. `[다음]` 게이트 판정 — `validateTripDraft`(TRIP-204, 동결)를 여기서만 부른다.
 *     `destinations.length>0 && startDate·endDate 모두 있음 && validateTripDraft(...)===0`
 *     (01b §6.3) — 앞 두 조건이 "아직 안 고름"을, 마지막이 "잘못 고름"을 가른다.
 *  2. 기준일 주입 — `baseDate` prop이 없으면 `todayIso()`로 채운다(`StayRegisterPage`
 *     선례와 동형). 프리셋 → 날짜 범위 계산(`presetRange`)도 여기서 하고 화면엔 결과만 내린다.
 *  3. `REGIONS`를 읽어 `regions` prop으로 내린다 — 화면이 `features/explore`를 직접 import하면
 *     features 간 import가 된다(리포 관례 금지). `RegionPickerPage`가 `regions={filterRegions(...)}`로
 *     내리는 형태와 같다.
 *  4. **제출과 오류 매핑(TRIP-206, 01b D1·D4)** — 클라 위반은 `touched`가 켜진 축만 문구로
 *     내려보내고(§클라 오류 절), 서버 400은 알려진 형태만 인라인/다이얼로그로 골라내고
 *     **나머지 전부(미상 코드·미상 필드·응답 자체 없음)는 배너로 떨어뜨린다** — 이것이
 *     INV-4 페일세이프다. 화면은 완성된 문자열만 받으므로 이 매핑이 화면에 새어 나가면
 *     `tripWizardStep1Boundary.test.ts`가 막는다(위반 코드 리터럴 0건 유지).
 */

/** 서버 400의 `error.code`가 국내 밖 목적지를 가리키는 값. openapi에 enum이 없어
 * **발명값**이다(01b D4, 아침 확인 1번) — BE 확인 뒤 이 상수 한 줄만 바꾸면 된다. */
const OVERSEAS_DESTINATION_ERROR_CODE = 'OVERSEAS_DESTINATION';

/** 종료일 역전 문구 — 클라 검증이 쓴다(Figma `2226:2119`). */
const PERIOD_ERROR_MESSAGE = '종료일이 시작일보다 빨라요';

/** 제출 실패 배너 본문 — Figma가 확정한 유일한 문구다(`2226:2128`). 미상 코드·미상 필드처럼
 * Figma가 문구를 안 정해 준 갈래도 이 문구로 떨어진다(그 밖 갈래의 본문은 정본이 없다,
 * 브리프 §2.3) — 새 문구를 발명하는 대신 확정된 문구 하나를 재사용한다. */
const SUBMIT_ERROR_MESSAGE = '네트워크를 확인하고 다시 시도해주세요';

/** touched 게이트를 타지 않는 서버 400 → 화면 표면 갈래(01b D4 §2.4②). `overseas`만 아는
 * 코드로 걸러내고, **원인을 확신할 수 없는 나머지 전부(미상 코드·필드 오류 포함)는 배너로
 * 떨어뜨린다** — 5-c W-1: `fields[].field`로 "기간 오류"를 추측해 인라인 문구를 다는 것은
 * 계약이 말하지 않은 원인을 화면이 단정하는 것이라 거짓 설명이 된다. */
type ServerSubmitFailure = 'overseas' | 'banner';

function classifyServerFailure(error: unknown): ServerSubmitFailure {
  if (!isAxiosError(error) || !error.response) {
    // 응답 자체가 없다 — 네트워크 실패(02a ★6). Figma 배너 본문이 정확히 이 갈래의 문구다.
    return 'banner';
  }
  const body = error.response.data as { error?: { code?: string } } | undefined;
  if (body?.error?.code === OVERSEAS_DESTINATION_ERROR_CODE) {
    return 'overseas';
  }
  return 'banner';
}

export interface TripNewStep1PageProps {
  /** 프리셋 계산 기준일('YYYY-MM-DD'). 미지정이면 오늘. 화면·순수 함수는 시계를 읽지
   * 않으므로(AC-5) 이 값을 페이지가 대신 계산해 내려준다. */
  baseDate?: string;
}

/** 로컬 달력 기준 오늘 — `StayRegisterPage.todayIso()`와 동형(선례). */
function todayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function TripNewStep1Page({
  baseDate,
}: TripNewStep1PageProps): ReactElement {
  const router = useRouter();
  const resolvedBaseDate = baseDate ?? todayIso();

  const destinations = useTripWizardStore((state) => state.destinations);
  const startDate = useTripWizardStore((state) => state.startDate);
  const endDate = useTripWizardStore((state) => state.endDate);
  const presetCode = useTripWizardStore((state) => state.presetCode);
  const party = useTripWizardStore((state) => state.party);
  const companionType = useTripWizardStore((state) => state.companionType);
  const touched = useTripWizardStore((state) => state.touched);
  const addDestination = useTripWizardStore((state) => state.addDestination);
  const removeDestination = useTripWizardStore(
    (state) => state.removeDestination
  );
  const setPeriod = useTripWizardStore((state) => state.setPeriod);
  const setParty = useTripWizardStore((state) => state.setParty);
  const selectCompanion = useTripWizardStore((state) => state.selectCompanion);
  const setCreatedTripId = useTripWizardStore(
    (state) => state.setCreatedTripId
  );

  const preference = usePreferencePrefill();
  const preferenceChips = [
    ...(preference.data?.styles?.value ?? []),
    ...(preference.data?.activities?.value ?? []),
  ];

  // 서버 400 → 화면 표면(01b D4). `touched` 게이트를 안 탄다 — 사용자가 이미 제출을
  // 눌렀고 서버가 대답했으므로, 안 건드린 축이어도 반드시 보여야 한다(★13, INV-4).
  const [submitError, setSubmitError] = useState<string>();
  const [overseasBlocked, setOverseasBlocked] = useState(false);

  // 5-c N-2: 배너가 뜬 뒤 드래프트를 고치면 배너는 옛 실패를 계속 보여주면서도 [다시 시도]는
  // 새 상태 기준으로 다시 판정한다 — 화면과 배너가 서로 다른 이야기를 하게 된다. 드래프트가
  // 바뀌는 순간 배너를 걷어 그 어긋남을 없앤다.
  useEffect(() => {
    setSubmitError(undefined);
  }, [destinations, startDate, endDate, party, companionType]);

  const createTrip = useCreateTrip();

  const draft: TripDraft = {
    destinations,
    startDate: startDate ?? '',
    endDate: endDate ?? '',
    party,
  };
  const violations = validateTripDraft(draft);

  const canProceed =
    destinations.length > 0 &&
    startDate !== undefined &&
    startDate !== '' &&
    endDate !== undefined &&
    endDate !== '' &&
    violations.length === 0;

  // 클라 검증 → 인라인 문구. **`touched`가 켜진 축만** — 아직 아무것도 안 고른 사용자에게
  // 페일클로즈 판정을 그대로 뿌리면 AC-10을 위반한다(01b D1·D3). 서버는 기간 축을 안 낸다
  // (5-c W-1) — 인라인 기간 오류는 클라 검증 하나뿐이다.
  const periodError =
    touched.includes('period') && violations.includes('END_BEFORE_START')
      ? PERIOD_ERROR_MESSAGE
      : undefined;
  // 박수 문구는 두 축이 **모두** touched일 때만 만든다 — 날짜 미선택 상태에서 조립하면
  // `tripLength`가 `NaN`이라 "여행 기간(NaN박)"이 사용자에게 보인다(02a ★7).
  const destinationError =
    touched.includes('destinations') &&
    touched.includes('period') &&
    violations.includes('NIGHTS_EXCEED_PERIOD')
      ? `숙소 박수(${nightsSum(destinations)}박)가 여행 기간(${tripLength(draft)}박)보다 많아요`
      : undefined;

  function handleSelectPreset(code: PeriodPresetCode): void {
    const range = presetRange(code, resolvedBaseDate);
    setPeriod(code, range.startDate, range.endDate);
  }

  async function submit(): Promise<void> {
    // 버튼이 비활성이면 눌리지 않지만, 배선도 스스로 판정을 다시 걷는다(`StayRegisterPage.
    // handleSubmit`과 같은 이유). `isPending`도 함께 건다 — 응답이 오기 전 두 번째 호출이
    // 두 번째 요청을 만들지 않아야 한다(AC-6). 새 상태를 따로 만들지 않고 생성 훅이 이미
    // 노출하는 값을 그대로 쓴다(01b Seed §기존 활용).
    if (!canProceed || createTrip.isPending) return;

    setSubmitError(undefined);
    setOverseasBlocked(false);

    const input: CreateTripInput = {
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      party,
      companionType,
      destinations,
    };

    // 5-c W-2: `try`의 사정거리를 요청 한 줄로 좁힌다. 성공 뒤 부작용(id 기록·라우팅)에서
    // 난 예외까지 여기서 받으면, 이미 만들어진 여행이 "네트워크 실패"로 보이고 사용자가
    // 다시 시도를 눌러 여행이 하나 더 만들어진다 — 되돌릴 수 없는 중복이다.
    let trip: Awaited<ReturnType<typeof createTrip.mutateAsync>>;
    try {
      trip = await createTrip.mutateAsync({
        data: buildCreateTripRequest(input, preference.data),
      });
    } catch (error) {
      const failure = classifyServerFailure(error);
      if (failure === 'overseas') {
        setOverseasBlocked(true);
      } else {
        // 미상 코드·미상 필드·응답 자체 없음 — 전부 여기로 떨어진다. 조용히 삼키지 않는다.
        setSubmitError(SUBMIT_ERROR_MESSAGE);
      }
      return;
    }

    // g02(TRIP-84·TRIP-193)가 읽는 소비자다 — 라우트가 id를 안 나른다(01b D7).
    setCreatedTripId(trip.tripId);
    // 2/2(거점 숙소, g02)는 TRIP-84(US-TRIP-04) 소관이라 자리만 라우트로 이동한다.
    // `tripWizardStore.reset()`은 부르지 않는다(01b D6 — 위저드를 완전히 벗어날 때의 몫).
    router.push('/trips/new/step2');
  }

  return (
    <TripWizardStep1Screen
      destinations={destinations}
      startDate={startDate}
      endDate={endDate}
      presetCode={presetCode}
      party={party}
      companionType={companionType}
      preferenceChips={preferenceChips}
      regions={REGIONS}
      canProceed={canProceed}
      destinationError={destinationError}
      periodError={periodError}
      submitError={submitError}
      overseasBlocked={overseasBlocked}
      onBack={() => router.back()}
      onAddDestination={addDestination}
      onRemoveDestination={removeDestination}
      onSelectPreset={handleSelectPreset}
      onPressPeriod={() => {}}
      onChangeParty={setParty}
      onSelectCompanion={(type: CompanionType) => selectCompanion(type)}
      onChangePreference={() => {}}
      onNext={submit}
      onRetrySubmit={submit}
      onCloseOverseasDialog={() => setOverseasBlocked(false)}
      onPickDomesticRegion={() => setOverseasBlocked(false)}
    />
  );
}
