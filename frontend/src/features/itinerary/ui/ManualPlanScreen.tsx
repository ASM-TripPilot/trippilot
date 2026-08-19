import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import { formatDraftDayHeader } from '../model/draftView';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import { BackChevronGlyph, PencilGlyph, PlusGlyph } from './ItineraryGlyphs';

/**
 * TRIP-338 · h19 직접 짜기(빈 일정) 화면 — Figma `1893:1083`. **props-only**(서버·스토어를 모른다).
 *
 * 무엇을 그리나:
 *  - 빈 일자(slots 0)면 흰 화면이 아니라 **4시간대 밴드 안내**("이 시간에 장소 추가") + 하단 검색 CTA.
 *  - 채워진 슬롯이면 슬롯 카드(위반이 붙었으면 배지를 지속 표시 — BR-U3-13). 서버가 준 `days` 만
 *    받는 구조라 미저장(미검증) 시각이 확정 슬롯으로 샐 길이 없다(INV-2, 02a §3 AC-6).
 *
 * §8③ 각색: hero 부제는 Figma 원문("시각·이동시간을 AI가 맞춰드려요")을 그대로 안 쓴다 — MANUAL 은
 * AI 를 안 부르고(정직), "이동시간"은 INV-3 소요시간 어휘라 AC-7 스캔이 막는다. §8④: 빈 밴드 라벨은
 * 시간 축(오전/점심/오후/저녁)만 — 성격 축(활동·식사·전시…)은 정본 매핑이 없다(TRIP-297 h11 선례).
 */

const SCREEN_TITLE = '직접 일정을 짜요';
const HERO_TITLE = '직접 일정을 짜 볼까요';
const HERO_SUBTITLE = '가고 싶은 장소를 시간대별로 담아 나만의 순서로 완성해요';
const SLOT_ADD_LABEL = '이 시간에 장소 추가';
const SEARCH_CTA_LABEL = '장소 검색해서 추가';
const VIOLATION_FALLBACK = '검토가 필요해요';

export type ManualPlanTimeBand = 'morning' | 'lunch' | 'afternoon' | 'evening';

const BANDS: ManualPlanTimeBand[] = [
  'morning',
  'lunch',
  'afternoon',
  'evening',
];

/** 빈 밴드 시간대 라벨(시간 축만, §8④). `timeBandLabel` 의 4값과 결이 같다. */
const BAND_LABEL: Record<ManualPlanTimeBand, string> = {
  morning: '오전',
  lunch: '점심',
  afternoon: '오후',
  evening: '저녁',
};

export interface ManualPlanScreenProps {
  /** 일정 일자 — 빈 slots면 빈 상태 밴드, 채워지면 슬롯 카드. */
  days: ItineraryDaysItem[];
  /** appbar 뒤로. */
  onBack(): void;
  /** 하단 CTA "장소 검색해서 추가" → h20. */
  onPressSearchAdd(): void;
  /** 정적 컨텍스트 칩(Q3, 옵셔널). */
  contextChips?: string[];
  /** 밴드별 "이 시간에 장소 추가"(옵셔널). */
  onPressAddBand?(band: ManualPlanTimeBand): void;
  /** 다일자 활성 인덱스(옵셔널, 기본 0). */
  activeDayIndex?: number;
}

/** 빈 시간대 밴드 한 줄(점선 카드) — 밴드 라벨 + "이 시간에 장소 추가". */
function EmptyBand({
  band,
  onPress,
}: {
  band: ManualPlanTimeBand;
  onPress?: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={`itinerary-manual-band-${band}`}
      accessibilityRole="button"
      onPress={onPress}
      className="w-full flex-row items-center gap-md rounded-[14px] border-[1.5px] border-dashed border-primary bg-canvas px-lg py-md"
    >
      <View className="h-[30px] w-[30px] items-center justify-center rounded-pill bg-primary-pale">
        <PlusGlyph size={16} tone="primary" />
      </View>
      <View className="min-w-0 flex-1 gap-[2px]">
        <Text className="font-noto text-micro text-muted">
          {BAND_LABEL[band]}
        </Text>
        <Text className="font-noto-bold text-body font-bold text-primary-text">
          {SLOT_ADD_LABEL}
        </Text>
      </View>
    </Pressable>
  );
}

