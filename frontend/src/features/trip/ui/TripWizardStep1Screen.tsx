import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  CompanionType,
  TripDestination,
} from '@/shared/api/generated/schemas';

import {
  COMPANION_OPTIONS,
  formatDateRange,
  PERIOD_PRESETS,
  type PeriodPresetCode,
} from '../model/tripWizardStep1';
import {
  BackChevronGlyph,
  CalendarGlyph,
  ChevronDownGlyph,
  ChevronRightGlyph,
  FamilyGlyph,
  FriendsGlyph,
  HeartGlyph,
  PinGlyph,
  PlusGlyph,
  RemoveGlyph,
  SoloGlyph,
  SparkleGlyph,
  StepperMinusGlyph,
  StepperPlusGlyph,
  type GlyphComponent,
} from './TripGlyphs';

/**
 * TRIP-205 g01 여행 만들기 1/2 — **props만 받는 프레젠테이션 화면**(Figma `1675:1183` default ·
 * 제목은 `no-saved-places`(`2226:1732`) 정본 — 01b D1).
 *
 * 무엇을 보장하나: 위저드 셸(앱바·진행 표시·하단 고정 CTA)과 입력 블록 5개(여행지·기간·
 * 인원·동반·취향)가 정본 문구대로 그려지고, 모든 상호작용이 판단 없이 그대로 위로 올라가며
 * (콜백 그대로 호출), `[다음]`의 활성 여부는 받은 `canProceed` **하나로만** 갈린다. 그리고
 * 이 화면은 어떤 상태에서도 오류 문구를 그리지 않는다(AC-10c — 판정은 하되 문구는 TRIP-206).
 *
 * 왜 props만 받는가: 이 화면이 쿼리 훅·라우터·`expo-location`을 전이 의존으로라도 물면 dev
 * 프리뷰가 터지고 테스트가 네트워크에 묶인다 — 그 제약은 렌더로 관찰할 수 없어
 * `src/__tests__/tripWizardStep1Boundary.test.ts`가 소스 층에서 따로 잠근다(AC-14).
 *
 * '도시 추가' 시트를 여닫는 상태와 시트 안에서 아직 확정하지 않은 지역·박수 선택은 이
 * 화면만 아는 **일회성 UI 상태**라 로컬 `useState`로 둔다 — confirm을 누르기 전까지는
 * 드래프트(스토어)에 반영되지 않으므로 AC-11(재진입 보존) 대상이 아니다.
 *
 * 커버하지 않는 것: 서버 제출·오류 문구 표시(TRIP-206) · 예산 UI(TRIP-207) · 등록 숙소 날짜
 * 연계(TRIP-208) · '꼭 갈 곳'(TRIP-209) · 날짜 피커 캘린더(Figma 부재 — D4에 따라 진입점만).
 */

export interface TripWizardStep1ScreenProps {
  destinations: TripDestination[];
  startDate?: string;
  endDate?: string;
  presetCode?: PeriodPresetCode;
  party: number;
  companionType?: CompanionType;
  /** 취향 카드 칩 라벨. `[]` = 칩 없는 최소형 카드(AC-9 경계). */
  preferenceChips: string[];
  /** 도시 추가 시트 목록 — `pages` 층이 내려준다. 화면은 `@/features/explore/model/regions`를
   * 직접 import하지 않는다(features 간 import 금지 관례) — 형태만 구조적으로 받는다. */
  regions: readonly { code: string; name: string }[];
  /** `[다음]` 활성 판정 **결과**만 받는다 — 위반 코드·`validateTripDraft`는 이 화면에 없다. */
  canProceed: boolean;
  onBack(): void;
  onAddDestination(regionName: string, nights: number): void;
  onRemoveDestination(regionName: string): void;
  onSelectPreset(code: PeriodPresetCode): void;
  onPressPeriod(): void;
  onChangeParty(next: number): void;
  onSelectCompanion(type: CompanionType): void;
  onChangePreference(): void;
  onNext(): void;
}

