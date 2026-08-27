import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  ItineraryDaysItem,
  ItineraryDaysItemSlotsItem,
} from '@/shared/api/generated/schemas';

import {
  BackChevronGlyph,
  LockGlyph,
  PlusGlyph,
  TrashGlyph,
  UndoGlyph,
  WarningTriangleGlyph,
} from './ManualEditGlyphs';

/**
 * TRIP-443 · 공용 편집 셸(shared 승격) — planb가 `<ManualEditShell mode="normal"|"fallback">`로
 * 소비한다(i15 정상 편집 / i22 외부 API 오류 폴백). mode 하나가 4변형 축을 함께 켜/꺼짐한다:
 *  ① 누락 배너(fallback만) ② 상단 안내줄+이력(normal만) ③ 지도 문구 "이동시간 미상"(fallback만)
 *  ④ 시각 직접입력 [시각 입력](fallback·비잠금만).
 * 위반 배지·잠금 "변경 불가"·[저장]·[+ 장소 추가]·휴지통은 **두 mode 공통**(mode 게이팅 밖) —
 * [직접 고르기] 편집(i15)도 고정 슬롯 충돌이 가능하고, 잠금은 어느 얼굴에서도 지켜야 한다.
 *
 * 잠금 판정 = `slot.isFixed === true || lockedSlotKeys.includes(slotKey)`(숙소 체크인=isFixed,
 * 완료=상위가 넘긴 lockedSlotKeys). 잠금 슬롯엔 휴지통·[시각 입력]이 **아예 안 붙는다**(요소 부재).
 *
 * 소요시간 문자열은 어디에도 없다(INV-3) — 시각은 솔버 검증 시각(startAt–endAt)만, 폴백 구간은
 * 숫자 없는 "이동시간 미상" 라벨만(거리도 값이 없어 안 그림). 점선 지도는 단순 표현(라벨·문구, 확정
 * 설계 결정) — KakaoMapView 점선 확장은 후속.
 */

export type ManualEditMode = 'normal' | 'fallback';

export interface ManualEditShellProps {
  mode: ManualEditMode;
  days: ItineraryDaysItem[];
  activeDayIndex?: number;
  /** 잠금 슬롯 키(완료·시각고정·숙소 체크인/아웃) — 휴지통·HH:mm 입력이 안 붙는다. */
  lockedSlotKeys?: string[];
  onBack: () => void;
  onSave: () => void;
  onPressAddPlace?: () => void;
  onDeleteSlot?: (poiId: string) => void;
  onReorder?: (data: ItineraryDaysItemSlotsItem[]) => void;
  onEditSlotTime?: (slotKey: string) => void;
  onPressHistory?: () => void;
}

const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

