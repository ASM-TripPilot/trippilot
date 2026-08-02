import type { ReactElement } from 'react';
import { useRouter } from 'expo-router';

import { REGIONS } from '@/features/explore/model/regions';
import type { CompanionType } from '@/shared/api/generated/schemas';

import { validateTripDraft } from '@/features/trip/model/tripDraft';
import {
  presetRange,
  type PeriodPresetCode,
} from '@/features/trip/model/tripWizardStep1';
import { useTripWizardStore } from '@/features/trip/model/tripWizardStore';
import { usePreferencePrefill } from '@/features/trip/model/usePreferencePrefill';
import { TripWizardStep1Screen } from '@/features/trip/ui/TripWizardStep1Screen';

/**
 * TRIP-205 g01 1/2 배선 — 스토어 ↔ 화면 ↔ 라우터를 한 줄기로 잇는다.
 *
 * 이 파일이 지는 책임 셋 — 화면은 이 중 어느 것도 모른다(프리뷰·경계 제약, AC-14):
 *  1. `[다음]` 게이트 판정 — `validateTripDraft`(TRIP-204, 동결)를 여기서만 부른다.
 *     `destinations.length>0 && startDate·endDate 모두 있음 && validateTripDraft(...)===0`
 *     (01b §6.3) — 앞 두 조건이 "아직 안 고름"을, 마지막이 "잘못 고름"을 가른다.
 *  2. 기준일 주입 — `baseDate` prop이 없으면 `todayIso()`로 채운다(`StayRegisterPage`
 *     선례와 동형). 프리셋 → 날짜 범위 계산(`presetRange`)도 여기서 하고 화면엔 결과만 내린다.
 *  3. `REGIONS`를 읽어 `regions` prop으로 내린다 — 화면이 `features/explore`를 직접 import하면
 *     features 간 import가 된다(리포 관례 금지). `RegionPickerPage`가 `regions={filterRegions(...)}`로
 *     내리는 형태와 같다.
 */

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
  const addDestination = useTripWizardStore((state) => state.addDestination);
  const removeDestination = useTripWizardStore(
    (state) => state.removeDestination
  );
  const setPeriod = useTripWizardStore((state) => state.setPeriod);
  const setParty = useTripWizardStore((state) => state.setParty);
  const selectCompanion = useTripWizardStore((state) => state.selectCompanion);

  const preference = usePreferencePrefill();
  const preferenceChips = [
    ...(preference.data?.styles?.value ?? []),
    ...(preference.data?.activities?.value ?? []),
  ];

  const canProceed =
    destinations.length > 0 &&
    startDate !== undefined &&
    startDate !== '' &&
    endDate !== undefined &&
    endDate !== '' &&
    validateTripDraft({
      destinations,
      startDate: startDate ?? '',
      endDate: endDate ?? '',
      party,
    }).length === 0;

  function handleSelectPreset(code: PeriodPresetCode): void {
    const range = presetRange(code, resolvedBaseDate);
    setPeriod(code, range.startDate, range.endDate);
  }

  function handleNext(): void {
    // 버튼이 비활성이면 눌리지 않지만, 배선도 스스로 판정을 다시 걷는다 —
    // `StayRegisterPage.handleSubmit`이 `canSubmitStayRegister`를 다시 거는 것과 같은 이유다.
    if (!canProceed) return;
    // 2/2(거점 숙소, g02)는 TRIP-84(US-TRIP-04) 소관이라 라우트 파일이 아직 없다 — 만들면
    // Expo Router 타입 라우트가 없는 경로라 tsc가 막는다(`RegionPickerPage`의
    // `explore/destination/[region]`과 달리 그 파일 자체가 없다). 이 칸은 게이트만 지고
    // 다음 목적지 배선은 그 티켓 몫으로 남긴다.
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
      onBack={() => router.back()}
      onAddDestination={addDestination}
      onRemoveDestination={removeDestination}
      onSelectPreset={handleSelectPreset}
      onPressPeriod={() => {}}
      onChangeParty={setParty}
      onSelectCompanion={(type: CompanionType) => selectCompanion(type)}
      onChangePreference={() => {}}
      onNext={handleNext}
    />
  );
}
