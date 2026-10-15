/**
 * TRIP-1308 g01 일과 시간 편집 바텀시트(Figma `4936:3098`) — 하루 시작 · 첫날 시작 · 마지막 날 종료.
 *
 * 값이 시트 안 드래프트(`useState`)로 산다 — `VisitTimeSheet` 선례. 페이지는 조건부로 마운트하고(열 때마다
 * 현재 스토어 값에서 시드) "적용"에서만 `onApply` 로 커밋한다. 정한 값만 키가 있는 `DayWindow` 를 돌려주며
 * 기본(09:00)과 같은 하루 시작은 지워진다(요청에 안 실림).
 *
 * 여러 날: 세그먼트 탭 3개(하루 시작 / 첫날 / 마지막 날) + 선택 탭의 값을 휠 하나(시·분 2열, 24시간제,
 * 분은 30분 단위)로 고른다. 안 정한 첫날·마지막 날 탭을 누르면 **그 값이 바로 켜지고**(12:00 · 18:00),
 * `따로 정하지 않기` 링크로 끈다. 당일치기: 첫날=마지막 날이라 탭 없이 `시작`/`끝` 두 칸(= 첫날 시작 ·
 * 마지막 날 종료)을 나란히 둔다 — 이 변형은 Figma 에 휠 버전이 없어 같은 재료로 구성한 것이다.
 *
 * ⚠️ 실제 개폐·딤·휠 제스처 분리(`enableContentPanningGesture={false}`)는 gorhom 통과형 목이라 jest 사각 —
 * 6-b 실기 몫이다(`repo-traps.md` 바텀시트 절).
 */
import { type ReactElement, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';

import {
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_FIRST_DAY_START,
  DEFAULT_LAST_DAY_END,
  WHEEL_HOURS,
  WHEEL_MINUTES,
  isDefaultDayWindow,
  normalizeDayWindow,
  validateDayWindow,
  type DayWindow,
} from '@/features/create-trip';
import { SHEET_HANDLE_INDICATOR_STYLE } from '@/shared/lib/sheetHandle';
import { WheelPicker } from '@/shared/ui/WheelPicker';

export interface DayWindowEditSheetProps {
  /** 지금 스토어에 커밋된 값 — 시트가 열릴 때 드래프트로 복사한다. */
  value: DayWindow;
  /** 여행이 하루(0박)면 탭 대신 `시작`/`끝` 두 칸. */
  sameDay: boolean;
  onApply: (next: DayWindow) => void;
  onClose: () => void;
}

type Tab = 'day' | 'first' | 'last';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'day', label: '하루 시작', hint: '모든 날에 공통으로 적용돼요' },
  { key: 'first', label: '첫날', hint: '비행기·KTX 도착 뒤에 시작해요' },
  { key: 'last', label: '마지막 날', hint: '출발 전에 끝내요' },
];
const UNSET_LABEL = '따로 안 정해요';
const DAY_START_ERROR = '하루 시작은 일과 종료보다 빨라야 해요';
const SAME_DAY_END_ERROR = '종료는 시작보다 늦어야 해요';

