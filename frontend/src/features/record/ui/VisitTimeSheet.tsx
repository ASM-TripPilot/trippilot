import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { adjustTimesDraft } from '../model/adjustTimesDraft';

/**
 * TRIP-613 · j01 방문 시각 편집 시트 — 도착·완료 시각을 셀 press 로 고쳐 저장한다.
 *
 * SlotTimeSheet(features/itinerary) 구조를 준용하되 record 에 자체 구현했다(features 간 import 금지).
 * 이 리포엔 휠(스크롤-스냅) 시각 피커 라이브러리가 없고 jest 는 스크롤-스냅을 구동하지 못한다 —
 * 게다가 휠을 바텀시트에 넣으면 `enableContentPanningGesture` 회귀가 재발한다(repo-traps TRIP-599).
 * 그래서 시·분을 값별 셀로 두고 press 로 고른다. 분 셀은 맨 숫자다("30"이지 "30분" 금지 — INV-3).
 *
 * [저장] 은 `adjustTimesDraft(합성값, now)` 로 클라 선검증한 뒤, 위반이면 인라인 오류 + onSave 미호출
 * (서버 재검증이 최종 — INV-2), 통과면 원본과 diff 한 **바뀐 필드만** onSave 한다("안 보내면 유지").
 * 도착 없는 방문은 완료 입력을 비활성한다(도착이 있어야 완료가 의미 — BR-U5-05).
 */

const SHEET_TITLE = '방문 시각 수정';
const ARRIVED_LABEL = '도착';
const COMPLETED_LABEL = '완료';
const SAVE_LABEL = '저장';
const CANCEL_LABEL = '취소';
const ERROR_MESSAGE = '입력한 시각이 올바르지 않아요';

/** 시(00~23)·분(00~59) 라벨을 zero-pad 2자리로 미리 만든다 — 셀 testID·표시가 같은 형태다. */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0')
);

/** 원본 ISO('YYYY-MM-DDTHH:mm:ss')에서 시·분을 slice 로 뽑는다(파싱 아님 — SlotTimeSheet 선례). */
const hourOf = (iso: string): string => iso.slice(11, 13);
const minuteOf = (iso: string): string => iso.slice(14, 16);

export interface VisitTimeSheetProps {
  visitCheckId: string;
  /** 원본 ISO datetime 또는 null(미기록). */
  arrivedAt: string | null;
  completedAt: string | null;
  /** 미래 판정 기준시각(주입) → adjustTimesDraft 로 전달. */
  now: string;
  /** 바뀐 필드만 실어 나른다. */
  onSave: (patch: { arrivedAt?: string; completedAt?: string }) => void;
  onCancel: () => void;
}

function renderTimeSheetBackdrop(
  props: BottomSheetBackdropProps
): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 값 하나 = 누를 수 있는 셀. 선택되면 `accessibilityState.selected` 로 표시(SlotTimeSheet 선례). */
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

/** 한 컬럼(시 또는 분) — 모든 값 셀이 트리에 실재한다(jest 는 뷰포트가 아니라 트리를 본다). */
function TimeColumn({
  field,
  unit,
  values,
  selected,
  onSelect,
}: {
  field: 'arrived' | 'completed';
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
          testID={`record-trip-visit-time-${field}-${unit}-${value}`}
          label={value}
          selected={selected === value}
          onPress={() => onSelect(value)}
        />
      ))}
    </ScrollView>
  );
}

