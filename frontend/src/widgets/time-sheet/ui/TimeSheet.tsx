import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PlacePhoto } from '@/shared/ui/PlacePhoto';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';

import { deriveEndsNextDay, isValidTimeRange } from '@/entities/itinerary-slot';
import { CloseGlyph } from '@/shared/ui/glyphs';
import { SegmentedControl } from '@/shared/ui/SegmentedControl';
import { HourMinuteWheel } from '@/shared/ui/HourMinuteWheel';

/**
 * TRIP-805 · 공용 시각 조정 시트 위젯 — h24 `SlotTimeSheet`·i15/i22 `ManualTimeSheet` 쌍둥이를
 * 하나로 접었다. 접두(`testIDPrefix`)·섹션 라벨(`labels`)·제목(`title`)·장소 요약 행(`placeSummary`)만
 * 소비처가 주입한다.
 *
 * TRIP-1196 — 입력은 한 구현이다: 시작/종료 세그먼트 + 시간 표시 줄(readout) + 시·분 공용
 * `HourMinuteWheel` 2열(24시간, TRIP-1437 — 옛 오전/오후 열 폐기) + [적용]. 머리 오른쪽 X(`{prefix}-close`)는 `onCancel` 이다(TRIP-1417 Q-101).
 * 휠은 셀 탭 또는 스크롤 정지로 활성 탭(시작/종료) 값을 바꾼다(TRIP-990 D21).
 * 소비처 간 차이는 제목과 장소 요약 행뿐이다(h04 편집기만 '시간대 조정'+요약 행을 넘긴다).
 *
 * readout 종료 칸은 처음부터 `endAt` 시각이다(TRIP-1417 Q-100 — 옛 '설정 안 됨' 얼굴 폐기).
 * 종료를 손대지 않고 [적용]하면 종료는 **현재 값(`endAt` prop) 유지**이고 `endsNextDay` 만 새 시작 기준으로
 * 다시 유도한다 — 서버 계약상 endAt 은 필수 문자열이라 null 은 밖으로 나가지 않는다.
 * `endsNextDay` 는 `end ≤ start`(HH:mm 사전식 비교)의 **기계적 유도**다(HC4).
 * TRIP-1215 — (시작, 실제로 실릴 종료) 쌍이 `isValidTimeRange` 를 어기면 오류 문구를 띄우고 [적용]을
 * 잠근다(숨은 종료에도 같은 규칙). 매 렌더 판정이라 휠을 굴리면 바로 따라온다. UX 사본일 뿐 최종 판정은
 * 저장 시 서버 재검증 몫이다(INV-2).
 * 휠 값·readout 은 `HH:mm`(24시간) 이고 분은 bare 숫자("30")다 — "30분" 으로 그리면 소요시간 가드가 시계 분을 오탐한다(INV-3).
 *
 * ★ 시트 실제 열림·`enableContentPanningGesture`·휠 제스처·페이드는 `@gorhom/bottom-sheet` 통과형 목이
 *   원리적으로 못 본다 — 6-b 실기가 유일 그물(repo-traps 바텀시트 절).
 */

const DEFAULT_TITLE = '시각 조정';
const APPLY_LABEL = '적용';
const RANGE_ERROR = '종료 시각은 시작보다 늦어야 해요';

/**
 * 장소 요약 행 데이터(TRIP-787) — 편집기(h04)만 넘긴다.
 * `badgeLabel`은 화면이 파생하지 않고 문자열 그대로 받는다(seed Q3). `imageUrl` null 이면 `category`·`poiId` 로 고른 생성 이미지.
 * `badgeLabel`·`region` 은 없으면 배지·둘째 줄을 그리지 않는다(TRIP-927 — 슬롯 계약에 region·필수 방문지
 * 신호가 없어 편집 화면은 안 넘긴다. 없는 사실을 "필수 · 꼭 갈 곳"으로 지어내지 않는다).
 */
