import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

/**
 * TRIP-302 · h24 시각조정 시트(슬라이스3) — 비고정 슬롯의 시작·종료 시각을 고친다.
 *
 * 이 리포엔 휠(스크롤-스냅) 시각 피커 라이브러리가 없고 jest 는 스크롤-스냅을 구동하지 못한다
 * (실측: gorhom·draggable 뿐). 그래서 시·분을 **값별 셀**로 두고 누르면 그 값이 선택된다
 * (h07 옵션-셀 선례). "휠" 비주얼은 그 위의 스크롤 프레젠테이션이다(02a ★1).
 *
 * 클라는 시간 타당성을 판정하지 않는다(INV-2) — [적용]은 항상 열려 있고, `endsNextDay`는
 * `end ≤ start`(HH:mm 사전식 비교)의 **기계적 유도**다(HC4 동형, 02a ★10). 최종 시간 판정은
 * 저장 시 서버 재검증 몫이다. 소요시간 표기는 어디에도 없다(INV-3) — 분 셀은 `"30"` 같은 bare
 * 숫자다("30분"으로 그리면 소요시간 가드가 시계 분을 오탐한다, 02a ★2).
 *
 * ponytail: 셀별 press 피커 — 실기기 스와이프-스냅·나란한 두 컬럼의 중첩 스크롤 제스처 정합은
 * 후속 비주얼 패스 몫(jest 로 구동 불가라 이번 상한 밖). 동작·testID 계약만 여기서 잠근다.
 */

const SHEET_TITLE = '시각 조정';
const START_LABEL = '시작';
const END_LABEL = '종료';
const APPLY_LABEL = '적용';
const CANCEL_LABEL = '취소';

/** 시(00~23)·분(00~59) 라벨을 zero-pad 2자리로 미리 만든다 — 셀 testID·표시가 같은 형태다. */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0')
);

export interface SlotTimeSheetProps {
  /** 현재값 "HH:mm:00". */
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

/** 값 하나 = 누를 수 있는 셀. 선택되면 `accessibilityState.selected` 로 표시(h07 선례). */
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

/** 한 컬럼(시 또는 분) — 모든 값 셀이 트리에 실재해야 한다(jest 는 뷰포트가 아니라 트리를 본다,
 * 02a ★1). FlatList 가상화 대신 ScrollView + map 으로 전 값을 렌더한다. */
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
          testID={`itinerary-edit-time-${field}-${unit}-${value}`}
          label={value}
          selected={selected === value}
          onPress={() => onSelect(value)}
        />
      ))}
    </ScrollView>
  );
}

export function SlotTimeSheet({
  startAt,
  endAt,
  onApply,
  onCancel,
}: SlotTimeSheetProps): ReactElement {
  // 현재 시각을 시·분으로 시드한다(초는 표시·편집하지 않는다 — 적용 시 :00 으로 되돌린다).
  const [startHour, setStartHour] = useState(startAt.slice(0, 2));
  const [startMinute, setStartMinute] = useState(startAt.slice(3, 5));
  const [endHour, setEndHour] = useState(endAt.slice(0, 2));
  const [endMinute, setEndMinute] = useState(endAt.slice(3, 5));

  function handleApply(): void {
    const nextStart = `${startHour}:${startMinute}:00`;
    const nextEnd = `${endHour}:${endMinute}:00`;
    // end ≤ start(zero-pad 문자열 비교)면 자정을 넘긴 것으로 유도한다(같으면 익일).
    onApply({
      startAt: nextStart,
      endAt: nextEnd,
      endsNextDay: nextEnd <= nextStart,
    });
  }

  return (
    <BottomSheet backdropComponent={renderTimeSheetBackdrop}>
      <BottomSheetView
        testID="itinerary-edit-time-sheet"
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          {SHEET_TITLE}
        </Text>

        <View testID="itinerary-edit-time-start" className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            {START_LABEL}
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

        <View testID="itinerary-edit-time-end" className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            {END_LABEL}
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
            testID="itinerary-edit-time-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-ink">
              {CANCEL_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID="itinerary-edit-time-apply"
            accessibilityRole="button"
            onPress={handleApply}
            className="flex-1 items-center justify-center rounded-button bg-primary py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-on-primary">
              {APPLY_LABEL}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