function renderBackdrop(props: BottomSheetBackdropProps): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 시·분 두 열 휠 한 쌍 — 값은 `HH:mm`. 분 휠은 30분 단위 두 칸이라 값이 눈금 밖이면 선택 표시가 없다. */
function ClockWheel({
  testID,
  value,
  onChange,
}: {
  testID: string;
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const [hour, minute] = value.split(':');
  return (
    <View
      testID={testID}
      className="w-full flex-row items-center justify-center gap-sm"
    >
      <View className="w-[72px]">
        <WheelPicker
          testID={`${testID}-h-wheel`}
          values={WHEEL_HOURS}
          selected={hour}
          onSelect={(next) => onChange(`${next}:${minute}`)}
          testIDForValue={(next) => `${testID}-h-${next}`}
        />
      </View>
      <Text className="font-noto-bold text-section font-bold text-ink">:</Text>
      <View className="w-[72px]">
        <WheelPicker
          testID={`${testID}-m-wheel`}
          values={WHEEL_MINUTES}
          selected={minute}
          onSelect={(next) => onChange(`${hour}:${next}`)}
          testIDForValue={(next) => `${testID}-m-${next}`}
        />
      </View>
    </View>
  );
}

/** 당일치기 "적용" — 첫날 시작·마지막 날 종료는 기본과 같으면 지운다(정한 것만 요청에 실린다). */
function finalizeSameDay(draft: DayWindow): DayWindow {
  const { firstDayStartAt, lastDayEndAt, ...rest } = draft;
  return normalizeDayWindow({
    ...rest,
    ...(firstDayStartAt !== undefined &&
    firstDayStartAt !== (draft.dayStartAt ?? DEFAULT_DAY_START)
      ? { firstDayStartAt }
      : {}),
    ...(lastDayEndAt !== undefined && lastDayEndAt !== DEFAULT_DAY_END
      ? { lastDayEndAt }
      : {}),
  });
}

export function DayWindowEditSheet({
  value,
  sameDay,
  onApply,
  onClose,
}: DayWindowEditSheetProps): ReactElement {
  const [draft, setDraft] = useState<DayWindow>(value);
  const [tab, setTab] = useState<Tab>('day');

  const violations = validateDayWindow(draft, sameDay);
  const invalid = violations.length > 0;
  const tabValue: Record<Tab, string | undefined> = {
    day: draft.dayStartAt ?? DEFAULT_DAY_START,
    first: draft.firstDayStartAt,
    last: draft.lastDayEndAt,
  };

  function pickTab(next: Tab): void {
    // 안 정한 칸을 누르면 그 값이 바로 켜진다 — 휠이 비어 보이지 않게.
    if (next === 'first' && draft.firstDayStartAt === undefined) {
      setDraft({ ...draft, firstDayStartAt: DEFAULT_FIRST_DAY_START });
    }
    if (next === 'last' && draft.lastDayEndAt === undefined) {
      setDraft({ ...draft, lastDayEndAt: DEFAULT_LAST_DAY_END });
    }
    setTab(next);
  }

  function setTabValue(field: Tab, next: string): void {
    const key =
      field === 'day'
        ? 'dayStartAt'
        : field === 'first'
          ? 'firstDayStartAt'
          : 'lastDayEndAt';
    setDraft({ ...draft, [key]: next });
  }

  function turnOff(field: 'first' | 'last'): void {
    const { firstDayStartAt, lastDayEndAt, ...rest } = draft;
    setDraft(
      field === 'first'
        ? { ...rest, ...(lastDayEndAt ? { lastDayEndAt } : {}) }
        : { ...rest, ...(firstDayStartAt ? { firstDayStartAt } : {}) }
    );
    setTab('day');
  }

  function reset(): void {
    setDraft({});
    setTab('day');
  }

  function apply(): void {
    if (invalid) return;
    onApply(sameDay ? finalizeSameDay(draft) : normalizeDayWindow(draft));
  }

  const sameDayStart =
    draft.firstDayStartAt ?? draft.dayStartAt ?? DEFAULT_DAY_START;
  const sameDayEnd = draft.lastDayEndAt ?? DEFAULT_DAY_END;
  const activeHint = TABS.find((one) => one.key === tab)?.hint ?? '';

  return (
    <BottomSheet
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={SHEET_HANDLE_INDICATOR_STYLE}
      enableContentPanningGesture={false}
      onClose={onClose}
    >
      <BottomSheetView
        testID="trip-wizard-daywindow-sheet"
        className="gap-lg px-xl pb-[34px] pt-[10px]"
      >
        <View className="gap-xs">
          <Text className="text-[20px] font-noto-bold font-bold text-ink">
            일과 시간
          </Text>
          <Text className="font-noto text-label text-muted">
            AI가 이 시간 안에서 하루를 짜요
          </Text>
        </View>

        {sameDay ? (
          <View className="flex-row gap-md">
            <View className="flex-1 gap-sm">
              <Text className="font-noto-bold text-label font-bold text-ink">
                시작
              </Text>
              <ClockWheel
                testID="trip-wizard-daywindow-start"
                value={sameDayStart}
                onChange={(next) => setTabValue('first', next)}
              />
            </View>
            <View className="flex-1 gap-sm">
              <Text className="font-noto-bold text-label font-bold text-ink">
                끝
              </Text>
              <ClockWheel
                testID="trip-wizard-daywindow-end"
                value={sameDayEnd}
                onChange={(next) => setTabValue('last', next)}
              />
              {invalid ? (
                <Text
                  testID="trip-wizard-daywindow-error-end"
                  className="font-noto text-caption text-primary-text"
                >
                  {SAME_DAY_END_ERROR}
                </Text>
              ) : null}
            </View>
          </View>
        ) : (
          <>
            <View className="flex-row gap-xs rounded-button bg-surface-strong p-xs">
              {TABS.map((one) => {
                const isActive = tab === one.key;
                return (
                  <Pressable
                    key={one.key}
                    testID={`trip-wizard-daywindow-tab-${one.key}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => pickTab(one.key)}
                    className={`flex-1 items-center rounded-button px-xs py-sm ${
                      isActive ? 'bg-canvas' : ''
                    }`}
                  >
                    <Text
                      className={`font-noto text-label ${
                        isActive
                          ? 'font-noto-bold font-bold text-ink'
                          : 'text-muted'
                      }`}
                    >
                      {one.label}
                    </Text>
                    <Text
                      testID={`trip-wizard-daywindow-tab-${one.key}-value`}
                      className={`font-noto text-caption ${
                        isActive
                          ? 'font-noto-bold font-bold text-ink'
                          : 'text-muted'
                      }`}
                    >
                      {tabValue[one.key] ?? UNSET_LABEL}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text
              testID="trip-wizard-daywindow-hint"
              className="font-noto text-caption text-muted"
            >
              {activeHint}
            </Text>
            <ClockWheel
              testID="trip-wizard-daywindow-wheel"
              value={tabValue[tab] ?? DEFAULT_DAY_START}
              onChange={(next) => setTabValue(tab, next)}
            />
            {tab === 'day' ? null : (
              <Pressable
                testID="trip-wizard-daywindow-off"
                accessibilityRole="button"
                onPress={() => turnOff(tab)}
                className="items-center"
              >
                <Text className="font-noto text-label text-muted underline">
                  따로 정하지 않기
                </Text>
              </Pressable>
            )}
            {invalid ? (
              <Text
                testID="trip-wizard-daywindow-error"
                className="font-noto text-caption text-primary-text"
              >
                {DAY_START_ERROR}
              </Text>
            ) : null}
          </>
        )}

        <Pressable
          testID="trip-wizard-daywindow-reset"
          accessibilityRole="button"
          disabled={isDefaultDayWindow(draft)}
          onPress={reset}
          className={`items-center ${isDefaultDayWindow(draft) ? 'opacity-40' : ''}`}
        >
          <Text className="font-noto-bold text-label font-bold text-primary-text">
            기본값으로 되돌리기
          </Text>
        </Pressable>

        <Pressable
          testID="trip-wizard-daywindow-apply"
          accessibilityRole="button"
          disabled={invalid}
          onPress={apply}
          className={`h-[52px] items-center justify-center rounded-button bg-primary ${
            invalid ? 'opacity-40' : ''
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
