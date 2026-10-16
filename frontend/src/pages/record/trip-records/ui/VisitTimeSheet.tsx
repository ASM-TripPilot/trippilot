import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import { seoulDate, seoulInstant, seoulTime } from '@/shared/lib/seoulDate';
import { HourMinuteWheel } from '@/shared/ui/HourMinuteWheel';

import { adjustTimesDraft } from '../model/adjustTimesDraft';

/**
 * TRIP-613 · j01 방문 시각 편집 시트 — 도착·완료 시각을 휠로 골라 저장한다.
 *
 * TRIP-1080 — 시·분은 공용 휠 4열(도착 시·분, 완료 시·분)이다 — TRIP-1437 부터 칸마다 `shared/ui/HourMinuteWheel` 한 쌍. 휠은 셀 press 와
 * 스크롤 정지 두 길로 값을 확정한다. 바텀시트 본문 끌기가 휠 제스처를 삼키지 않도록 바깥 시트에
 * `enableContentPanningGesture={false}` 를 준다(jest 목은 이 prop 을 렌더로 구분 못 한다 — repo-traps
 * 바텀시트 절, 실제 분리는 6-b 실기). 딤으로 닫히면 `onClose` 가 `onCancel` 을 불러 부모 열림 상태를 푼다.
 * 분 셀은 맨 숫자다("30"이지 "30분" 금지 — INV-3).
 *
 * TRIP-1069 — 셀은 원본 순간을 **서울 시계**로 읽어 시드하고, 저장은 "원본의 서울 날짜 + 고른 서울 HH:mm"
 * 을 UTC 순간(`Z`)으로 되돌린다. 바뀜 판정은 **분 단위**(피커 해상도)라 원본의 초·소수는 헛 PATCH 를 안 낸다.
 *
 * [저장] 은 `adjustTimesDraft(서버가 갖게 될 값, now)` 로 클라 선검증한 뒤, 위반이면 인라인 오류 + onSave
 * 미호출(서버 재검증이 최종 — INV-2), 통과면 **바뀐 필드만** onSave 한다("안 보내면 유지").
 * 완료 칸은 원본 완료가 있을 때만 고친다(01b D1 — PATCH 로 새로 완료하면 `complete()` 의 건너뜀 검사·
 * VisitChecked 발행을 우회한다). 새 완료는 카드의 체크서클(POST /complete)이 유일한 경로다.
 * 완료가 없으면 휠 대신 "아직 완료 전" 자리 표시만 둔다(TRIP-1437 Q-116 — 닫힌 휠의 흐린 '00:00' 폐기).
 */

const SHEET_TITLE = '방문 시각 수정';
const ARRIVED_LABEL = '도착';
const COMPLETED_LABEL = '완료';
const SAVE_LABEL = '저장';
const CANCEL_LABEL = '취소';
const ERROR_MESSAGE = '입력한 시각이 올바르지 않아요';
const COMPLETED_PENDING = '아직 완료 전이에요';

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

/** 한 칸(도착 또는 완료)의 시·분 휠 — testID 는 셀 컬럼 시절 모양 그대로 주입한다. */
function FieldWheel({
  field,
  value,
  onChange,
}: {
  field: 'arrived' | 'completed';
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const id = `record-trip-visit-time-${field}`;
  return (
    <HourMinuteWheel
      value={value}
      onChange={onChange}
      hourWheelTestID={`${id}-h-wheel`}
      minuteWheelTestID={`${id}-m-wheel`}
      hourCellTestID={(hour) => `${id}-h-${hour}`}
      minuteCellTestID={(minute) => `${id}-m-${minute}`}
    />
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
  const [arrived, setArrived] = useState(clockOf(arrivedAt));
  const [completed, setCompleted] = useState(clockOf(completedAt));
  const [showError, setShowError] = useState(false);

  // 원본 완료가 없으면 완료 칸을 닫는다(D1) — 휠 자체가 없어 버려질 입력이 생기지 않는다(INV-4).
  const completedDisabled = completedAt == null;

  function handleSave(): void {
    const arrivedEdited = editedInstant(arrivedAt, arrived);
    const completedEdited = editedInstant(completedAt, completed);

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
    <BottomSheet
      backdropComponent={renderTimeSheetBackdrop}
      enableContentPanningGesture={false}
      onClose={onCancel}
    >
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

        {/* Figma 4524:2383 — 도착·완료 두 칸을 가로 2열로. 칸 안은 HH:mm 박스 대신 시·분 휠(편집 상태
            프레임이 Figma 에 없어 기존 토큰으로 최소 모양 — 휠 제스처 분리는 위 머리 주석). */}
        <View className="w-full flex-row gap-md">
          <View
            testID="record-trip-visit-time-arrived"
            className="flex-1 gap-sm"
          >
            <Text className="font-noto text-label text-muted">
              {ARRIVED_LABEL}
            </Text>
            <FieldWheel field="arrived" value={arrived} onChange={setArrived} />
          </View>

          <View
            testID="record-trip-visit-time-completed"
            accessibilityState={{ disabled: completedDisabled }}
            className="flex-1 gap-sm"
          >
            <Text className="font-noto text-label text-muted">
              {COMPLETED_LABEL}
            </Text>
            {completedDisabled ? (
              // 휠 높이(5칸 × 44)를 비워 두어 도착 칸과 높이를 맞춘다.
              <View className="h-[220px] w-full items-center justify-center">
                <Text
                  testID="record-trip-visit-time-completed-pending"
                  className="font-noto text-label text-muted-soft"
                >
                  {COMPLETED_PENDING}
                </Text>
              </View>
            ) : (
              <FieldWheel
                field="completed"
                value={completed}
                onChange={setCompleted}
              />
            )}
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
