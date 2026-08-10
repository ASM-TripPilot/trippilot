import type { ReactElement } from 'react';
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { MUST_VISIT_NAME_PLACEHOLDER } from '../model/mustVisitList';
import {
  DWELL_OPTIONS,
  startTimeLabel,
  canSubmitMustVisitTime,
  type DwellKey,
  type MustVisitTimeForm,
} from '../model/mustVisitTimeForm';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  ChevronDownGlyph,
  ClockGlyph,
  InfoCircleGlyph,
} from './ItineraryGlyphs';

/**
 * h07 방문 시각 지정 — Figma `1904:1083`.
 *
 * 화면은 완성된 props 만 받는다. 여행 기간도 시각 목록도 배선이 계산해 내려주고, 여기서는
 * **시트가 열려 있는가** 하나만 스스로 쥔다(순수 표시 상태라 배선이 알 이유가 없다).
 *
 * 토글이 꺼져 있으면 날짜·시각·체류·저장이 **정말로** 잠긴다(01b D8) — 회색으로 칠하는 것만으로는
 * 부족해서 `disabled` prop 을 걸어 press 자체를 막는다.
 */

const SCREEN_TITLE = '방문 시각 지정';
const PLACE_CHIP = '고정';
const PLACE_SUFFIX = '꼭 갈 곳';
const TOGGLE_TITLE = '시각 고정';
const TOGGLE_NOTE = '예약·공연처럼 시간이 정해진 곳에 켜세요';
const DATE_SECTION = '방문 날짜';
const START_SECTION = '시작 시각';
const START_PLACEHOLDER = '시각 선택';
const SHEET_CLOSE = '닫기';
const DWELL_SECTION = '체류 시간';
const NOTICE = '안 정하면 AI가 영업시간·동선 맞춰 자동 배치해요';
const SUBMIT_LABEL = '이 시각으로 고정';
const RETRY_LABEL = '다시 시도';

/** 저장이 막힌 사유 → 사용자가 읽을 문장. 막혔는데 이유가 없으면 회색 버튼만 남는다
 * (BR-U1-55 · `TripBaseFixSheet.saveBlockedReason` 선례). */
const BLOCK_REASON_TEXT: Record<'DATE_MISSING' | 'START_MISSING', string> = {
  DATE_MISSING: '방문 날짜를 골라 주세요',
  START_MISSING: '시작 시각을 골라 주세요',
};

// 카드·세그먼트 그림자(Figma `0px 2px 10px rgba(0,0,0,0.06)`) — 그림자는 토큰 대상이 아니다.
const softShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

export interface MustVisitTimeScreenProps {
  sourcePoiId: string;
  placeName: string | null;
  region?: string | null;
  imageUrl?: string | null;
  dayChips: { date: string; label: string }[];
  /** 30분 간격 하루치. 화면은 받은 목록을 그대로 그린다. */
  startOptions: string[];
  form: MustVisitTimeForm;
  blockReason?: 'DATE_MISSING' | 'START_MISSING' | null;
  /** 저장 실패 안내. 사유(`blockReason`)보다 우선한다 — 서버가 대답한 쪽이 더 새 사실이다. */
  errorText?: string;
  /** 409 안내 슬롯. **실패 슬롯과 다른 자리다** — 하나로 합치면 409 가 실패로 되살아난다. */
  duplicateText?: string;
  onBack?(): void;
  onToggleFixed?(next: boolean): void;
  onPickDate?(date: string): void;
  onPickStart?(start: string): void;
  onPickDwell?(key: DwellKey): void;
  onSubmit?(): void;
  /** 주면 재시도 버튼이 선다. 실패가 **복구 가능할 때만** 배선이 넘긴다(01b D1). */
  onRetry?(): void;
}

function renderSheetBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

function SectionLabel({ text }: { text: string }): ReactElement {
  return (
    <Text className="font-noto-bold text-body font-bold text-ink">{text}</Text>
  );
}

