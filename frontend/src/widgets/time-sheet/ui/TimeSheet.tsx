import type { ReactElement } from 'react';
import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';

import { deriveEndsNextDay } from '@/entities/itinerary-slot/lib/endsNextDay';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { WheelPicker } from '@/shared/ui/WheelPicker';

/**
 * TRIP-805 · 공용 시각 조정 시트 위젯 — h24 `SlotTimeSheet`·i15/i22 `ManualTimeSheet` 쌍둥이를
 * 하나로 접었다. 접두(`testIDPrefix`)·섹션 라벨(`labels`)·제목(`title`)만 소비처가 주입하고,
 * 나머지 계약(값 형식·셀 press·endsNextDay 유도)은 두 원본과 동일하다.
 *
 * 기본 변형은 시·분을 **값별 셀**(자체 `TimeColumn`)로 두고 셀 탭으로만 고른다. h04 변형은
 * 공용 `WheelPicker` 3열이라 셀 탭 또는 스크롤 정지로 활성 탭(시작/종료) 값이 바뀐다(TRIP-990 D21).
 *
 * 클라는 시간 타당성을 판정하지 않는다(INV-2) — [적용]은 항상 열려 있고, `endsNextDay` 는
 * `end ≤ start`(HH:mm 사전식 비교)의 **기계적 유도**다(HC4). 최종 판정은 저장 시 서버 재검증 몫이다.
 * 분 셀은 bare 숫자("30")다 — "30분" 으로 그리면 소요시간 가드가 시계 분을 오탐한다(INV-3).
 *
 * ★ 시트 실제 열림·2스냅·`enableContentPanningGesture` 는 `@gorhom/bottom-sheet` 통과형 목이
 *   원리적으로 못 본다 — 6-b 실기가 유일 그물(repo-traps 바텀시트 절).
 */

const DEFAULT_TITLE = '시각 조정';
const APPLY_LABEL = '적용';
const CANCEL_LABEL = '취소';

/** 시(00~23)·분(00~59) 라벨을 zero-pad 2자리로 미리 만든다 — 셀 testID·표시가 같은 형태다. */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0')
);

/**
 * h04(시간대 조정) 변형의 장소 요약 행 데이터(TRIP-787).
 * `badgeLabel`은 화면이 파생하지 않고 문자열 그대로 받는다(seed Q3). `imageUrl` null 이면 썸네일 이미지 미렌더.
 * `badgeLabel`·`region` 은 없으면 배지·둘째 줄을 그리지 않는다(TRIP-927 — 슬롯 계약에 region·필수 방문지
 * 신호가 없어 편집 화면은 안 넘긴다. 없는 사실을 "필수 · 꼭 갈 곳"으로 지어내지 않는다).
 */
export interface TimeSheetPlaceSummary {
  imageUrl: string | null;
  name: string;
  badgeLabel?: string;
  region?: string;
}

/** 종료까지 정해진 적용 결과. `endsNextDay` 는 `deriveEndsNextDay` 유도값이다. */
type TimeSheetApplyPatch = {
  startAt: string;
  endAt: string;
  endsNextDay: boolean;
};

interface TimeSheetBaseProps {
  /** 현재값 "HH:mm:ss". */
  startAt: string;
  endAt: string;
  onCancel: () => void;
  /** testID 접두 — 소비처마다 다르다(`itinerary-edit-time`·`planb-manual-time`). */
  testIDPrefix: string;
  /** 섹션 라벨 — 소비처마다 다르다(시작/종료 vs 도착/출발). */
  labels: { start: string; end: string };
  /** 시트 제목 — 미지정 시 '시각 조정'(h24 원본), i15/i22 는 '시각 입력'을 넘긴다. */
  title?: string;
  /** h04 변형의 장소 요약 행. default 모드는 무시한다. */
  placeSummary?: TimeSheetPlaceSummary;
}

