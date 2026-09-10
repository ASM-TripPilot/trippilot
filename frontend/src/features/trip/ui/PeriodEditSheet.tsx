/**
 * TRIP-667 g01 기간 편집 바텀시트(Figma `3627:2068`) — **props만 받는 프레젠테이션**(01b D5).
 *
 * 무엇을 그리나: 넘겨받은 `month`의 월 달력(월 네비 · 요일 헤더 · 날짜 그리드)을 그리고, 넘겨받은
 * `range`(시작·종료)로 각 날짜 셀의 범위 상태를 표시한다. 시작·사이·종료를 **서로 다른 testID**로
 * 그린다(시작=`-cell-start-`, 사이=`-cell-between-`, 종료=`-cell-end-`) — 색 fill 만으로 구분하면
 * jest 렌더 트리에서 관찰되지 않아 셋이 뒤바뀌어도 심판이 못 본다(repo-traps "글리프 fill 무심판").
 *
 * 이 시트는 **상태를 안 가진다**(무상태 D5) — 보는 달·고른 범위·개폐는 전부 배선(`TripNewStep1Page`)이
 * `applyRangePick`/`shiftMonth`로 소유·갱신하고, 시트는 완성형 props 를 받아 그린 뒤 press 를 콜백으로
 * 그대로 올린다. 그래서 "셀 탭 → 표식 변화"(전이)는 이 컴포넌트가 아니라 배선이 재렌더할 때 일어난다
 * (통합 테스트가 잡는다). 옛 `TripDateSheet`(로컬 `selected`/`month`)와 다른 결정이다.
 *
 * `today`는 주입받는다 — 시트가 시계를 읽으면 테스트가 실행일에 흔들린다. 과거 날짜 셀·미완성 범위의
 * "적용"·today 이전 달로 가는 "이전" chevron 은 전부 **진짜 `disabled` prop**으로 막는다(접근성 상태만
 * 세우면 회색인데 눌린다 — [[disabled prop과 accessibilityState]]).
 *
 * 아이콘은 신규 없이 `TripGlyphs` 재사용: 이전 달 `BackChevronGlyph`(ink 고정), 다음 달
 * `ChevronRightGlyph tone="ink"`(좌우 대칭 쌍). 시작/종료 원은 순수 원이라 `rounded-full bg-primary`
 * View 로 그린다(옛 `TripDateSheet`의 선택 원과 동형 — 에셋 다운로드 불필요).
 *
 * ⚠️ 실제 개폐·딤 전면 커버·범위 하이라이트 색 실렌더·연장 배경 연속성·터치 차단은
 * `@gorhom/bottom-sheet` 통과형 목이라 jest 가 원리적으로 못 본다(repo-traps 바텀시트 함정) — 6-b
 * 실기(`_dev/preview.tsx`의 `trip-new-step1-period-sheet`) 몫이다.
 */
import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import {
  dateCell,
  daysInMonth,
  firstWeekdayOfMonth,
  isDateInRange,
  type TripDateRange,
} from '../model/tripDatePicker';
import { summaryPeriod } from '../model/tripSummary';

import { BackChevronGlyph, ChevronRightGlyph } from './TripGlyphs';

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export interface PeriodEditSheetProps {
  /** 'YYYY-MM-DD' — 과거 셀 비활성 기준 + 이전 달 하한(주입받아 결정론). */
  today: string;
  /** 'YYYY-MM' — 보고 있는 달(배선 소유). */
  month: string;
  /** 지금까지 고른 범위(배선이 `applyRangePick`으로 갱신). */
  range: TripDateRange;
  /** 날짜 셀 탭 → 배선이 `applyRangePick(range, date)`로 다음 range 를 만든다. */
  onPickDate: (date: string) => void;
  /** 월 네비 → 배선이 `shiftMonth(month, ∓1)`. */
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** "적용" → 배선이 `setPeriod(undefined, start, end)` + 닫기(값은 배선이 자기 state 에서 읽음). */
  onApply: () => void;
  /** 딤 바깥 탭·아래로 스와이프 → 배선: 시트 닫기(TRIP-683 AC-2·AC-3). */
  onClose: () => void;
}

/** 딤(backdrop) — 리포 표준 idiom(OtaChoiceSheet 선례). */
function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 셀 하나의 범위 상태. start·end 를 먼저 가르므로 `between`은 자연히 양 끝을 뺀 사이만이 된다. */
type CellRole = 'start' | 'end' | 'between' | 'none';

function cellRole(date: string, range: TripDateRange): CellRole {
  if (date === range.start) return 'start';
  if (range.end !== undefined && date === range.end) return 'end';
  // isDateInRange 는 양 끝 포함이지만 위에서 start·end 를 이미 걸렀으므로 여기선 "사이"만 남는다.
  // 미완성 범위(end 없음)면 isDateInRange 가 false 라 사이 표식이 안 뜬다.
  if (isDateInRange(date, range.start ?? null, range.end ?? null)) {
    return 'between';
  }
  return 'none';
}

/** 날짜 숫자 글자색(+굵기). 시작/종료는 분홍 원 안이라 흰 글씨, 사이는 진한 분홍, 과거는 흐림. */
function numberClass(role: CellRole, past: boolean): string {
  if (role === 'start' || role === 'end') {
    return 'font-noto-bold font-bold text-on-primary';
  }
  if (role === 'between') return 'font-noto text-primary-text';
  if (past) return 'font-noto text-muted-soft';
  return 'font-noto text-ink';
}