/** 세그먼트 한 칸 — 날짜·체류가 같은 모양을 쓴다(Figma `1904:1104` · `1904:1122`). */
function SegmentItem({
  testID,
  label,
  selected,
  disabled,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      style={selected ? softShadow : undefined}
      className={`flex-1 items-center justify-center rounded-[9px] py-sm ${
        selected ? 'bg-canvas' : ''
      }`}
    >
      <Text
        className={`text-body ${
          selected
            ? 'font-noto-bold font-bold text-ink'
            : 'font-noto text-muted'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function MustVisitTimeScreen({
  sourcePoiId,
  placeName,
  region,
  imageUrl,
  dayChips,
  startOptions,
  form,
  blockReason,
  errorText,
  duplicateText,
  onBack,
  onToggleFixed,
  onPickDate,
  onPickStart,
  onPickDwell,
  onSubmit,
  onRetry,
}: MustVisitTimeScreenProps): ReactElement {
  // 시트를 상시 마운트하면 닫힌 상태에서도 48개 옵션이 트리에 남는다 — 열렸을 때만 만든다
  // (`TripWizardStep2Screen` 의 `fixSheet === undefined ? null : …` 과 같은 형태).
  const [startSheetOpen, setStartSheetOpen] = useState(false);

  const locked = !form.fixed;
  const canSubmit = canSubmitMustVisitTime(form);
  const reasonText =
    blockReason == null ? undefined : BLOCK_REASON_TEXT[blockReason];
  const errorLine = errorText ?? reasonText;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View
        testID={`itinerary-mustvisit-time-${sourcePoiId}`}
        className="flex-1 bg-canvas"
      >
        <View className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-mustvisit-time-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {SCREEN_TITLE}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-[18px] px-lg pb-2xl pt-sm">
          <View
            style={softShadow}
            className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas py-md pl-md pr-[14px]"
          >
            <View className="h-[64px] w-[64px] overflow-hidden rounded-thumb bg-surface-strong">
              {imageUrl == null ? null : (
                <Image
                  source={{ uri: imageUrl }}
                  resizeMode="cover"
                  className="h-full w-full"
                />
              )}
            </View>
            <View className="flex-1 items-start gap-xs">
              <View className="rounded-pill bg-primary-pale px-sm py-[3px]">
                <Text className="font-noto-bold text-micro font-bold text-primary-text">
                  {PLACE_CHIP}
                </Text>
              </View>
              <Text
                numberOfLines={1}
                className="font-noto-bold text-card-title font-bold text-ink"
              >
                {placeName ?? MUST_VISIT_NAME_PLACEHOLDER}
              </Text>
              <Text
                testID="itinerary-mustvisit-time-subtitle"
                numberOfLines={1}
                className="font-noto text-caption text-muted"
              >
                {region ? `${region} · ${PLACE_SUFFIX}` : PLACE_SUFFIX}
              </Text>
            </View>
          </View>

          <View
            style={softShadow}
            className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-lg py-[14px]"
          >
            <View className="flex-1 gap-[3px]">
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {TOGGLE_TITLE}
              </Text>
              <Text className="font-noto text-caption text-muted">
                {TOGGLE_NOTE}
              </Text>
            </View>
            <Pressable
              testID="itinerary-mustvisit-time-toggle"
              accessibilityRole="switch"
              accessibilityLabel={TOGGLE_TITLE}
              accessibilityState={{ checked: form.fixed }}
              onPress={() => onToggleFixed?.(!form.fixed)}
              className={`h-[28px] w-[46px] rounded-[14px] ${
                form.fixed ? 'bg-primary' : 'bg-hairline-strong'
              }`}
            >
              <View
                style={softShadow}
                className={`absolute top-[3px] h-[22px] w-[22px] rounded-pill bg-canvas ${
                  form.fixed ? 'left-[22px]' : 'left-[3px]'
                }`}
              />
            </Pressable>
          </View>

          <View className={`w-full gap-sm ${locked ? 'opacity-40' : ''}`}>
            <SectionLabel text={DATE_SECTION} />
            <View className="w-full flex-row items-center rounded-button bg-hairline p-[3px]">
              {dayChips.map((chip) => (
                <SegmentItem
                  key={chip.date}
                  testID={`itinerary-mustvisit-time-date-${chip.date}`}
                  label={chip.label}
                  selected={form.fixedDate === chip.date}
                  disabled={locked}
                  onPress={() => onPickDate?.(chip.date)}
                />
              ))}
            </View>
          </View>

          <View className={`w-full gap-sm ${locked ? 'opacity-40' : ''}`}>
            <SectionLabel text={START_SECTION} />
            <Pressable
              testID="itinerary-mustvisit-time-start-field"
              accessibilityRole="button"
              disabled={locked}
              onPress={() => setStartSheetOpen(true)}
              className="w-full flex-row items-center gap-[10px] rounded-button border border-hairline-strong bg-canvas px-[14px] py-[13px]"
            >
              <ClockGlyph />
              <Text
                className={`flex-1 font-noto-bold text-card-title font-bold ${
                  form.fixedStart === null ? 'text-muted-soft' : 'text-ink'
                }`}
              >
                {form.fixedStart === null
                  ? START_PLACEHOLDER
                  : startTimeLabel(form.fixedStart)}
              </Text>
              <ChevronDownGlyph />
            </Pressable>
          </View>

          <View className={`w-full gap-sm ${locked ? 'opacity-40' : ''}`}>
            <SectionLabel text={DWELL_SECTION} />
            <View className="w-full flex-row items-center rounded-button bg-hairline p-[3px]">
              {DWELL_OPTIONS.map((option) => (
                <SegmentItem
                  key={option.key}
                  testID={`itinerary-mustvisit-time-dwell-${option.key}`}
                  label={option.label}
                  selected={form.dwellKey === option.key}
                  disabled={locked}
                  onPress={() => onPickDwell?.(option.key)}
                />
              ))}
            </View>
          </View>

          {duplicateText === undefined ? null : (
            <View className="w-full flex-row items-center gap-[10px] rounded-button border border-hairline bg-primary-pale px-[14px] py-md">
              <InfoCircleGlyph tone="primaryText" />
              <Text
                testID="itinerary-mustvisit-time-duplicate"
                className="flex-1 font-noto text-label text-primary-text"
              >
                {duplicateText}
              </Text>
            </View>
          )}

          {errorLine === undefined ? null : (
            <View className="w-full flex-row items-center gap-[10px] rounded-button border border-hairline bg-surface-soft px-[14px] py-md">
              <AlertCircleGlyph />
              <Text
                testID="itinerary-mustvisit-time-error"
                className="flex-1 font-noto text-label text-primary-text"
              >
                {errorLine}
              </Text>
              {onRetry === undefined ? null : (
                <Pressable
                  testID="itinerary-mustvisit-time-retry"
                  accessibilityRole="button"
                  onPress={onRetry}
                  hitSlop={6}
                >
                  <Text className="font-noto-bold text-label font-bold text-primary">
                    {RETRY_LABEL}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <View className="w-full flex-row items-center gap-[10px] rounded-button border border-hairline bg-surface-soft px-[14px] py-md">
            <InfoCircleGlyph />
            <Text
              testID="itinerary-mustvisit-time-notice"
              className="flex-1 font-noto text-label text-body"
            >
              {NOTICE}
            </Text>
          </View>

          <Pressable
            testID="itinerary-mustvisit-time-submit"
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={onSubmit}
            className={`w-full items-center justify-center rounded-button py-lg ${
              canSubmit ? 'bg-primary' : 'bg-hairline-strong'
            }`}
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              {SUBMIT_LABEL}
            </Text>
          </Pressable>
        </ScrollView>

        {startSheetOpen ? (
          <BottomSheet backdropComponent={renderSheetBackdrop}>
            <BottomSheetScrollView
              testID="itinerary-mustvisit-time-start-sheet"
              className="w-full"
            >
              <View className="w-full flex-row items-center gap-sm px-lg pb-sm pt-xs">
                <Text className="flex-1 font-noto-bold text-section font-bold text-ink">
                  {START_SECTION}
                </Text>
                <Pressable
                  testID="itinerary-mustvisit-time-start-close"
                  accessibilityRole="button"
                  onPress={() => setStartSheetOpen(false)}
                  hitSlop={8}
                >
                  <Text className="font-noto text-label text-muted">
                    {SHEET_CLOSE}
                  </Text>
                </Pressable>
              </View>
              {startOptions.map((option) => (
                <Pressable
                  key={option}
                  testID={`itinerary-mustvisit-time-start-option-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.fixedStart === option }}
                  onPress={() => {
                    onPickStart?.(option);
                    setStartSheetOpen(false);
                  }}
                  className="w-full px-lg py-md"
                >
                  <Text
                    className={`text-card-title ${
                      form.fixedStart === option
                        ? 'font-noto-bold font-bold text-primary'
                        : 'font-noto text-ink'
                    }`}
                  >
                    {startTimeLabel(option)}
                  </Text>
                </Pressable>
              ))}
            </BottomSheetScrollView>
          </BottomSheet>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