function SlotCard({
  slot,
  date,
  mode,
  isLocked,
  onDeleteSlot,
  onEditSlotTime,
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  mode: ManualEditMode;
  isLocked: boolean;
  onDeleteSlot?: (poiId: string) => void;
  onEditSlotTime?: (slotKey: string) => void;
}): ReactElement {
  const slotKey = `${date}#${slot.poiId}`;
  const tagLine = slot.tags.length > 0 ? `#${slot.tags.join(' · ')}` : '';
  // 폴백·비잠금 슬롯은 도착 시각이 미확인이라 사용자 입력을 유도한다(숫자 없음 → INV-3 안전).
  const timeText =
    mode === 'fallback' && !isLocked
      ? '--:-- · 도착 시각 직접 입력'
      : `${slot.startAt.slice(0, 5)}–${
          slot.endsNextDay ? '익일 ' : ''
        }${slot.endAt.slice(0, 5)}`;

  return (
    <View testID={`planb-manual-slot-${slotKey}`} className="w-full">
      {/* 위반 배지 — mode 무관 공통(hasViolation 이면 두 얼굴 다 뜬다, AC-2·BR-U3-13). */}
      {slot.hasViolation ? (
        <View
          testID={`planb-manual-violation-${slotKey}`}
          className="mb-xs flex-row items-center gap-xs rounded-button bg-primary-pale px-sm py-xs"
        >
          {slot.violationReason === null ||
          slot.violationReason === undefined ? (
            <Text className="font-noto text-caption text-primary-text">
              숙소 고정 충돌
            </Text>
          ) : (
            <Text className="font-noto text-caption text-primary-text">
              {slot.violationReason}
            </Text>
          )}
        </View>
      ) : null}

      <View
        style={cardShadow}
        className={`mb-[14px] w-full flex-row items-center gap-[10px] rounded-card border p-md ${
          isLocked
            ? 'border-hairline bg-surface-soft'
            : 'border-hairline bg-canvas'
        }`}
      >
        {isLocked ? (
          <View className="h-[38px] w-[38px] items-center justify-center rounded-pill bg-primary-pale">
            <LockGlyph />
          </View>
        ) : null}

        <View className="flex-1 gap-[6px]">
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {slot.nameKo ?? slot.poiId}
          </Text>
          <Text className="font-noto text-caption text-muted">{timeText}</Text>
          {tagLine === '' ? null : (
            <Text className="font-noto text-caption text-muted-soft">
              {tagLine}
            </Text>
          )}
        </View>

        {isLocked ? (
          <View
            testID={`planb-manual-locked-${slotKey}`}
            className="flex-row items-center gap-xs self-start"
          >
            <Text className="font-noto-bold text-caption font-bold text-muted">
              변경 불가
            </Text>
          </View>
        ) : (
          <View className="flex-row items-center gap-sm self-start">
            {mode === 'fallback' ? (
              <Pressable
                testID={`planb-manual-time-input-${slotKey}`}
                accessibilityRole="button"
                onPress={() => onEditSlotTime?.(slotKey)}
                className="rounded-pill border border-hairline-strong px-md py-xs"
              >
                <Text className="font-noto-bold text-caption font-bold text-ink">
                  시각 입력
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              testID={`planb-manual-delete-${slotKey}`}
              accessibilityRole="button"
              accessibilityLabel="삭제"
              onPress={() => onDeleteSlot?.(slot.poiId)}
              hitSlop={6}
            >
              <TrashGlyph />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

export function ManualEditShell({
  mode,
  days,
  activeDayIndex = 0,
  lockedSlotKeys = [],
  onBack,
  onSave,
  onPressAddPlace,
  onDeleteSlot,
  onEditSlotTime,
  onPressHistory,
}: ManualEditShellProps): ReactElement {
  const activeDay = days[activeDayIndex];
  const activeDate = activeDay?.date ?? '';
  const slots = activeDay?.slots ?? [];

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View testID="planb-manual-root" className="flex-1 bg-canvas">
        {/* appbar */}
        <View className="w-full flex-row items-center gap-[6px] border-b border-hairline bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="planb-manual-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-[18px] font-bold text-ink">
            {mode === 'fallback' ? '일정 직접 수정' : '일정 편집'}
          </Text>
        </View>

        {/* ② 상단 안내줄 + 이력 — normal 만(폴백은 누락 배너가 대체). */}
        {mode === 'normal' ? (
          <View
            testID="planb-manual-hint"
            className="w-full flex-row items-center gap-xs border-b border-hairline bg-canvas px-lg py-sm"
          >
            <UndoGlyph />
            <Text className="flex-1 font-noto text-caption text-muted">
              순서·시각 편집은 언제든 되돌릴 수 있어요
            </Text>
            <Pressable
              testID="planb-manual-history"
              accessibilityRole="button"
              onPress={onPressHistory}
              hitSlop={6}
            >
              <Text className="font-noto-bold text-caption font-bold text-primary-text">
                이력 ›
              </Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView>
          <View className="gap-[14px] px-lg pb-lg pt-md">
            {/* ① 누락 배너 — fallback 만(외부 정보 실패, INV-4 침묵 금지). */}
            {mode === 'fallback' ? (
              <View
                testID="planb-manual-missing-data"
                className="w-full flex-row items-start gap-sm rounded-card bg-surface-soft px-md py-md"
              >
                <WarningTriangleGlyph />
                <View className="flex-1 gap-[2px]">
                  <Text className="font-noto-bold text-label font-bold text-ink">
                    지금은 이동시간을 자동 계산할 수 없어요
                  </Text>
                  <Text className="font-noto text-caption text-muted">
                    외부 정보를 불러오지 못해 수동 모드로 전환했어요
                  </Text>
                </View>
              </View>
            ) : null}

            {/* 지도 — 단순 표현(placeholder). 폴백은 "이동시간 미상" 라벨만(점선 확장은 후속). */}
            <View className="h-[200px] w-full items-center justify-center gap-xs rounded-card border border-hairline bg-surface-soft">
              {mode === 'fallback' ? (
                <Text
                  testID="planb-manual-map-unknown"
                  className="font-noto text-label text-muted"
                >
                  이동시간 미상
                </Text>
              ) : (
                <Text className="font-noto text-label text-muted">지도</Text>
              )}
            </View>

            {mode === 'fallback' ? (
              <Text className="font-noto text-caption text-muted">
                이동 구간(점선)은 자동 계산 불가 — 직접 입력하세요
              </Text>
            ) : null}

            {/* day header */}
            <View className="flex-row items-center gap-sm">
              <View className="h-[18px] w-[4px] rounded-[2px] bg-primary" />
              <Text className="font-noto-bold text-section font-bold text-ink">
                {`Day ${activeDayIndex + 1}`}
              </Text>
              <View className="flex-1" />
              <Text className="font-noto text-label text-muted">{`${slots.length}곳`}</Text>
            </View>

            {/* 슬롯 목록 — 드래그 재정렬은 후속(react-native-draggable-flatlist 미배선). */}
            {slots.map((slot) => (
              <SlotCard
                key={`${activeDate}#${slot.poiId}`}
                slot={slot}
                date={activeDate}
                mode={mode}
                isLocked={
                  slot.isFixed === true ||
                  lockedSlotKeys.includes(`${activeDate}#${slot.poiId}`)
                }
                onDeleteSlot={onDeleteSlot}
                onEditSlotTime={onEditSlotTime}
              />
            ))}

            <Pressable
              testID="planb-manual-add-place"
              accessibilityRole="button"
              onPress={onPressAddPlace}
              className="w-full flex-row items-center justify-center gap-xs rounded-button border border-hairline-strong bg-canvas py-md"
            >
              <PlusGlyph />
              <Text className="font-noto-bold text-body font-bold text-ink">
                장소 추가
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <View className="w-full px-lg pb-lg pt-sm">
          <Pressable
            testID="planb-manual-save"
            accessibilityRole="button"
            onPress={onSave}
            className="h-12 w-full items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              {mode === 'fallback' ? '저장' : '저장하기'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
