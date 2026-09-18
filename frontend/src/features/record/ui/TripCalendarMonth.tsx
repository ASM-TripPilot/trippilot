import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BackArrowGlyph } from './RecordGlyphs';
import type { MonthCell } from '@/shared/date/monthGrid';

/**
 * TRIP-575 · j07 월 캘린더(무상태 프레젠테이션 — 계산된 그리드·마킹·콜백만 받는다).
 * 리포에 캘린더 라이브러리가 없어 커스텀 6×7 그리드로 그린다(WheelPicker·지도 선례).
 *
 * ★마킹 관찰(★D3, repo-traps 「글리프·심판 사정거리」): 코랄 pill 의 색(fill)은 jest 원리적 사각이라
 * 마킹된 날 셀은 색이 아니라 `accessibilityState={{ selected }}`로 관찰 가능하게 그린다 —
 * `record-calendar-day-{YYYY-MM-DD}` testID + selected 로 `toBeSelected()`가 잡는다. 코랄 pill 픽셀
 * 충실도는 AC-V1/6-b 몫. pill 은 마킹된 연속 구간의 양 끝만 둥글려(주 경계에서 끊김) Figma 를 흉내낸다.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface TripCalendarMonthProps {
  monthLabel: string;
  grid: (MonthCell | null)[];
  markedDays: string[];
  onPressPrev: () => void;
  onPressNext: () => void;
}

export function TripCalendarMonth({
  monthLabel,
  grid,
  markedDays,
  onPressPrev,
  onPressNext,
}: TripCalendarMonthProps): ReactElement {
  const markedSet = new Set(markedDays);
  const weeks: (MonthCell | null)[][] = [];
  for (let i = 0; i < grid.length; i += 7) weeks.push(grid.slice(i, i + 7));

  return (
    <View testID="record-calendar-month" className="w-full">
      {/* 월 헤더 — ‹ 2026년 6월 › */}
      <View className="w-full flex-row items-center px-lg py-[10px]">
        <Pressable
          testID="record-calendar-prev"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onPressPrev}
        >
          <BackArrowGlyph size={22} />
        </Pressable>
        <Text
          testID="record-calendar-month-label"
          className="flex-1 text-center font-noto-bold text-section font-bold text-ink"
        >
          {monthLabel}
        </Text>
        <Pressable
          testID="record-calendar-next"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onPressNext}
        >
          <View style={{ transform: [{ scaleX: -1 }] }}>
            <BackArrowGlyph size={22} />
          </View>
        </Pressable>
      </View>

      {/* 카드 그리드 */}
      <View className="w-full rounded-card border border-hairline bg-canvas px-[10px] pb-[14px] pt-[12px]">
        {/* 요일 헤더 */}
        <View className="w-full flex-row">
          {WEEKDAYS.map((label) => (
            <View key={label} className="flex-1 items-center py-[6px]">
              <Text className="font-noto text-caption text-muted-soft">
                {label}
              </Text>
            </View>
          ))}
        </View>

        {/* 날짜 셀 */}
        <View className="w-full gap-[2px]">
          {weeks.map((week, wi) => (
            <View key={wi} className="w-full flex-row">
              {week.map((cell, di) => {
                if (cell === null) {
                  return <View key={di} className="flex-1 py-[9px]" />;
                }
                const isMarked = markedSet.has(cell.date);
                const prev = week[di - 1];
                const next = week[di + 1];
                const roundLeft =
                  isMarked && (di === 0 || !prev || !markedSet.has(prev.date));
                const roundRight =
                  isMarked && (di === 6 || !next || !markedSet.has(next.date));
                return (
                  <View
                    key={di}
                    testID={`record-calendar-day-${cell.date}`}
                    accessibilityState={{ selected: isMarked }}
                    className={`flex-1 items-center justify-center py-[9px] ${
                      isMarked ? 'bg-primary-pale' : ''
                    } ${roundLeft ? 'rounded-l-[9px]' : ''} ${
                      roundRight ? 'rounded-r-[9px]' : ''
                    }`}
                  >
                    <Text
                      className={`text-body ${
                        isMarked
                          ? 'font-noto-bold font-bold text-primary-text'
                          : 'font-noto text-ink'
                      }`}
                    >
                      {cell.day}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