export interface TimeSheetPlaceSummary {
  imageUrl: string | null;
  /** 사진이 없을 때 고르는 생성 이미지의 카테고리(한글 정본)·변형을 해시할 poiId. */
  poiId?: string;
  category?: string | null;
  name: string;
  badgeLabel?: string;
  region?: string;
}

/** 적용 결과. `endAt` 은 항상 문자열이고 `endsNextDay` 는 `deriveEndsNextDay` 유도값이다. */
type TimeSheetApplyPatch = {
  startAt: string;
  endAt: string;
  endsNextDay: boolean;
};

export interface TimeSheetProps {
  /** 현재값 "HH:mm:ss". */
  startAt: string;
  endAt: string;
  onApply: (patch: TimeSheetApplyPatch) => void;
  onCancel: () => void;
  /** testID 접두 — 소비처마다 다르다(`itinerary-edit-time`·`itinerary-manual-time`). */
  testIDPrefix: string;
  /** 세그먼트·readout 라벨 — 소비처마다 다르다(시작/종료 vs 도착/출발). */
  labels: { start: string; end: string };
  /** 시트 제목 — 미지정 시 '시각 조정'. 편집기(h04)는 '시간대 조정'을 넘긴다. */
  title?: string;
  /** 장소 요약 행 — 편집기(h04)만 넘긴다. 없으면 행을 그리지 않는다. */
  placeSummary?: TimeSheetPlaceSummary;
}

function renderTimeSheetBackdrop(
  props: BottomSheetBackdropProps
): ReactElement {
  return (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />
  );
}

/** 부제·요약 행 꼬리. */
const SHEET_SUBTITLE = '시작·종료를 돌려서 맞춰요';
const SHEET_PLACE_SUFFIX = '꼭 갈 곳';

/** 위아래 흰 페이드 높이 — WheelPicker 눈금(셀 44 · 위 패딩 88)에 맞춘 손값(정렬 실측은 6-b). */
const SHEET_FADE_HEIGHT = 78;