function DateCell({
  date,
  day,
  role,
  past,
  onPickDate,
}: {
  date: string;
  day: number;
  role: CellRole;
  past: boolean;
  onPickDate: (date: string) => void;
}): ReactElement {
  return (
    <View className="h-[44px] w-[14.28%] items-center justify-center">
      {/* 사이 칸은 셀 폭을 채우는 연한 배경, 시작/종료는 원 뒤로 이어지는 반쪽 연장 배경(6-b 시각). */}
      {role === 'between' ? (
        <View
          testID={`trip-wizard-period-cell-between-${date}`}
          className="absolute inset-x-0 top-1 h-9 bg-primary-pale"
        />
      ) : null}
      {role === 'start' && (
        <View className="absolute right-0 top-1 h-9 w-1/2 bg-primary-pale" />
      )}
      {role === 'end' && (
        <View className="absolute left-0 top-1 h-9 w-1/2 bg-primary-pale" />
      )}
      <Pressable
        testID={`trip-wizard-period-cell-${date}`}
        accessibilityRole="button"
        disabled={past}
        onPress={() => onPickDate(date)}
        className="h-9 w-9 items-center justify-center rounded-full"
      >
        {role === 'start' ? (
          <View
            testID={`trip-wizard-period-cell-start-${date}`}
            className="absolute inset-0 rounded-full bg-primary"
          />
        ) : null}
        {role === 'end' ? (
          <View
            testID={`trip-wizard-period-cell-end-${date}`}
            className="absolute inset-0 rounded-full bg-primary"
          />
        ) : null}
        <Text className={`text-body ${numberClass(role, past)}`}>{day}</Text>
      </Pressable>
    </View>
  );
}

export function PeriodEditSheet({
  today,
  month,
  range,
  onPickDate,
  onPrevMonth,
  onNextMonth,
  onApply,
  onClose,
}: PeriodEditSheetProps): ReactElement {
  const [year, monthNum] = month.split('-').map(Number);
  const totalDays = daysInMonth(year, monthNum);
  const leadingBlanks = firstWeekdayOfMonth(year, monthNum);
  const dayNumbers = Array.from({ length: totalDays }, (_, i) => i + 1);

  // today 의 달보다 앞으로는 못 간다 — 그 달은 전 칸이 과거라 고를 게 없다.
  const canGoPrev = month > today.slice(0, 7);
  const rangeComplete = range.start !== undefined && range.end !== undefined;
  // 완성 범위일 때만 요약을 그린다(미완성이면 null → 안 그림). 요약 문자열·요일은 요약 카드와
  // 같은 셀렉터(`summaryPeriod`)를 재사용해 한 곳에서만 만든다.
  const summary = summaryPeriod(range.start, range.end);

  return (
    <BottomSheet
      index={0}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
    >
      <BottomSheetView
        testID="trip-wizard-period-sheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        {/* grabber */}
        <View className="items-center">
          <View className="h-[4px] w-[40px] rounded-[2px] bg-hairline-strong" />
        </View>

        {/* header */}
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            기간
          </Text>
          <Text className="font-noto text-label text-muted">언제 떠나요?</Text>
        </View>

        {/* 선택 요약 — 완성 범위에서만 */}
        {summary !== null ? (
          <Text
            testID="trip-wizard-period-summary"
            className="font-noto-bold text-card-title font-bold text-ink"
          >
            {summary}
          </Text>
        ) : null}

        {/* 캘린더 */}
        <View className="gap-sm">
          {/* 월 네비 */}
          <View className="flex-row items-center justify-between">
            <Pressable
              testID="trip-wizard-period-prev"
              accessibilityRole="button"
              accessibilityLabel="이전 달"
              disabled={!canGoPrev}
              onPress={onPrevMonth}
              className={`h-10 w-10 items-center justify-center ${
                canGoPrev ? '' : 'opacity-40'
              }`}
            >
              <BackChevronGlyph size={24} />
            </Pressable>
            <Text
              testID="trip-wizard-period-month"
              className="font-noto-bold text-section font-bold text-ink"
            >
              {year}년 {monthNum}월
            </Text>
            <Pressable
              testID="trip-wizard-period-next"
              accessibilityRole="button"
              accessibilityLabel="다음 달"
              onPress={onNextMonth}
              className="h-10 w-10 items-center justify-center"
            >
              <ChevronRightGlyph size={24} tone="ink" />
            </Pressable>
          </View>

          {/* 요일 헤더 (일~토) */}
          <View className="w-full flex-row flex-wrap">
            {WEEKDAY_LABELS.map((label) => (
              <View
                key={label}
                className="h-8 w-[14.28%] items-center justify-center"
              >
                <Text className="font-noto text-caption text-muted-soft">
                  {label}
                </Text>
              </View>
            ))}
          </View>

          {/* 주 그리드 */}
          <View className="w-full flex-row flex-wrap">
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <View key={`blank-${i}`} className="h-[44px] w-[14.28%]" />
            ))}
            {dayNumbers.map((day) => {
              const date = dateCell(month, day);
              return (
                <DateCell
                  key={date}
                  date={date}
                  day={day}
                  role={cellRole(date, range)}
                  past={date < today}
                  onPickDate={onPickDate}
                />
              );
            })}
          </View>
        </View>

        {/* 적용 — 범위 완성 시에만 활성(진짜 disabled prop) */}
        <Pressable
          testID="trip-wizard-period-apply"
          accessibilityRole="button"
          disabled={!rangeComplete}
          onPress={onApply}
          className={`h-[52px] items-center justify-center rounded-button bg-primary ${
            rangeComplete ? '' : 'opacity-40'
          }`}
        >
          <Text className="text-[16px] font-noto-bold font-bold text-on-primary">
            적용
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