export function VisitTimeSheet({
  // visitCheckId 는 계약(호출자가 어느 카드를 여는지)에 있으나 시트 내부는 안 쓴다(onSave 는 patch 만).
  arrivedAt,
  completedAt,
  now,
  onSave,
  onCancel,
}: VisitTimeSheetProps): ReactElement {
  // 현재 시각을 시·분으로 시드한다(없으면 00 — 셀은 그려지되 합성은 원본이 있을 때만 값을 낸다).
  const [arrivedHour, setArrivedHour] = useState(
    arrivedAt != null ? hourOf(arrivedAt) : '00'
  );
  const [arrivedMinute, setArrivedMinute] = useState(
    arrivedAt != null ? minuteOf(arrivedAt) : '00'
  );
  const [completedHour, setCompletedHour] = useState(
    completedAt != null ? hourOf(completedAt) : '00'
  );
  const [completedMinute, setCompletedMinute] = useState(
    completedAt != null ? minuteOf(completedAt) : '00'
  );
  const [showError, setShowError] = useState(false);

  // 완료는 도착이 있어야 입력 가능하다(AC-3, BR-U5-05).
  const completedDisabled = arrivedAt == null;

  function handleSave(): void {
    // 합성 — 원본 날짜 접두를 보존하고 초는 :00 으로 되돌린다. 원본이 null 이면 그대로 null(유지).
    const arrivedSynth =
      arrivedAt != null
        ? `${arrivedAt.slice(0, 11)}${arrivedHour}:${arrivedMinute}:00`
        : null;
    const completedSynth =
      completedAt != null
        ? `${completedAt.slice(0, 11)}${completedHour}:${completedMinute}:00`
        : null;

    const check = adjustTimesDraft({
      arrivedAt: arrivedSynth,
      completedAt: completedSynth,
      now,
    });
    if (!check.ok) {
      // 클라 선차단 — 요청을 안 내보내고 인라인 오류만(서버 재검증이 최종, INV-2).
      setShowError(true);
      return;
    }
    setShowError(false);

    // 원본과 diff 한 바뀐 필드만 실어 보낸다(안 바꾼 필드는 안 담긴다 = 유지, AC-1).
    const patch: { arrivedAt?: string; completedAt?: string } = {};
    if (arrivedSynth != null && arrivedSynth !== arrivedAt) {
      patch.arrivedAt = arrivedSynth;
    }
    if (completedSynth != null && completedSynth !== completedAt) {
      patch.completedAt = completedSynth;
    }
    onSave(patch);
  }

  return (
    <BottomSheet backdropComponent={renderTimeSheetBackdrop}>
      <BottomSheetView
        testID="record-trip-visit-time-sheet"
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          {SHEET_TITLE}
        </Text>

        <View testID="record-trip-visit-time-arrived" className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            {ARRIVED_LABEL}
          </Text>
          <View className="w-full flex-row items-center justify-center gap-sm">
            <TimeColumn
              field="arrived"
              unit="h"
              values={HOURS}
              selected={arrivedHour}
              onSelect={setArrivedHour}
            />
            <Text className="font-noto-bold text-section font-bold text-ink">
              :
            </Text>
            <TimeColumn
              field="arrived"
              unit="m"
              values={MINUTES}
              selected={arrivedMinute}
              onSelect={setArrivedMinute}
            />
          </View>
        </View>

        <View
          testID="record-trip-visit-time-completed"
          accessibilityState={{ disabled: completedDisabled }}
          className={`w-full gap-sm ${completedDisabled ? 'opacity-40' : ''}`}
        >
          <Text className="font-noto-bold text-body font-bold text-ink">
            {COMPLETED_LABEL}
          </Text>
          <View className="w-full flex-row items-center justify-center gap-sm">
            <TimeColumn
              field="completed"
              unit="h"
              values={HOURS}
              selected={completedHour}
              onSelect={setCompletedHour}
            />
            <Text className="font-noto-bold text-section font-bold text-ink">
              :
            </Text>
            <TimeColumn
              field="completed"
              unit="m"
              values={MINUTES}
              selected={completedMinute}
              onSelect={setCompletedMinute}
            />
          </View>
        </View>

        {showError ? (
          <Text
            testID="record-trip-visit-time-error"
            className="font-noto text-label text-primary-text"
          >
            {ERROR_MESSAGE}
          </Text>
        ) : null}

        <View className="w-full flex-row gap-sm">
          <Pressable
            testID="record-trip-visit-time-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-ink">
              {CANCEL_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID="record-trip-visit-time-save"
            accessibilityRole="button"
            onPress={handleSave}
            className="flex-1 items-center justify-center rounded-button bg-primary py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-on-primary">
              {SAVE_LABEL}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
