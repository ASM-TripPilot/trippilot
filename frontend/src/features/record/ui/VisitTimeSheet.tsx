import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { seoulDate, seoulInstant, seoulTime } from '@/shared/date/seoulDate';

import { adjustTimesDraft } from '../model/adjustTimesDraft';

/**
 * TRIP-613 · j01 방문 시각 편집 시트 — 도착·완료 시각을 셀 press 로 고쳐 저장한다.
 *
 * SlotTimeSheet(features/itinerary) 구조를 준용하되 record 에 자체 구현했다(features 간 import 금지).
 * 이 리포엔 휠(스크롤-스냅) 시각 피커 라이브러리가 없고 jest 는 스크롤-스냅을 구동하지 못한다 —
 * 게다가 휠을 바텀시트에 넣으면 `enableContentPanningGesture` 회귀가 재발한다(repo-traps TRIP-599).
 * 그래서 시·분을 값별 셀로 두고 press 로 고른다. 분 셀은 맨 숫자다("30"이지 "30분" 금지 — INV-3).
 *
 * TRIP-1069 — 셀은 원본 순간을 **서울 시계**로 읽어 시드하고, 저장은 "원본의 서울 날짜 + 고른 서울 HH:mm"
 * 을 UTC 순간(`Z`)으로 되돌린다. 바뀜 판정은 **분 단위**(피커 해상도)라 원본의 초·소수는 헛 PATCH 를 안 낸다.
 *
 * [저장] 은 `adjustTimesDraft(서버가 갖게 될 값, now)` 로 클라 선검증한 뒤, 위반이면 인라인 오류 + onSave
 * 미호출(서버 재검증이 최종 — INV-2), 통과면 **바뀐 필드만** onSave 한다("안 보내면 유지").
 * 완료 칸은 원본 완료가 있을 때만 고친다(01b D1 — PATCH 로 새로 완료하면 `complete()` 의 건너뜀 검사·
 * VisitChecked 발행을 우회한다). 새 완료는 카드의 체크서클(POST /complete)이 유일한 경로다.
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

/** 원본 순간 → 서울 'HH:mm'(없으면 '00:00' — 셀은 그려지되 합성은 원본이 있을 때만 값을 낸다). */
const clockOf = (iso: string | null): string =>
  iso != null ? seoulTime(new Date(iso)) : '00:00';

/** 원본이 있고 고른 서울 HH:mm 이 원본과 다를 때만 새 순간을 만든다(분 단위 diff). */
function editedInstant(original: string | null, hhmm: string): string | null {
  if (original == null || hhmm === clockOf(original)) return null;
  return seoulInstant(seoulDate(new Date(original)), hhmm);
}

export interface VisitTimeSheetProps {
  visitCheckId: string;
  /** 부제 — 어느 장소의 시각을 고치는지(Figma 4524:2383). */
  placeName: string;
  /** 원본 UTC 순간 ISO(`Z`) 또는 null(미기록). */
  arrivedAt: string | null;
  completedAt: string | null;
  /** 미래 판정 기준시각(주입) → adjustTimesDraft 로 전달. */
  now: string;
  /** 바뀐 필드만 실어 나른다(값은 `Z` 순간). 아무것도 안 바뀌면 빈 객체. */
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
  disabled,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
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
  disabled = false,
  onSelect,
}: {
  field: 'arrived' | 'completed';
  unit: 'h' | 'm';
  values: string[];
  selected: string;
  /** 닫힌 칸 — 셀이 눌리지 않고 선택 표시도 없다(가짜 00:00 시드를 보이지 않게). */
  disabled?: boolean;
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
          selected={!disabled && selected === value}
          disabled={disabled}
          onPress={() => onSelect(value)}
        />
      ))}
    </ScrollView>
  );
}

