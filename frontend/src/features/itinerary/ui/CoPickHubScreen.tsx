import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  BackChevronGlyph,
  ChevronRightGlyph,
  LockGlyph,
} from './ItineraryGlyphs';

/**
 * TRIP-335 슬라이스2 · h16 슬롯 채우기 허브 — 순수 화면(props + 콜백만, Figma `1890:1083`).
 *
 * 무엇을 보장하나:
 *  - AC-6: 진행 카운터("N/M 슬롯 선택됨 · 남은 K개")를 **props(`progress`)로만** 그린다. 화면은
 *    카운트를 재계산하지 않는다(재판정 금지 — 판정은 순수 함수 한 곳에만 살고 배선이 부른다). 그래서
 *    이 파일은 그 함수를 import 하지 않는다(구조 가드가 잠근다).
 *  - E2: "고른 일정 확정" CTA 는 `progress.remaining > 0` 이면 접근성 disabled + onPress 미부여
 *    (부분 확정 불허, 죽은 버튼 회피).
 *  - 슬롯 상태(찬/빈/고정)는 색이 아니라 **텍스트**("변경"/"고르기"/"고정")로 관찰 가능하게 한다.
 *
 * 지도(동선 핀)는 지도 표면이 6-b 실기 전용이라(가짜 SDK) 이 화면에 넣지 않는다(03 §지도 참조).
 */

const APPBAR_TITLE = '함께 고르기';
const CONFIRM_LABEL = '고른 일정 확정';
const PICK_LABEL = '고르기 ›';
const CHANGE_LABEL = '변경 ›';
const FIXED_BADGE = '고정';

export interface CoPickHubSlot {
  slotKey: string;
  bandLabel: string;
  name: string;
  status: 'filled' | 'empty' | 'fixed';
  fixedTimeLabel?: string;
}

export interface CoPickHubScreenProps {
  slots: readonly CoPickHubSlot[];
  /** 진행 판정 — 배선이 순수 함수로 산출해 내린다(재판정 금지). */
  progress: { total: number; filled: number; remaining: number };
  onPickSlot: (slotKey: string) => void;
  onChangeSlot: (slotKey: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function CoPickHubScreen({
  slots,
  progress,
  onPickSlot,
  onChangeSlot,
  onConfirm,
  onBack,
}: CoPickHubScreenProps): ReactElement {
  const confirmDisabled = progress.remaining > 0;
  const progressLabel = `${progress.filled}/${progress.total} 슬롯 선택됨 · 남은 ${progress.remaining}개 고르면 완성`;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="itinerary-copick-hub-root" className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-copick-hub-back"
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

        <ScrollView contentContainerClassName="gap-sm px-lg pb-lg pt-md">
          {slots.map((slot, index) => (
            <View
              key={slot.slotKey}
              testID={`itinerary-copick-hub-slot-${slot.slotKey}`}
              className={`w-full flex-row items-center gap-md rounded-card border px-md py-md ${
                slot.status === 'empty'
                  ? 'border-dashed border-primary'
                  : 'border-hairline bg-canvas'
              }`}
            >
              <View className="h-[26px] w-[26px] items-center justify-center rounded-pill bg-surface-soft">
                <Text className="font-inter-bold text-caption font-bold text-muted">
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
                {slot.status === 'fixed' &&
                slot.fixedTimeLabel !== undefined ? (
                  <Text className="font-noto text-caption text-muted">
                    {slot.fixedTimeLabel}
                  </Text>
                ) : null}
              </View>

              {slot.status === 'fixed' ? (
                <View className="flex-row items-center gap-xs rounded-pill bg-surface-strong px-sm py-[3px]">
                  <LockGlyph size={12} tone="muted" />
                  <Text className="font-noto-bold text-caption font-bold text-muted">
                    {FIXED_BADGE}
                  </Text>
                </View>
              ) : slot.status === 'empty' ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onPickSlot(slot.slotKey)}
                  hitSlop={6}
                >
                  <Text className="font-noto-bold text-label font-bold text-primary-text">
                    {PICK_LABEL}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onChangeSlot(slot.slotKey)}
                  hitSlop={6}
                >
                  <Text className="font-noto-bold text-label font-bold text-muted">
                    {CHANGE_LABEL}
                  </Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>

        <View className="w-full gap-sm border-t border-hairline px-lg pb-lg pt-sm">
          <Text
            testID="itinerary-copick-hub-progress"
            className="text-center font-noto text-caption text-muted"
          >
            {progressLabel}
          </Text>
          <Pressable
            testID="itinerary-copick-hub-confirm"
            accessibilityRole="button"
            disabled={confirmDisabled}
            onPress={confirmDisabled ? undefined : onConfirm}
            className={`h-12 w-full items-center justify-center rounded-button ${
              confirmDisabled ? 'bg-surface-strong' : 'bg-primary'
            }`}
          >
            <Text
              className={`font-noto-bold text-[16px] font-bold ${
                confirmDisabled ? 'text-muted' : 'text-on-primary'
              }`}
            >
              {CONFIRM_LABEL}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
