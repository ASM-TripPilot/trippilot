import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

/**
 * TRIP-443 · i15·i22 [시각 입력] 시트 — 비잠금 슬롯의 도착·출발 시각을 직접 고친다.
 * `features/itinerary/ui/SlotTimeSheet` 와 계약 동형이나 features 경계로 shared 로컬 복제한다.
 *
 * 이 리포엔 휠(스크롤-스냅) 시각 피커가 없고 jest 는 스크롤-스냅을 구동하지 못한다. 그래서 시·분을
 * **값별 셀**로 두고 누르면 그 값이 선택된다(h07/h24 선례). "휠" 비주얼은 그 위의 스크롤이다.
 *
 * 클라는 시간 타당성을 판정하지 않는다(INV-2) — [적용]은 항상 열려 있고, `endsNextDay` 는
 * `end ≤ start`(HH:mm 사전식) 의 기계적 유도다(HC4). 최종 판정은 저장 시 서버 재검증 몫이다.
 * 분 셀은 bare 숫자("30")다 — "30분" 으로 그리면 소요시간 가드가 시계 분을 오탐한다(INV-3).
 *
 * ★ 시트 실제 열림·HH:mm 반영은 `@gorhom/bottom-sheet` 통과형 목이 원리적으로 못 본다 —
 *   6-b 실기(프리뷰 `planb-manual-fallback`)가 유일 그물(repo-traps 바텀시트 절).
 */

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0')
);

export interface ManualTimeSheetProps {
  /** 현재값 "HH:mm:ss". */
  startAt: string;
  endAt: string;
  onApply: (patch: {
    startAt: string;
    endAt: string;
    endsNextDay: boolean;
  }) => void;
  onCancel: () => void;
}

function renderTimeSheetBackdrop(
  props: BottomSheetBackdropProps
): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

function TimeCell({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`items-center justify-center rounded-button px-md py-sm ${
        selected ? 'bg-primary-pale' : ''
      }`}
    >
      <Text
        className={`text-card-title ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : 'font-noto text-body'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TimeColumn({
  field,
  unit,
  values,
  selected,
  onSelect,
}: {
  field: 'start' | 'end';
  unit: 'h' | 'm';
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}): ReactElement {
  return (
    <ScrollView
      className="h-[168px] w-[60px]"
      showsVerticalScrollIndicator={false}
    >
      {values.map((value) => (
        <TimeCell
          key={value}
          testID={`planb-manual-time-${field}-${unit}-${value}`}
          label={value}
          selected={selected === value}
          onPress={() => onSelect(value)}
        />
      ))}
    </ScrollView>
  );
}

export function ManualTimeSheet({
  startAt,
  endAt,
  onApply,
  onCancel,
}: ManualTimeSheetProps): ReactElement {
  const [startHour, setStartHour] = useState(startAt.slice(0, 2));
  const [startMinute, setStartMinute] = useState(startAt.slice(3, 5));
  const [endHour, setEndHour] = useState(endAt.slice(0, 2));
  const [endMinute, setEndMinute] = useState(endAt.slice(3, 5));

  function handleApply(): void {
    const nextStart = `${startHour}:${startMinute}:00`;
    const nextEnd = `${endHour}:${endMinute}:00`;
    onApply({
      startAt: nextStart,
      endAt: nextEnd,
      endsNextDay: nextEnd <= nextStart,
    });
  }

  return (
    <BottomSheet backdropComponent={renderTimeSheetBackdrop}>
      <BottomSheetView
        testID="planb-manual-time-sheet"
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          시각 입력
        </Text>

        <View className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            도착
          </Text>
          <View className="w-full flex-row items-center justify-center gap-sm">
            <TimeColumn
              field="start"
              unit="h"
              values={HOURS}
              selected={startHour}
              onSelect={setStartHour}
            />
            <Text className="font-noto-bold text-section font-bold text-ink">
              :
            </Text>
            <TimeColumn
              field="start"
              unit="m"
              values={MINUTES}
              selected={startMinute}
              onSelect={setStartMinute}
            />
          </View>
        </View>

        <View className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            출발
          </Text>
          <View className="w-full flex-row items-center justify-center gap-sm">
            <TimeColumn
              field="end"
              unit="h"
              values={HOURS}
              selected={endHour}
              onSelect={setEndHour}
            />
            <Text className="font-noto-bold text-section font-bold text-ink">
              :
            </Text>
            <TimeColumn
              field="end"
              unit="m"
              values={MINUTES}
              selected={endMinute}
              onSelect={setEndMinute}
            />
          </View>
        </View>

        <View className="w-full flex-row gap-sm">
          <Pressable
            testID="planb-manual-time-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-ink">
              취소
            </Text>
          </Pressable>
          <Pressable
            testID="planb-manual-time-apply"
            accessibilityRole="button"
            onPress={handleApply}
            className="flex-1 items-center justify-center rounded-button bg-primary py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-on-primary">
              적용
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
