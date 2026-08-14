/**
 * 여행 기간 직접 선택 시트(TRIP-368 · g01). 프리셋 4개 밖의 임의 기간을 달력에서 범위로 고른다.
 * Figma 밴드 g에 전용 프레임이 없어(미확인), 기존 시트 패턴(숙소 등록 `CalendarSheet`)을 재해석해
 * 쓴다(TRIP-201·182 방침 — 새 프레임을 그리지 않는다).
 *
 * 무상태에 가까운 잎 컴포넌트다 — 진행 중인 범위·보는 달만 자체 `useState`로 들고, 확정된 범위는
 * `onConfirm(start, end)`으로만 위로 올려보낸다. 판정(박수 초과 등)은 이 시트가 아니라 배선의
 * `validateTripDraft`가 그대로 한다(INV-U1-11·14는 임의 날짜에도 같은 경로로 걸린다).
 *
 * `applyDatePick`이 역전·같은 날 범위를 구조적으로 못 만들게 해(INV-U1-11), 시트에서는 잘못된
 * 범위 자체가 생기지 않는다. `오늘`은 주입받는다 — 시트가 시계를 읽으면 테스트가 실행일에 흔들린다.
 */
import { useState, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

import {
  applyDatePick,
  dateCell,
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  shiftMonth,
  type TripDateRange,
} from '../model/tripDatePicker';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export interface TripDateSheetProps {
  /** 'YYYY-MM-DD' — 과거 날짜 비활성 기준(주입받아 결정론). */
  today: string;
  /** 시트를 열 때의 시작 범위(기존에 고른 기간이 있으면 그 자리에서 보인다). */
  initialRange: TripDateRange;
  /** 시작·종료가 모두 정해진 범위만 올라온다. */
  onConfirm: (startDate: string, endDate: string) => void;
  onClose: () => void;
}

export function TripDateSheet({
  today,
  initialRange,
  onConfirm,
  onClose,
}: TripDateSheetProps): ReactElement {
  const [range, setRange] = useState<TripDateRange>(initialRange);
  const [month, setMonth] = useState<string>(
    (initialRange.startDate ?? today).slice(0, 7)
  );

  const [refYear, refMonth] = month.split('-').map(Number);
  const totalDays = daysInMonth(refYear, refMonth);
  const leadingBlanks = firstWeekdayOfMonth(refYear, refMonth);
  const dayNumbers = Array.from({ length: totalDays }, (_, i) => i + 1);

  // 지난 달로는 가지 않는다 — 그 달은 전 칸이 과거라 비활성이다.
  const canGoPrev = month > today.slice(0, 7);
  const rangeComplete = range.startDate !== null && range.endDate !== null;

  return (
    <BottomSheet>
      <BottomSheetView testID="trip-wizard-datesheet" className="gap-md p-lg">
        <Text className="font-noto-bold text-section font-bold text-ink">
          여행 기간을 골라 주세요
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
            const isEndpoint =
              dateStr === range.startDate || dateStr === range.endDate;
            const inRange = isDateInRange(
              dateStr,
              range.startDate,
              range.endDate
            );
            return (
              <View key={dateStr} className="w-[14.28%] items-center py-[2px]">
                <Pressable
                  testID={`trip-wizard-date-cell-${dateStr}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isEndpoint || inRange }}
                  disabled={disabled}
                  onPress={() =>
                    setRange((prev) => applyDatePick(prev, dateStr))
                  }
                  className={`h-9 w-9 items-center justify-center rounded-full ${
                    isEndpoint ? 'bg-primary' : inRange ? 'bg-primary-pale' : ''
                  }`}
                >
                  <Text
                    className={`font-noto text-body ${
                      isEndpoint
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
          disabled={!rangeComplete}
          onPress={() => {
            if (range.startDate !== null && range.endDate !== null) {
              onConfirm(range.startDate, range.endDate);
            }
          }}
          className={`h-12 items-center justify-center rounded-button bg-primary ${
            rangeComplete ? '' : 'opacity-40'
          }`}
        >
          <Text className="font-noto-bold text-card-title font-bold text-on-primary">
            이 기간으로 정하기
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
