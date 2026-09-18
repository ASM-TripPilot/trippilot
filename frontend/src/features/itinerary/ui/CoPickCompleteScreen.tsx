import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackChevronGlyph, LockGlyph } from './ItineraryGlyphs';

/**
 * TRIP-335 슬라이스2 · h17 내가 고른 완성 — 순수 화면(props + 콜백만, Figma `1889:1083`).
 *
 * 무엇을 보장하나(BR-U3-07 · INV-3):
 *  - AC-7: 완성 화면은 **초안** 편이다 — 각 슬롯을 **시간대 라벨**(오후 · 전시/문화)로만 그리고
 *    **검증 시각(09:30 등)을 렌더하지 않는다**. 유일한 예외는 고정 블록(숙소 "21:00 도착 · 변경 불가").
 *    (h25 완성 시간표는 정반대로 모든 슬롯이 검증 시각을 보인다 — 개념 [[완성 일정과 초안의 시각 규칙]].)
 *  - AC-7/AC-9: 총 거리는 `legDistance` 산출 라벨("이동 X")을 **그대로** leaf 로 표시(재발명 0).
 *  - INV-3: 소요시간 문자열(분·시간)을 어디에도 싣지 않는다.
 *
 * 시각을 붙일지 여부는 배선이 `isFixed` 로 갈라 내려준다(비고정은 fixedTimeLabel 을 안 준다) —
 * 화면은 준 것만 그린다. 지도(전체 동선)는 지도 표면이 6-b 실기 전용이라 넣지 않는다(03 §지도).
 */

const APPBAR_TITLE = '내가 고른 일정';
const SECTION_TITLE = '내가 고른 일정';
const FOOTER_NOTE = '모든 슬롯을 직접 골랐어요 · 언제든 교체 가능';
const CONFIRM_LABEL = '일정 확정';
const PICKED_MARK = '✓ 직접 고름';
const FIXED_BADGE = '고정';

export interface CoPickCompleteSlot {
  slotKey: string;
  bandLabel: string;
  name: string;
  isFixed: boolean;
  fixedTimeLabel?: string;
  tagsLabel?: string;
}

export interface CoPickCompleteScreenProps {
  slots: readonly CoPickCompleteSlot[];
  /** `legDistance(...)` 결과 — 서버 distanceRange 합산 라벨("이동 X") 또는 null. */
  totalDistanceLabel: string | null;
  /** "부산 여행 · Day 1 · 6월 10일 · 화"(표시만). */
  headerLabel?: string;
  onConfirm: () => void;
  onBack: () => void;
}

export function CoPickCompleteScreen({
  slots,
  totalDistanceLabel,
  headerLabel,
  onConfirm,
  onBack,
}: CoPickCompleteScreenProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View
        testID="itinerary-copick-complete-root"
        className="flex-1 bg-canvas"
      >
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-copick-complete-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {APPBAR_TITLE}
          </Text>
        </View>

        <ScrollView contentContainerClassName="gap-md px-lg pb-lg pt-md">
          <View className="gap-[3px]">
            <Text className="font-noto-bold text-[22px] font-bold text-ink">
              {SECTION_TITLE}
            </Text>
            {headerLabel === undefined || headerLabel === '' ? null : (
              <Text className="font-noto text-label text-muted">
                {headerLabel}
              </Text>
            )}
          </View>

          <View className="w-full flex-row items-center justify-between">
            <Text className="font-noto-bold text-label font-bold text-ink">
              내가 고른 {slots.length}곳
            </Text>
            {totalDistanceLabel === null ? null : (
              <Text
                testID="itinerary-copick-complete-total"
                className="font-noto-bold text-label font-bold text-primary-text"
              >
                {totalDistanceLabel}
              </Text>
            )}
          </View>

          <View className="w-full gap-sm">
            {slots.map((slot, index) => (
              <View
                key={slot.slotKey}
                testID={`itinerary-copick-complete-slot-${slot.slotKey}`}
                className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-md py-md"
              >
                <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-primary">
                  <Text className="font-inter-bold text-caption font-bold text-on-primary">
                    {index + 1}
                  </Text>
                </View>

                <View className="flex-1 gap-[2px]">
                  <Text className="font-noto text-caption text-muted">
                    {slot.bandLabel}
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="font-noto-bold text-card-title font-bold text-ink"
                  >
                    {slot.name}
                  </Text>
                  {slot.tagsLabel === undefined ||
                  slot.tagsLabel === '' ? null : (
                    <Text className="font-noto text-caption text-muted-soft">
                      {slot.tagsLabel}
                    </Text>
                  )}
                  {slot.isFixed && slot.fixedTimeLabel !== undefined ? (
                    <Text className="font-noto text-caption text-muted">
                      {slot.fixedTimeLabel}
                    </Text>
                  ) : null}
                </View>

                {slot.isFixed ? (
                  <View className="flex-row items-center gap-xs rounded-pill bg-surface-strong px-sm py-[3px]">
                    <LockGlyph size={12} tone="muted" />
                    <Text className="font-noto-bold text-caption font-bold text-muted">
                      {FIXED_BADGE}
                    </Text>
                  </View>
                ) : (
                  <Text className="font-noto-bold text-caption font-bold text-primary-text">
                    {PICKED_MARK}
                  </Text>
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        <View className="w-full gap-sm border-t border-hairline px-lg pb-lg pt-sm">
          <Text className="text-center font-noto text-caption text-muted">
            {FOOTER_NOTE}
          </Text>
          <Pressable
            testID="itinerary-copick-complete-confirm"
            accessibilityRole="button"
            onPress={onConfirm}
            className="h-12 w-full items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              {CONFIRM_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