/** 채워진 슬롯 카드 — 이름 + 시각(초안이라 비고정은 시간대 라벨, 고정만 시각 노출 · DEC-U3-3) +
 * 위반 배지(hasViolation 일 때만 지속 표시, BR-U3-13). 내부 그림은 Figma 공백이라 최소 표면이다. */
function SlotCard({
  date,
  slot,
}: {
  date: string;
  slot: ItineraryDaysItem['slots'][number];
}): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const timeText = slot.isFixed
    ? slot.startAt.slice(0, 5)
    : timeBandLabel(slot.startAt);
  return (
    <View
      testID={`itinerary-manual-slot-${slotKey}`}
      className="w-full gap-sm rounded-card border border-hairline bg-canvas px-lg py-md"
    >
      <View className="flex-row items-center justify-between gap-sm">
        <Text
          className="min-w-0 flex-1 font-noto-bold text-card-title font-bold text-ink"
          numberOfLines={1}
        >
          {slot.nameKo ?? '이름 준비 중'}
        </Text>
        <Text className="font-noto text-label text-muted">{timeText}</Text>
      </View>
      {slot.hasViolation ? (
        <View
          testID={`itinerary-manual-violation-${slotKey}`}
          className="w-full rounded-button bg-primary-pale px-md py-sm"
        >
          <Text className="font-noto text-micro text-primary-text">
            {slot.violationReason ?? VIOLATION_FALLBACK}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function ManualPlanScreen({
  days,
  onBack,
  onPressSearchAdd,
  contextChips,
  onPressAddBand,
  activeDayIndex = 0,
}: ManualPlanScreenProps): ReactElement {
  const activeDay = days[activeDayIndex];
  const slots = activeDay?.slots ?? [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="itinerary-manual-root" className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas py-[14px] pl-md pr-lg">
          <Pressable
            testID="itinerary-manual-back"
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

        <ScrollView contentContainerClassName="gap-md px-lg pb-2xl pt-sm">
          <View className="w-full flex-row items-center gap-md rounded-card bg-primary-pale px-lg py-lg">
            <View className="h-11 w-11 items-center justify-center rounded-pill bg-primary">
              <PencilGlyph size={22} tone="white" />
            </View>
            <View className="min-w-0 flex-1 gap-[3px]">
              <Text className="font-noto-bold text-card-title font-bold text-primary-text">
                {HERO_TITLE}
              </Text>
              <Text className="font-noto text-[12.5px] text-primary-text">
                {HERO_SUBTITLE}
              </Text>
            </View>
          </View>

          {contextChips && contextChips.length > 0 ? (
            <View className="w-full flex-row flex-wrap gap-sm">
              {contextChips.map((chip) => (
                <View
                  key={chip}
                  className="rounded-pill border border-hairline-strong px-md py-[6px]"
                >
                  <Text className="font-noto text-label text-body">{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {activeDay ? (
            <>
              <View className="w-full flex-row items-center gap-sm pt-sm">
                <View className="h-[18px] w-1 rounded-[2px] bg-primary" />
                <Text className="font-noto-bold text-section font-bold text-ink">
                  Day {activeDayIndex + 1}
                </Text>
                <Text className="font-noto text-label text-muted">
                  {formatDraftDayHeader(activeDay.date)}
                </Text>
                <View className="flex-1" />
                <Text className="font-noto text-label text-muted">
                  {slots.length}곳
                </Text>
              </View>

              <View className="w-full gap-sm">
                {slots.length === 0
                  ? BANDS.map((band) => (
                      <EmptyBand
                        key={band}
                        band={band}
                        onPress={
                          onPressAddBand
                            ? () => onPressAddBand(band)
                            : undefined
                        }
                      />
                    ))
                  : slots.map((slot) => (
                      <SlotCard
                        key={slot.poiId}
                        date={activeDay.date}
                        slot={slot}
                      />
                    ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        <View className="w-full border-t border-hairline bg-canvas px-lg py-md">
          <Pressable
            testID="itinerary-manual-search-cta"
            accessibilityRole="button"
            onPress={onPressSearchAdd}
            className="w-full flex-row items-center justify-center gap-sm rounded-button bg-primary py-md"
          >
            <PlusGlyph size={18} tone="white" />
            <Text className="font-noto-bold text-card-title font-bold text-on-primary">
              {SEARCH_CTA_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