const COMPANION_ICONS: Record<string, GlyphComponent> = {
  alone: SoloGlyph,
  friend: FriendsGlyph,
  partner: HeartGlyph,
  family: FamilyGlyph,
};

/** 드래프트의 `region`(한글 이름)에서 testID용 ASCII 코드를 되찾는다 — `regions` 목록에
 * 없으면(이론상 도달 불가, 이 칸에서 추가하는 도시는 전부 그 목록에서 고른다) 이름 자체를
 * 폴백으로 쓴다. */
function codeForRegionName(
  regions: readonly { code: string; name: string }[],
  name: string
): string {
  return regions.find((region) => region.name === name)?.code ?? name;
}

export function TripWizardStep1Screen({
  destinations,
  startDate,
  endDate,
  presetCode,
  party,
  companionType,
  preferenceChips,
  regions,
  canProceed,
  onBack,
  onAddDestination,
  onRemoveDestination,
  onSelectPreset,
  onPressPeriod,
  onChangeParty,
  onSelectCompanion,
  onChangePreference,
  onNext,
}: TripWizardStep1ScreenProps): ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetRegionCode, setSheetRegionCode] = useState<string | null>(null);
  const [sheetNights, setSheetNights] = useState(1);

  function openDestinationSheet(): void {
    setSheetRegionCode(null);
    setSheetNights(1);
    setSheetOpen(true);
  }

  function confirmDestination(): void {
    if (sheetRegionCode === null) return;
    const region = regions.find((one) => one.code === sheetRegionCode);
    if (region === undefined) return;
    onAddDestination(region.name, sheetNights);
    setSheetOpen(false);
  }

  const dateText = formatDateRange(startDate, endDate);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="trip-wizard-step1-root" className="flex-1 bg-canvas">
        <View className="flex-row items-center gap-sm px-lg pb-sm pt-md">
          <Pressable
            testID="trip-wizard-step1-back"
            accessibilityRole="button"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="text-[18px] font-noto-bold font-bold text-ink">
            여행 만들기
          </Text>
          <View className="flex-1" />
          <View className="flex-row items-center gap-xs">
            <View className="h-1 w-[14px] rounded-[2px] bg-primary" />
            <View className="h-1 w-[14px] rounded-[2px] bg-[#E0E0E0]" />
            <Text className="text-micro text-muted">1 / 2</Text>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          <Text className="px-lg pb-sm pt-md text-[24px] font-noto-bold font-bold text-ink">
            어디로 갈까요?
          </Text>

          {/* 여행지 */}
          <View className="gap-md px-lg pb-md pt-sm">
            <Text className="font-noto-bold text-label font-bold text-muted">
              여행지
            </Text>
            <View className="flex-row flex-wrap items-center gap-sm">
              {destinations.map((destination) => {
                const code = codeForRegionName(regions, destination.region);
                return (
                  <View
                    key={`${destination.seq}-${destination.region}`}
                    testID={`trip-wizard-destination-${code}`}
                    className="flex-row items-center gap-xs rounded-pill bg-surface-soft py-[6px] pl-[10px] pr-[8px]"
                  >
                    <PinGlyph />
                    <Text className="font-noto-bold text-label font-bold text-ink">
                      {destination.region}
                    </Text>
                    <Text className="font-noto text-caption text-muted">
                      · {destination.nights}박
                    </Text>
                    <Pressable
                      testID={`trip-wizard-destination-remove-${code}`}
                      accessibilityRole="button"
                      onPress={() => onRemoveDestination(destination.region)}
                      hitSlop={6}
                    >
                      <RemoveGlyph />
                    </Pressable>
                  </View>
                );
              })}
              <Pressable
                testID="trip-wizard-destination-add"
                accessibilityRole="button"
                onPress={openDestinationSheet}
                className="flex-row items-center gap-xs rounded-pill border-[1.2px] border-primary bg-canvas py-[6px] pl-[10px] pr-md"
              >
                <PlusGlyph />
                <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                  도시 추가
                </Text>
              </Pressable>
            </View>
          </View>

          <View className="px-lg py-sm">
            <View className="h-[1px] w-full bg-hairline" />
          </View>

          {/* 기간 */}
          <View className="gap-md px-lg pb-sm pt-1">
            <Text className="text-[16px] font-noto-bold font-bold text-ink">
              언제 가세요?
            </Text>
            <View className="flex-row flex-wrap gap-sm">
              {PERIOD_PRESETS.map((preset) => {
                const selected = presetCode === preset.code;
                return (
                  <Pressable
                    key={preset.code}
                    testID={`trip-wizard-period-preset-${preset.code}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelectPreset(preset.code)}
                    className={`items-center justify-center rounded-pill pb-[10px] pl-[15px] pr-md pt-[10px] ${
                      selected
                        ? 'bg-primary'
                        : 'border border-hairline-strong bg-canvas'
                    }`}
                  >
                    <Text
                      className={`text-[13.5px] font-noto-bold font-bold ${
                        selected ? 'text-on-primary' : 'text-ink'
                      }`}
                    >
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              testID="trip-wizard-date-field"
              accessibilityRole="button"
              onPress={onPressPeriod}
              className="flex-row items-center gap-md rounded-button border border-hairline-strong bg-canvas px-[14px] py-[13px]"
            >
              <CalendarGlyph />
              <View className="flex-1 gap-[2px]">
                <Text className="text-[14.5px] font-noto-bold font-bold text-ink">
                  {dateText ?? '날짜를 선택해 주세요'}
                </Text>
                <Text className="text-micro text-muted">
                  선택한 프리셋으로 자동 채움
                </Text>
              </View>
              <ChevronDownGlyph />
            </Pressable>
          </View>

          <View className="px-lg py-sm">
            <View className="h-[1px] w-full bg-hairline" />
          </View>

          {/* 인원·동반 */}
          <View className="gap-[14px] px-lg pb-sm pt-1">
            <Text className="text-[16px] font-noto-bold font-bold text-ink">
              누구랑 가세요?
            </Text>
            <View className="flex-row items-center justify-between">
              <Text className="text-[15px] font-noto-bold font-bold text-ink">
                인원
              </Text>
              <View
                testID="trip-wizard-party-stepper"
                className="flex-row items-center gap-md"
              >
                <Pressable
                  testID="trip-wizard-party-stepper-dec"
                  accessibilityRole="button"
                  disabled={party <= 1}
                  onPress={() => onChangeParty(party - 1)}
                  className={`h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas ${
                    party <= 1 ? 'opacity-40' : ''
                  }`}
                >
                  <StepperMinusGlyph />
                </Pressable>
                <Text className="text-[16px] font-noto-bold font-bold text-ink">
                  {party}명
                </Text>
                <Pressable
                  testID="trip-wizard-party-stepper-inc"
                  accessibilityRole="button"
                  onPress={() => onChangeParty(party + 1)}
                  className="h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas"
                >
                  <StepperPlusGlyph />
                </Pressable>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-sm">
              {COMPANION_OPTIONS.map((option) => {
                const selected = companionType === option.type;
                const Icon = COMPANION_ICONS[option.code];
                return (
                  <Pressable
                    key={option.code}
                    testID={`trip-wizard-companion-${option.code}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onSelectCompanion(option.type)}
                    className={`flex-row items-center gap-xs rounded-pill py-[9px] pl-[14px] pr-md ${
                      selected
                        ? 'bg-primary'
                        : 'border border-hairline-strong bg-canvas'
                    }`}
                  >
                    <Icon selected={selected} />
                    <Text
                      className={`text-[13.5px] font-noto-bold font-bold ${
                        selected ? 'text-on-primary' : 'text-ink'
                      }`}
                    >
                      {option.type}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* 취향 */}
          <View className="px-lg py-xs">
            <View
              testID="trip-wizard-pref-card"
              className="gap-[11px] rounded-[14px] border border-hairline bg-canvas px-[14px] pb-[14px] pt-[13px]"
            >
              <View className="flex-row items-center gap-sm">
                <SparkleGlyph />
                <Text className="flex-1 text-[14.5px] font-noto-bold font-bold text-ink">
                  당신 취향으로 맞췄어요
                </Text>
                <Pressable
                  testID="trip-wizard-pref-change"
                  accessibilityRole="button"
                  onPress={onChangePreference}
                >
                  <Text className="text-[13.5px] font-noto-bold font-bold text-primary">
                    바꾸기
                  </Text>
                </Pressable>
              </View>
              {preferenceChips.length > 0 ? (
                <View className="flex-row flex-wrap gap-sm">
                  {preferenceChips.map((chip) => (
                    <View
                      key={chip}
                      className="rounded-pill bg-primary-pale px-md py-[6px]"
                    >
                      <Text className="text-[12.5px] font-noto-bold font-bold text-primary-text">
                        {chip}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text className="text-micro text-muted">
                온보딩에서 고른 취향을 그대로 반영했어요
              </Text>
            </View>
          </View>
        </ScrollView>

        <View className="border-t border-hairline bg-canvas px-lg pb-[18px] pt-md">
          <Pressable
            testID="trip-wizard-step1-next"
            accessibilityRole="button"
            disabled={!canProceed}
            onPress={onNext}
            className={`w-full flex-row items-center justify-center gap-sm rounded-button bg-primary py-[15px] ${
              canProceed ? '' : 'opacity-40'
            }`}
          >
            <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
              다음
            </Text>
            <ChevronRightGlyph />
          </Pressable>
        </View>

        {sheetOpen ? (
          <View className="absolute inset-0 justify-end">
            <Pressable
              testID="trip-wizard-destination-sheet-backdrop"
              className="absolute inset-0 bg-scrim/40"
              onPress={() => setSheetOpen(false)}
            />
            <View
              testID="trip-wizard-destination-sheet"
              className="gap-md rounded-t-sheet-top bg-canvas p-lg"
            >
              <Text className="text-[16px] font-noto-bold font-bold text-ink">
                여행지 추가
              </Text>
              <View className="flex-row flex-wrap gap-sm">
                {regions.map((region) => {
                  const selected = sheetRegionCode === region.code;
                  return (
                    <Pressable
                      key={region.code}
                      testID={`trip-wizard-destination-region-${region.code}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setSheetRegionCode(region.code)}
                      className={`rounded-pill px-md py-sm ${
                        selected
                          ? 'bg-primary'
                          : 'border border-hairline-strong bg-canvas'
                      }`}
                    >
                      <Text
                        className={`text-label font-noto-bold font-bold ${
                          selected ? 'text-on-primary' : 'text-ink'
                        }`}
                      >
                        {region.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View className="flex-row items-center gap-md">
                <Text className="flex-1 text-[15px] font-noto-bold font-bold text-ink">
                  박수
                </Text>
                <Pressable
                  testID="trip-wizard-destination-nights-dec"
                  accessibilityRole="button"
                  disabled={sheetNights <= 1}
                  onPress={() => setSheetNights((n) => Math.max(1, n - 1))}
                  className={`h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas ${
                    sheetNights <= 1 ? 'opacity-40' : ''
                  }`}
                >
                  <StepperMinusGlyph />
                </Pressable>
                <Text className="text-[16px] font-noto-bold font-bold text-ink">
                  {sheetNights}박
                </Text>
                <Pressable
                  testID="trip-wizard-destination-nights-inc"
                  accessibilityRole="button"
                  onPress={() => setSheetNights((n) => n + 1)}
                  className="h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas"
                >
                  <StepperPlusGlyph />
                </Pressable>
              </View>
              <Pressable
                testID="trip-wizard-destination-confirm"
                accessibilityRole="button"
                disabled={sheetRegionCode === null}
                onPress={confirmDestination}
                className={`items-center justify-center rounded-button bg-primary py-md ${
                  sheetRegionCode === null ? 'opacity-40' : ''
                }`}
              >
                <Text className="text-[15px] font-noto-bold font-bold text-on-primary">
                  추가
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