export function TimeSheet({
  startAt,
  endAt,
  onApply,
  onCancel,
  testIDPrefix,
  labels,
  title = DEFAULT_TITLE,
  placeSummary,
}: TimeSheetProps): ReactElement {
  // 현재 시각을 시·분으로 시드한다(초는 표시·편집하지 않는다 — 적용 시 :00 으로 되돌린다).
  const [startHour, setStartHour] = useState(startAt.slice(0, 2));
  const [startMinute, setStartMinute] = useState(startAt.slice(3, 5));
  const [endHour, setEndHour] = useState(endAt.slice(0, 2));
  const [endMinute, setEndMinute] = useState(endAt.slice(3, 5));
  // 어느 탭이 휠의 편집 대상인가 · 종료를 손댔는가(손대지 않으면 종료는 현재 값 유지).
  const [activeField, setActiveField] = useState<'start' | 'end'>('start');
  const [endConfigured, setEndConfigured] = useState(false);

  const nextStart = `${startHour}:${startMinute}:00`;

  // 휠은 활성 탭(시작/종료)의 시·분을 편집한다.
  // 종료를 손대지 않았으면 현재 endAt 을 그대로 싣고 endsNextDay 만 새 시작 기준으로 다시 유도한다.
  const nextEnd = endConfigured ? `${endHour}:${endMinute}:00` : endAt;
  const rangeInvalid = !isValidTimeRange(nextStart, nextEnd);

  function handleApply(): void {
    onApply({
      startAt: nextStart,
      endAt: nextEnd,
      endsNextDay: deriveEndsNextDay(nextStart, nextEnd),
    });
  }
  const startLabel = `${startHour}:${startMinute}`;
  const endLabel = `${endHour}:${endMinute}`;

  // next = 'HH:mm'. 종료를 바꾸면 "설정됨" 이 켜져 적용에 그 값이 실린다.
  const setActiveTime = (next: string): void => {
    if (activeField === 'start') {
      setStartHour(next.slice(0, 2));
      setStartMinute(next.slice(3, 5));
    } else {
      setEndHour(next.slice(0, 2));
      setEndMinute(next.slice(3, 5));
      setEndConfigured(true);
    }
  };

  return (
    // 머리 X 말고도 스와이프·딤 탭 닫힘을 onCancel 로 알린다 — 안 그러면 시트만 사라지고
    // 소비처의 "열림" 상태가 남아 같은 칩을 다시 눌러도 안 열린다(TRIP-927 AC-7).
    // `enableContentPanningGesture={false}` — 본문 pan 이 휠 드래그를 삼켜 시트 끌기로 새는 것을 막는다.
    // 닫기는 머리 X·핸들·딤으로 남는다(선례 MustVisitTimeScreen · repo-traps 바텀시트 절, jest 사각·6-b 실기).
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
        <View className="w-full flex-row items-start justify-between">
          <View className="flex-1 gap-xs">
            <Text className="font-noto-bold text-[20px] font-bold text-ink">
              {title}
            </Text>
            <Text className="font-noto text-label text-muted">
              {SHEET_SUBTITLE}
            </Text>
          </View>
          {/* 44 터치 타깃 · 아이콘 24(i01 메모 시트 X 선례 Figma 4741:2993). */}
          <Pressable
            testID={`${testIDPrefix}-close`}
            accessibilityRole="button"
            accessibilityLabel="닫기"
            onPress={onCancel}
            className="h-[44px] w-[44px] items-center justify-center"
          >
            <CloseGlyph size={24} color="ink" />
          </Pressable>
        </View>

        {placeSummary === undefined ? null : (
          <View
            testID={`${testIDPrefix}-place-summary`}
            className="w-full flex-row items-center gap-md rounded-button bg-surface-soft p-md"
          >
            <View className="h-[48px] w-[48px] overflow-hidden rounded-thumb bg-surface-strong">
              <PlacePhoto
                testID={`${testIDPrefix}-place-thumb-image`}
                imageUrl={placeSummary.imageUrl}
                category={placeSummary.category}
                poiId={placeSummary.poiId}
                contentFit="cover"
                cachePolicy="memory-disk"
                className="h-full w-full"
              />
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
                  {`${placeSummary.region} · ${SHEET_PLACE_SUFFIX}`}
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
          <Text className="font-noto-bold text-label font-bold text-ink">
            {endLabel}
          </Text>
        </View>

        <View className="relative w-full">
          <HourMinuteWheel
            value={activeField === 'start' ? startLabel : endLabel}
            onChange={setActiveTime}
            hourWheelTestID={`${testIDPrefix}-wheel-h`}
            minuteWheelTestID={`${testIDPrefix}-wheel-m`}
            hourCellTestID={(hour) => `${testIDPrefix}-wheel-h-${hour}`}
            minuteCellTestID={(minute) => `${testIDPrefix}-wheel-m-${minute}`}
          />
          {/* 위·아래 흰 페이드 — 가장자리 값이 옅어져 가운데로 시선을 모은다(pointerEvents none). */}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,1)', 'rgba(255,255,255,0)']}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: SHEET_FADE_HEIGHT,
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
              height: SHEET_FADE_HEIGHT,
            }}
          />
        </View>

        {rangeInvalid ? (
          <Text
            testID={`${testIDPrefix}-error`}
            className="font-noto text-label text-primary-text"
          >
            {RANGE_ERROR}
          </Text>
        ) : null}

        <Pressable
          testID={`${testIDPrefix}-apply`}
          accessibilityRole="button"
          onPress={handleApply}
          disabled={rangeInvalid}
          className={`w-full items-center justify-center rounded-button py-lg ${
            rangeInvalid ? 'bg-hairline-strong' : 'bg-primary'
          }`}
        >
          <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
            {APPLY_LABEL}
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}
