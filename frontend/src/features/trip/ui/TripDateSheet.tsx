/**
 * 여행 출발일 선택 시트(TRIP-389 · g01). 달력에서 **출발일 하나만** 고른다 — 종료일은 화면
 * 입력이 아니라 배선이 박수 합으로 파생한다(`deriveEndDate`). Figma 밴드 g에 전용 프레임이
 * 없어(미확인) 기존 시트 패턴(숙소 등록 `CalendarSheet`)을 재해석해 쓴다(TRIP-201·182 방침 —
 * 새 프레임을 그리지 않는다).
 *
 * 무상태에 가까운 잎 컴포넌트다 — 고른 출발일·보는 달만 자체 `useState`로 들고, 확정된 출발일은
 * `onConfirm(start)`으로만 위로 올려보낸다(1인자). 이미 고른 뒤 다른 셀을 누르면 범위를 만드는
 * 게 아니라 출발일을 교체한다. 판정(박수 초과 등)은 이 시트가 아니라 배선의 `validateTripDraft`가
 * 그대로 한다.
 *
 * `오늘`은 주입받는다 — 시트가 시계를 읽으면 테스트가 실행일에 흔들린다. 과거 날짜는 진짜
 * `disabled` prop으로 막는다(접근성 상태만 세우면 회색인데 눌린다).
 */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import {
  dateCell,
  daysInMonth,
  firstWeekdayOfMonth,
  shiftMonth,
} from '../model/tripDatePicker';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export interface TripDateSheetProps {
  /** 'YYYY-MM-DD' — 과거 날짜 비활성 기준(주입받아 결정론). */
  today: string;
  /** 이미 고른 출발일이 있으면 그 자리에서 보인다(없으면 null). */
  initialStart?: string | null;
  /** 고른 출발일 하나만 올라온다 — 종료일은 배선이 박수 합으로 파생한다. */
  onConfirm: (startDate: string) => void;
  onClose: () => void;
}

export function TripDateSheet({
  today,
  initialStart = null,
  onConfirm,
  onClose,
}: TripDateSheetProps): ReactElement {
  const [selected, setSelected] = useState<string | null>(initialStart);
  const [month, setMonth] = useState<string>(
    (initialStart ?? today).slice(0, 7)
  );

  const [refYear, refMonth] = month.split('-').map(Number);
  const totalDays = daysInMonth(refYear, refMonth);
  const leadingBlanks = firstWeekdayOfMonth(refYear, refMonth);
  const dayNumbers = Array.from({ length: totalDays }, (_, i) => i + 1);

  // 지난 달로는 가지 않는다 — 그 달은 전 칸이 과거라 비활성이다.
  const canGoPrev = month > today.slice(0, 7);

  return (
    <BottomSheet>
      <BottomSheetView testID="trip-wizard-datesheet" className="gap-md p-lg">
        <Text className="font-noto-bold text-section font-bold text-ink">
          여행 출발일을 골라 주세요
        </Text>

        <View className="flex-row items-center justify-between">
          <Pressable
            testID="trip-wizard-datesheet-prev"
            accessibilityRole="button"
            accessibilityLabel="이전 달"
            disabled={!canGoPrev}
            onPress={() => setMonth((prev) => shiftMonth(prev, -1))}
            className="h-10 w-10 items-center justify-center"
          >
            <Text
              className={`font-noto-bold text-section font-bold ${
                canGoPrev ? 'text-ink' : 'text-muted-soft'
              }`}
            >
              ‹
            </Text>
          </Pressable>
          <Text className="font-noto-bold text-section font-bold text-ink">
            {refYear}년 {refMonth}월
          </Text>
          <Pressable
            testID="trip-wizard-datesheet-next"
            accessibilityRole="button"
            accessibilityLabel="다음 달"
            onPress={() => setMonth((prev) => shiftMonth(prev, 1))}
            className="h-10 w-10 items-center justify-center"
          >
            <Text className="font-noto-bold text-section font-bold text-ink">
              ›
            </Text>
          </Pressable>
        </View>

        <View className="w-full flex-row flex-wrap">
          {WEEKDAY_LABELS.map((label) => (
            <View
              key={label}
              className="h-8 w-[14.28%] items-center justify-center"
            >
              <Text className="font-noto text-caption text-muted">{label}</Text>
            </View>
          ))}
        </View>

        <View className="w-full flex-row flex-wrap">
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <View key={`blank-${i}`} className="h-10 w-[14.28%]" />
          ))}
          {dayNumbers.map((day) => {
            const dateStr = dateCell(month, day);
            const disabled = dateStr < today;
            const isSelected = dateStr === selected;
            return (
              <View key={dateStr} className="w-[14.28%] items-center py-[2px]">
                <Pressable
                  testID={`trip-wizard-date-cell-${dateStr}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  disabled={disabled}
                  onPress={() => setSelected(dateStr)}
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    isSelected ? 'bg-primary' : ''
                  }`}
                >
                  <Text
                    className={`font-noto text-body ${
                      isSelected
                        ? 'text-on-primary'
                        : disabled
                          ? 'text-muted-soft'
                          : 'text-ink'
                    }`}
                  >
                    {day}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <Pressable
          testID="trip-wizard-datesheet-confirm"
          accessibilityRole="button"
          disabled={selected === null}
          onPress={() => {
            if (selected !== null) {
              onConfirm(selected);
            }
          }}
          className={`h-12 items-center justify-center rounded-button bg-primary ${
            selected !== null ? '' : 'opacity-40'
          }`}
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            이 날짜로 정하기
          </Text>
        </Pressable>

        <Pressable
          testID="trip-wizard-datesheet-close"
          accessibilityRole="button"
          onPress={onClose}
          className="h-11 items-center justify-center"
        >
          <Text className="font-noto-medium text-body font-medium text-muted">
            닫기
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