/**
 * `mode` 로 갈리는 props(TRIP-927). 미전달 = default(기존 소비처 계약 무변 — 항상 종료까지 싣는다).
 * `'h04'` = 시간대 조정 변형(TRIP-787) — 종료를 손대지 않고 적용하면 `{ startAt, endAt: null }` 을 보내고
 * `endsNextDay` 는 싣지 않는다. "종료는 그대로"의 해석(기존 endAt 유지·유도)은 소비처 몫이다.
 */
export type TimeSheetProps = TimeSheetBaseProps &
  (
    | { mode?: undefined; onApply: (patch: TimeSheetApplyPatch) => void }
    | {
        mode: 'h04';
        onApply: (
          patch: TimeSheetApplyPatch | { startAt: string; endAt: null }
        ) => void;
      }
  );

function renderTimeSheetBackdrop(
  props: BottomSheetBackdropProps
): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 기본 변형 열 눈금 — 초기 스크롤 위치(`contentOffset`)를 셀 번호로 계산하려고 셀·창 높이를 고정한다
 *  (TRIP-981 C). `className` 높이는 jest 가 못 읽어 `style` 숫자로 둔다. */
const CELL_HEIGHT = 40;
const COLUMN_HEIGHT = 168;

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
      style={{ height: CELL_HEIGHT }}
      className={`items-center justify-center rounded-button px-md ${
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

/** 한 컬럼(시 또는 분) — 모든 값 셀이 트리에 실재해야 한다(jest 는 뷰포트가 아니라 트리를 본다).
 * FlatList 가상화 대신 ScrollView + map 으로 전 값을 렌더한다.
 * 처음 선택값이 창 가운데 오도록 시작 위치를 잡고, 양 끝은 스크롤 범위로 자른다(TRIP-981 #042).
 * 첫 렌더 값으로 얼린다 — `contentOffset` 은 값이 바뀔 때마다 다시 적용돼 셀 탭마다 열이 튄다. */
function TimeColumn({
  testIDPrefix,
  field,
  unit,
  values,
  selected,
  onSelect,
}: {
  testIDPrefix: string;
  field: 'start' | 'end';
  unit: 'h' | 'm';
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
}): ReactElement {
  const initialOffset = useRef({
    x: 0,
    y: Math.min(
      Math.max(
        0,
        values.indexOf(selected) * CELL_HEIGHT -
          (COLUMN_HEIGHT - CELL_HEIGHT) / 2
      ),
      values.length * CELL_HEIGHT - COLUMN_HEIGHT
    ),
  }).current;
  return (
    <ScrollView
      testID={`${testIDPrefix}-${field}-${unit}-column`}
      style={{ height: COLUMN_HEIGHT }}
      className="w-[60px]"
      contentOffset={initialOffset}
      showsVerticalScrollIndicator={false}
    >
      {values.map((value) => (
        <TimeCell
          key={value}
          testID={`${testIDPrefix}-${field}-${unit}-${value}`}
          label={value}
          selected={selected === value}
          onPress={() => onSelect(value)}
        />
      ))}
    </ScrollView>
  );
}

// ── h04(시간대 조정) 변형 전용 ─────────────────────────────────────────────
// default 트리를 건드리지 않는 opt-in 분기다(회귀 0, AC-R1). 아래는 그 분기에서만 쓴다.

/** h04 헤더·부제·꼬리·미설정 표기(default 제목 '시각 조정'과 다른 별개 문자열). */
const H04_TITLE = '시간대 조정';
const H04_SUBTITLE = '시작·종료를 돌려서 맞춰요';
const H04_PLACE_SUFFIX = '꼭 갈 곳';
const H04_END_UNSET = '설정 안 됨';

/** 12시간제 휠 열 값. 오전/오후 2개 · 1~12(zero-pad 안 함, 표시 그대로). 분 열은 위 MINUTES 재사용. */
const MERIDIEMS = ['오전', '오후'];
const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));

/** WheelPicker 내부 눈금(WHEEL_CELL_HEIGHT 44 · PAD 88)에 맞춰 손으로 맞춘 h04 selband·페이드
 *  좌표. 세 열의 가운데 셀을 잇는 회색 밴드와 위아래 흰 페이드가 이 값에 정렬한다(정렬 실측은 6-b). */
const H04_BAND_TOP = 88;
const H04_BAND_HEIGHT = 44;
const H04_FADE_HEIGHT = 78;

/** "HH"(24시간·zero-pad) → 12시간제 조각. 오전(0~11)·오후(12~23), 12시는 0으로 안 접고 12로 표시. */
function decompose12(hour24Str: string): { meridiem: string; hour12: string } {
  const hour24 = Number(hour24Str);
  const meridiem = hour24 < 12 ? '오전' : '오후';
  const mod = hour24 % 12;
  return { meridiem, hour12: String(mod === 0 ? 12 : mod) };
}

/** 12시간제 조각 → "HH"(24시간·zero-pad). 오전 12→00, 오후 12→12, 오후 1→13. */
function compose24(meridiem: string, hour12Str: string): string {
  const mod = Number(hour12Str) % 12; // 12 -> 0
  const hour24 = meridiem === '오전' ? mod : mod + 12;
  return String(hour24).padStart(2, '0');
}

/** readout 표시용 "오전/오후 h:mm" (24시간 HH·MM 입력, 분은 bare 숫자 — INV-3). */
function timeLabel12(hourStr: string, minuteStr: string): string {
  const { meridiem, hour12 } = decompose12(hourStr);
  return `${meridiem} ${hour12}:${minuteStr}`;
}

export function TimeSheet(props: TimeSheetProps): ReactElement {
  // onApply 는 `mode` 에 따라 타입이 갈려 구조분해하지 않는다 — `props.mode` 로 좁혀서 부른다.
  const {
    startAt,
    endAt,
    onCancel,
    testIDPrefix,
    labels,
    title = DEFAULT_TITLE,
    placeSummary,
  } = props;
  // 현재 시각을 시·분으로 시드한다(초는 표시·편집하지 않는다 — 적용 시 :00 으로 되돌린다).
  const [startHour, setStartHour] = useState(startAt.slice(0, 2));
  const [startMinute, setStartMinute] = useState(startAt.slice(3, 5));
  const [endHour, setEndHour] = useState(endAt.slice(0, 2));
  const [endMinute, setEndMinute] = useState(endAt.slice(3, 5));
  // h04 전용 상태(default 렌더는 안 읽는다) — 어느 탭이 휠의 편집 대상인가 · 종료를 손댔는가.
  const [activeField, setActiveField] = useState<'start' | 'end'>('start');
  const [endConfigured, setEndConfigured] = useState(false);

  const nextStart = `${startHour}:${startMinute}:00`;

  function handleApply(): void {
    const nextEnd = `${endHour}:${endMinute}:00`;
    props.onApply({
      startAt: nextStart,
      endAt: nextEnd,
      endsNextDay: deriveEndsNextDay(nextStart, nextEnd),
    });
  }

  if (props.mode === 'h04') {
    // 휠은 활성 탭(시작/종료)의 시·분을 편집한다. 12시간제로 보여주되 저장은 24시간 HH 상태(위
    // startHour/endHour 등)에 되쓴다 — 종료를 손댔으면 '적용'이 default 와 같은 handleApply 를 탄다.
    // 종료를 손대지 않았으면 종료를 "모름"으로 보고한다(endAt null, endsNextDay 없음 — TRIP-927).
    const onApplyH04 = props.onApply;
    const handleApplyH04 = (): void => {
      if (endConfigured) {
        handleApply();
      } else {
        onApplyH04({ startAt: nextStart, endAt: null });
      }
    };
    const activeHour = activeField === 'start' ? startHour : endHour;
    const activeMinute = activeField === 'start' ? startMinute : endMinute;
    const { meridiem, hour12 } = decompose12(activeHour);

    const setActiveHour = (next: string): void => {
      if (activeField === 'start') {
        setStartHour(next);
      } else {
        setEndHour(next);
        setEndConfigured(true);
      }
    };
    const setActiveMinute = (next: string): void => {
      if (activeField === 'start') {
        setStartMinute(next);
      } else {
        setEndMinute(next);
        setEndConfigured(true);
      }
    };

    const startLabel = timeLabel12(startHour, startMinute);
    const endLabel = endConfigured
      ? timeLabel12(endHour, endMinute)
      : H04_END_UNSET;

    return (
      // 취소 버튼이 없는 얼굴이라 스와이프·딤 탭 닫힘도 onCancel 로 알린다 — 안 그러면 시트만 사라지고
      // 소비처의 "열림" 상태가 남아 같은 칩을 다시 눌러도 안 열린다(TRIP-927 AC-7).
      // `enableContentPanningGesture={false}` — 본문 pan 이 휠 드래그를 삼켜 시트 끌기로 새는 것을 막는다.
      // 닫기는 핸들·딤으로 남는다(선례 MustVisitTimeScreen · repo-traps 바텀시트 절, jest 사각·6-b 실기).
      <BottomSheet
        backdropComponent={renderTimeSheetBackdrop}
        enablePanDownToClose
        enableContentPanningGesture={false}
        onClose={onCancel}
      >
        <BottomSheetView
          testID={`${testIDPrefix}-sheet`}
          className="w-full gap-lg px-xl pb-[28px] pt-[10px]"
        >
          <View className="w-full gap-xs">
            <Text className="font-noto-bold text-[20px] font-bold text-ink">
              {H04_TITLE}
            </Text>
            <Text className="font-noto text-label text-muted">
              {H04_SUBTITLE}
            </Text>
          </View>

          {placeSummary === undefined ? null : (
            <View
              testID={`${testIDPrefix}-place-summary`}
              className="w-full flex-row items-center gap-md rounded-button bg-surface-soft p-md"
            >
              <View className="h-[48px] w-[48px] overflow-hidden rounded-thumb bg-surface-strong">
                {placeSummary.imageUrl === null ? null : (
                  <Image
                    testID={`${testIDPrefix}-place-thumb-image`}
                    source={{ uri: placeSummary.imageUrl }}
                    resizeMode="cover"
                    className="h-full w-full"
                  />
                )}
              </View>
              <View className="flex-1 gap-[6px]">
                <View className="flex-row items-center gap-sm">
                  <Text
                    numberOfLines={1}
                    className="font-noto-bold text-card-title font-bold text-ink"
                  >
                    {placeSummary.name}
                  </Text>
                  {placeSummary.badgeLabel === undefined ? null : (
                    <View className="rounded-button bg-primary-pale px-sm py-[3px]">
                      <Text className="font-noto-bold text-micro font-bold text-primary">
                        {placeSummary.badgeLabel}
                      </Text>
                    </View>
                  )}
                </View>
                {placeSummary.region === undefined ? null : (
                  <Text
                    numberOfLines={1}
                    className="font-noto text-caption text-muted"
                  >
                    {`${placeSummary.region} · ${H04_PLACE_SUFFIX}`}
                  </Text>
                )}
              </View>
            </View>
          )}

          <SegmentedControl
            testID={`${testIDPrefix}-seg`}
            options={[
              {
                key: 'start',
                label: labels.start,
                testID: `${testIDPrefix}-seg-start`,
              },
              {
                key: 'end',
                label: labels.end,
                testID: `${testIDPrefix}-seg-end`,
              },
            ]}
            value={activeField}
            onChange={(key) => setActiveField(key as 'start' | 'end')}
          />

          <View
            testID={`${testIDPrefix}-readout`}
            className="w-full flex-row items-center justify-center"
          >
            <Text className="font-noto text-label text-muted">
              {`${labels.start} `}
            </Text>
            <Text className="font-noto-bold text-label font-bold text-ink">
              {startLabel}
            </Text>
            <Text className="font-noto text-label text-muted">
              {` · ${labels.end} `}
            </Text>
            <Text
              className={`font-noto-bold text-label font-bold ${
                endConfigured ? 'text-ink' : 'text-muted-soft'
              }`}
            >
              {endLabel}
            </Text>
          </View>

          <View className="relative w-full flex-row">
            {/* 세 열의 가운데 셀을 잇는 회색 selband(WheelPicker 자신은 위아래 hairline 만 그린다). */}
            <View
              pointerEvents="none"
              className="absolute left-0 right-0 rounded-[10px] bg-surface-strong"
              style={{ top: H04_BAND_TOP, height: H04_BAND_HEIGHT }}
            />
            <View className="flex-1">
              <WheelPicker
                testID={`${testIDPrefix}-wheel-ap`}
                values={MERIDIEMS}
                selected={meridiem}
                onSelect={(value) => setActiveHour(compose24(value, hour12))}
                testIDForValue={(value) => `${testIDPrefix}-wheel-ap-${value}`}
              />
            </View>
            <View className="flex-1">
              <WheelPicker
                testID={`${testIDPrefix}-wheel-h`}
                values={HOURS_12}
                selected={hour12}
                onSelect={(value) => setActiveHour(compose24(meridiem, value))}
                testIDForValue={(value) => `${testIDPrefix}-wheel-h-${value}`}
              />
            </View>
            <View className="flex-1">
              <WheelPicker
                testID={`${testIDPrefix}-wheel-m`}
                values={MINUTES}
                selected={activeMinute}
                onSelect={setActiveMinute}
                testIDForValue={(value) => `${testIDPrefix}-wheel-m-${value}`}
              />
            </View>
            {/* 위·아래 흰 페이드 — 가장자리 값이 옅어져 가운데로 시선을 모은다(pointerEvents none). */}
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: H04_FADE_HEIGHT,
              }}
            />
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)']}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: H04_FADE_HEIGHT,
              }}
            />
          </View>

          <Pressable
            testID={`${testIDPrefix}-apply`}
            accessibilityRole="button"
            onPress={handleApplyH04}
            className="w-full items-center justify-center rounded-button bg-primary py-lg"
          >
            <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
              {APPLY_LABEL}
            </Text>
          </Pressable>
        </BottomSheetView>
      </BottomSheet>
    );
  }

  return (
    // 딤 탭 닫힘도 onCancel 로 알린다 — 안 알리면 소비처의 "열림" 상태가 남아 시트가 마운트된 채 닫혀,
    // 다음 '+ 추가'·시각 칩이 다시 열지 못한다(TRIP-981 #057, h04 와 같은 배선). 끌어 닫기는 안 켠다 —
    // 시·분 열이 평범한 ScrollView 라 열을 굴리다 시트가 닫힐 수 있다.
    <BottomSheet backdropComponent={renderTimeSheetBackdrop} onClose={onCancel}>
      <BottomSheetView
        testID={`${testIDPrefix}-sheet`}
        className="w-full gap-lg px-lg pb-2xl pt-sm"
      >
        <Text className="font-noto-bold text-section font-bold text-ink">
          {title}
        </Text>

        <View testID={`${testIDPrefix}-start`} className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            {labels.start}
          </Text>
          <View className="w-full flex-row items-center justify-center gap-sm">
            <TimeColumn
              testIDPrefix={testIDPrefix}
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
              testIDPrefix={testIDPrefix}
              field="start"
              unit="m"
              values={MINUTES}
              selected={startMinute}
              onSelect={setStartMinute}
            />
          </View>
        </View>

        <View testID={`${testIDPrefix}-end`} className="w-full gap-sm">
          <Text className="font-noto-bold text-body font-bold text-ink">
            {labels.end}
          </Text>
          <View className="w-full flex-row items-center justify-center gap-sm">
            <TimeColumn
              testIDPrefix={testIDPrefix}
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
              testIDPrefix={testIDPrefix}
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
            testID={`${testIDPrefix}-cancel`}
            accessibilityRole="button"
            onPress={onCancel}
            className="flex-1 items-center justify-center rounded-button border border-hairline-strong bg-canvas py-md"
          >
            <Text className="font-noto-bold text-body font-bold text-ink">
              {CANCEL_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID={`${testIDPrefix}-apply`}
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