export function VisitTimeSheet({
  // visitCheckId 는 계약(호출자가 어느 카드를 여는지)에 있으나 시트 내부는 안 쓴다(onSave 는 patch 만).
  placeName,
  arrivedAt,
  completedAt,
  now,
  onSave,
  onCancel,
}: VisitTimeSheetProps): ReactElement {
  const [arrivedHour, setArrivedHour] = useState(
    clockOf(arrivedAt).slice(0, 2)
  );
  const [arrivedMinute, setArrivedMinute] = useState(
    clockOf(arrivedAt).slice(3, 5)
  );
  const [completedHour, setCompletedHour] = useState(
    clockOf(completedAt).slice(0, 2)
  );
  const [completedMinute, setCompletedMinute] = useState(
    clockOf(completedAt).slice(3, 5)
  );
  const [showError, setShowError] = useState(false);

  // 원본 완료가 없으면 완료 칸을 닫는다(D1) — 셀 자체가 안 눌려 버려질 입력이 생기지 않는다(INV-4).
  const completedDisabled = completedAt == null;

  function handleSave(): void {
    const arrivedEdited = editedInstant(
      arrivedAt,
      `${arrivedHour}:${arrivedMinute}`
    );
    const completedEdited = editedInstant(
      completedAt,
      `${completedHour}:${completedMinute}`
    );

    // 검증은 서버가 저장 뒤 갖게 될 값으로 — 안 바꾼 필드는 원본 그대로(초 포함) 남는다.
    const check = adjustTimesDraft({
      arrivedAt: arrivedEdited ?? arrivedAt,
      completedAt: completedEdited ?? completedAt,
      now,
    });
    if (!check.ok) {
      // 클라 선차단 — 요청을 안 내보내고 인라인 오류만(서버 재검증이 최종, INV-2).
      setShowError(true);
      return;
    }
    setShowError(false);

    // 바뀐 필드만 실어 보낸다(안 바꾼 필드는 안 담긴다 = 유지).
    const patch: { arrivedAt?: string; completedAt?: string } = {};
    if (arrivedEdited != null) patch.arrivedAt = arrivedEdited;
    if (completedEdited != null) patch.completedAt = completedEdited;
    onSave(patch);
  }

  return (
    <BottomSheet backdropComponent={renderTimeSheetBackdrop}>
      <BottomSheetView
        testID="record-trip-visit-time-sheet"
        className="w-full gap-lg px-lg pb-[28px] pt-md"
      >
        <View className="w-full gap-xs">
          <Text className="font-noto-bold text-section font-bold text-ink">
            {SHEET_TITLE}
          </Text>
          <Text
            testID="record-trip-visit-time-place"
            className="font-noto text-label text-muted"
          >
            {placeName}
          </Text>
        </View>

        {/* Figma 4524:2383 — 도착·완료 두 칸을 가로 2열로. 칸 안은 HH:mm 박스 대신 셀 피커(탭 뒤 상태가
            Figma 에 없고, 바텀시트 안 휠은 제스처 회귀 — 위 머리 주석). */}
        <View className="w-full flex-row gap-md">
          <View
            testID="record-trip-visit-time-arrived"
            className="flex-1 gap-sm"
          >
            <Text className="font-noto text-label text-muted">
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
            className={`flex-1 gap-sm ${completedDisabled ? 'opacity-40' : ''}`}
          >
            <Text className="font-noto text-label text-muted">
              {COMPLETED_LABEL}
            </Text>
            <View className="w-full flex-row items-center justify-center gap-sm">
              <TimeColumn
                field="completed"
                unit="h"
                values={HOURS}
                selected={completedHour}
                disabled={completedDisabled}
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
                disabled={completedDisabled}
                onSelect={setCompletedMinute}
              />
            </View>
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

        <View className="w-full flex-row gap-md">
          <Pressable
            testID="record-trip-visit-time-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="h-[52px] flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-ink">
              {CANCEL_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID="record-trip-visit-time-save"
            accessibilityRole="button"
            onPress={handleSave}
            className="h-[52px] flex-1 items-center justify-center rounded-button bg-primary"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              {SAVE_LABEL}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}
