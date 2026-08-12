import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  ItineraryDaysItemSlotsItem,
  ItineraryStatus,
} from '@/shared/api/generated/schemas';
import {
  KakaoMapView,
  type KakaoMapMessage,
  type MapCenter,
} from '@/shared/map';

import { buildDraftPins, formatDraftDayHeader } from '../model/draftView';
import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CheckCircleGlyph,
  LockGlyph,
} from './ItineraryGlyphs';
import { MapFallback } from './MapFallback';
import { PinDetailSheet } from './PinDetailSheet';
import { PoiSlotCard } from './PoiSlotCard';

/**
 * h25 완성 일정 시간표 뷰(골격·검증 시각) — Figma `1880:1207`.
 *
 * 이 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다. h11 초안과 갈리는 두 규칙이 이
 * 화면의 존재 이유다:
 *  1. 완성이라 `isFixed` 무관하게 **모든 슬롯이 검증 시각을 보인다**(BR-U3-07 · h11 은 고정만).
 *  2. 카드는 **골격만** 그린다 — 서버가 장소명·사진·영업시간·category·거리를 줘도 왼쪽 절반을
 *     그리지 않는다(01b Q2). 넣지 않는 것이라 아예 참조하지 않는다.
 *
 * 자정 넘김은 **문자열로만** 다룬다 — `endsNextDay` 면 `endAt < startAt` 이 정상이라(HC4) Date
 * 파싱·정렬을 하면 시각이 뒤집힌다.
 */

// appbar 제목은 status 로 갈린다(라이브 h34) — PLANNED 은 h25 그대로, CONFIRMED 은 확정 얼굴.
const APPBAR_TITLE_PLANNED = '완성 일정';
const APPBAR_TITLE_CONFIRMED = '확정 일정';
const CONFIRM_LABEL = '일정 확정하기';
// 확정 배너·읽기전용 하단 2버튼 문구(TRIP-300 · D1·D2). 비활성 버튼의 사유는 침묵 금지(INV-4).
const BANNER_TITLE = '일정이 확정됐어요';
const EDIT_LABEL = '일정 수정';
const EDIT_DISABLED_REASON = '확정된 일정은 아직 수정할 수 없어요';
const SHARE_LABEL = '공유하기';
const SHARE_DISABLED_REASON = '공유는 곧 제공돼요';
const SEG_TIMELINE_LABEL = '시간표';
const SEG_MAP_LABEL = '지도';
const FIXED_CHIP = '고정';

// 좌표 슬롯이 하나도 없을 때의 지도 시작 좌표(핀이 있으면 setBounds 가 덮으므로 시작값일 뿐).
// KakaoMapView 기존 호출부·테스트가 쓰는 서울 시청 좌표를 그대로 쓴다.
const DEFAULT_MAP_CENTER: MapCenter = { lat: 37.5665, lng: 126.978 };
// TRIP-301 D6 — 완성 일정 탐색 지도의 줌아웃 상한. 한 여행 권역을 벗어나 한없이 멀어지는 것만
// 막는다(레벨이 클수록 멀리 본다). ponytail: 정확한 상한값은 6-b 실기에서 조정한다.
const EXPLORE_MAP_MAX_LEVEL = 9;

// 카드 그림자(h11 선례와 동일한 Figma 값). RN 은 box-shadow 가 없어 스타일 프로퍼티로 옮긴다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

export interface ItineraryHeaderData {
  title: string;
  nightsLabel: string;
  totalPlaces: number;
}

export type ViewSegmentValue = 'timeline' | 'map';

export interface TimelineScreenProps {
  header: ItineraryHeaderData;
  days: PlanDayTab[];
  /** 활성 날의 슬롯만 — 페이지가 골라 내린다(키 조회지 판정 아님). */
  slots: ItineraryDaysItemSlotsItem[];
  activeDayIndex: number;
  segment: ViewSegmentValue;
  onSelectDay: (index: number) => void;
  onSegmentChange: (value: ViewSegmentValue) => void;
  onBack: () => void;
  /** 확정 상태 축(TRIP-300) — 미지정은 PLANNED 취급. appbar 제목·배너·하단 영역을 가른다. */
  status?: ItineraryStatus;
  /** 확정 배너 부제 — 페이지가 `{범위} · {제목} · {N}곳` 으로 조립해 내려보낸다(CONFIRMED 전용). */
  confirmedSubtitle?: string;
  /** 확정 실패 인라인 안내 — truthy 면 PLANNED 타임라인 위에 그린다. null/undefined 면 없음. */
  confirmError?: string | null;
  /** PLANNED 확정 CTA press 콜백 — 곧장 확정 요청으로 잇는다(중간 다이얼로그 없음). */
  onConfirm?: () => void;
}

function SegmentButton({
  value,
  label,
  segment,
  onSegmentChange,
}: {
  value: ViewSegmentValue;
  label: string;
  segment: ViewSegmentValue;
  onSegmentChange: (value: ViewSegmentValue) => void;
}): ReactElement {
  const active = segment === value;
  return (
    <Pressable
      testID={`itinerary-view-segment-${value}`}
      accessibilityRole="button"
      onPress={() => onSegmentChange(value)}
      style={active ? cardShadow : undefined}
      className={`flex-1 items-center justify-center rounded-[8px] py-sm ${
        active ? 'bg-primary' : ''
      }`}
    >
      <Text
        className={`font-noto-bold text-label font-bold ${
          active ? 'text-on-primary' : 'text-muted'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DayTab({
  tab,
  index,
  selected,
  onSelectDay,
}: {
  tab: PlanDayTab;
  index: number;
  selected: boolean;
  onSelectDay: (index: number) => void;
}): ReactElement {
  return (
    <Pressable
      testID={`itinerary-timeline-day-${tab.dayIndex}`}
      accessibilityRole="button"
      onPress={() => onSelectDay(index)}
      className={`flex-row items-center rounded-pill px-md py-[5px] ${
        selected ? 'bg-primary-pale' : 'border border-hairline-strong'
      }`}
    >
      <Text
        className={`text-label ${
          selected
            ? 'font-noto-bold font-bold text-primary-text'
            : 'font-noto text-body'
        }`}
      >
        {`${tab.dayIndex}일차`}
      </Text>
    </Pressable>
  );
}

/**
 * 카드 한 장 — 골격만. 서버가 준 장소명·사진·영업시간·category·거리·태그는 참조하지 않는다
 * (01b Q2). 완성이라 고정 여부와 무관하게 검증 시각을 그린다(BR-U3-07).
 */
function TimelineSlotCard({
  slot,
  date,
  index,
}: {
  slot: ItineraryDaysItemSlotsItem;
  date: string;
  index: number;
}): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  return (
    <View
      testID={`itinerary-timeline-slot-${slotKey}`}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-[8px] bg-primary">
        <Text
          testID={`itinerary-timeline-slot-no-${slotKey}`}
          className="font-inter-bold text-label font-bold text-on-primary"
        >
          {String(index + 1)}
        </Text>
      </View>

      <View className="flex-1 items-start gap-xs">
        <View className="flex-row flex-wrap items-center gap-xs">
          <Text
            testID={`itinerary-timeline-slot-time-${slotKey}`}
            className="font-noto text-label text-muted"
          >
            {slot.startAt.slice(0, 5)}
          </Text>
          <Text className="font-noto text-label text-muted">·</Text>
          <Text
            testID={`itinerary-timeline-slot-band-${slotKey}`}
            className="font-noto text-label text-muted"
          >
            {timeBandLabel(slot.startAt)}
          </Text>
          {slot.endsNextDay ? (
            <View
              testID={`itinerary-timeline-slot-endsnext-${slotKey}`}
              className="rounded-pill bg-surface-soft px-sm py-[2px]"
            >
              <Text className="font-noto text-caption text-muted">
                {`익일 ${slot.endAt.slice(0, 5)}`}
              </Text>
            </View>
          ) : null}
        </View>

        {slot.hasViolation ? (
          <View
            testID={`itinerary-edit-violation-${slotKey}`}
            className="flex-row items-center gap-xs rounded-button bg-primary-pale px-sm py-xs"
          >
            <AlertCircleGlyph size={16} tone="primaryText" />
            {slot.violationReason === null ||
            slot.violationReason === undefined ? null : (
              <Text className="font-noto text-caption text-primary-text">
                {slot.violationReason}
              </Text>
            )}
          </View>
        ) : null}
      </View>

      {slot.isFixed ? (
        <View
          testID={`itinerary-timeline-slot-fixed-${slotKey}`}
          className="flex-row items-center gap-xs rounded-pill bg-primary-pale py-xs pl-sm pr-md"
        >
          <LockGlyph />
          <Text className="font-noto-bold text-caption font-bold text-primary-text">
            {FIXED_CHIP}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function TimelineScreen({
  header,
  days,
  slots,
  activeDayIndex,
  segment,
  onSelectDay,
  onSegmentChange,
  onBack,
  status,
  confirmedSubtitle,
  confirmError,
  onConfirm,
}: TimelineScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';
  // 확정 얼굴 트리거 — 미지정(undefined)은 PLANNED 취급이라 기존 호출부가 그대로 편집 얼굴이다.
  const isConfirmed = status === 'CONFIRMED';

  // TRIP-301 지도 세그먼트 상태. 탭한 핀의 슬롯(상세 시트)·지도 로드 실패 여부만 이 화면이 쥔다.
  const [selectedSlot, setSelectedSlot] =
    useState<ItineraryDaysItemSlotsItem | null>(null);
  const [mapFailed, setMapFailed] = useState(false);

  // 핀은 좌표 있는 슬롯만(번호는 결번 없이 뛴다 · buildDraftPins 재사용). 상세 시트 역참조도
  // 이 배열을 쓴다 — index 는 pins 배열 기준이라 좌표 결번에도 엉뚱한 슬롯을 열지 않는다.
  const pins = buildDraftPins(slots);
  const mapCenter: MapCenter =
    pins.length > 0
      ? { lat: pins[0].lat, lng: pins[0].lng }
      : DEFAULT_MAP_CENTER;

  // 핀 탭(PIN_TAP)만 이 화면이 소비한다 — index 로 핀을, 핀 번호로 슬롯을 역참조한다.
  function handleMapMessage(message: KakaoMapMessage): void {
    if (message.type !== 'PIN_TAP') return;
    const pin = pins[message.index];
    if (pin === undefined) return;
    const slot = slots[pin.number - 1];
    if (slot === undefined) return;
    setSelectedSlot(slot);
  }

  // 지도 로드 실패를 부모가 받아 자체 폴백으로 그린다(화면을 안 비운다 · INV-4).
  const handleMapLoadFailed = (): void => setMapFailed(true);
  // 재시도 — mapFailed 를 내리면 지도가 다시 마운트돼(key=activeDate) 새 문서로 재로드된다.
  const handleRetry = (): void => setMapFailed(false);

  const showSheet = segment === 'map' && !mapFailed && selectedSlot !== null;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="w-full flex-row items-center gap-[6px] bg-canvas pb-sm pl-md pr-lg pt-lg">
          <Pressable
            testID="itinerary-view-back"
            accessibilityRole="button"
            accessibilityLabel="뒤로"
            onPress={onBack}
            hitSlop={8}
          >
            <BackChevronGlyph />
          </Pressable>
          <Text className="font-noto-bold text-section font-bold text-ink">
            {isConfirmed ? APPBAR_TITLE_CONFIRMED : APPBAR_TITLE_PLANNED}
          </Text>
        </View>

        <View
          testID="itinerary-view-header"
          className="gap-xs px-lg pb-md pt-sm"
        >
          <Text className="font-noto-bold text-section font-bold text-ink">
            {`${header.title} · ${header.nightsLabel}`}
          </Text>
          <Text className="font-noto text-label text-muted">
            {`총 ${header.totalPlaces}곳`}
          </Text>
        </View>

        {isConfirmed ? (
          <View
            testID="itinerary-confirmed-banner"
            className="mx-lg mb-sm flex-row items-center gap-[10px] rounded-button bg-primary-pale px-[14px] py-md"
          >
            <CheckCircleGlyph size={20} />
            <View className="flex-1 gap-[2px]">
              <Text className="font-noto-bold text-body font-bold text-primary-text">
                {BANNER_TITLE}
              </Text>
              {confirmedSubtitle === undefined ||
              confirmedSubtitle === '' ? null : (
                <Text className="font-noto text-caption text-primary-text">
                  {confirmedSubtitle}
                </Text>
              )}
            </View>
          </View>
        ) : null}

        <View className="flex-row gap-[3px] rounded-[8px] bg-hairline p-[3px] mx-lg">
          <SegmentButton
            value="timeline"
            label={SEG_TIMELINE_LABEL}
            segment={segment}
            onSegmentChange={onSegmentChange}
          />
          <SegmentButton
            value="map"
            label={SEG_MAP_LABEL}
            segment={segment}
            onSegmentChange={onSegmentChange}
          />
        </View>

        {days.length === 0 ? null : (
          <View className="flex-row gap-sm px-lg pt-md">
            {days.map((tab, index) => (
              <DayTab
                key={tab.date}
                tab={tab}
                index={index}
                selected={index === activeDayIndex}
                onSelectDay={onSelectDay}
              />
            ))}
          </View>
        )}

        <ScrollView contentContainerClassName="gap-[14px] px-lg pb-lg pt-md">
          {!isConfirmed && confirmError ? (
            <View
              testID="itinerary-confirm-error"
              className="w-full flex-row items-center gap-sm rounded-button bg-primary-pale px-md py-sm"
            >
              <AlertCircleGlyph size={20} tone="primaryText" />
              <Text className="flex-1 font-noto text-label text-primary-text">
                {confirmError}
              </Text>
            </View>
          ) : null}

          {segment === 'timeline' ? (
            <View
              testID="itinerary-view-timeline"
              className="w-full gap-[14px]"
            >
              <View className="w-full flex-row items-center gap-sm">
                <View className="h-[18px] w-[4px] rounded-[2px] bg-primary" />
                <Text className="font-noto text-label text-muted">
                  {formatDraftDayHeader(activeDate)}
                </Text>
                <View className="flex-1" />
                <Text className="font-noto text-label text-muted">
                  {`${slots.length}곳`}
                </Text>
              </View>
              {slots.map((slot, index) => (
                <TimelineSlotCard
                  key={buildSlotKey(activeDate, slot.poiId)}
                  slot={slot}
                  date={activeDate}
                  index={index}
                />
              ))}
            </View>
          ) : null}

          {segment === 'map' ? (
            <View className="w-full gap-md">
              {mapFailed ? (
                <MapFallback onRetry={handleRetry} />
              ) : (
                // 실지도(h26 탐색 지도) — 배럴로 가져와 얇은 가짜가 붙는다. viewOnly 무언급(제스처
                // 허용 · D6)·connectPins 무언급(동선 선 기본). key=activeDate 라 날 바꾸면 새 핀으로
                // 재로드된다(WebView 는 source 가 바뀌면 문서째 재로드하므로 remount 로 갈아끼운다).
                <View
                  testID="itinerary-view-map"
                  className="h-[240px] w-full overflow-hidden rounded-card border border-hairline bg-surface-soft"
                >
                  <KakaoMapView
                    key={activeDate}
                    center={mapCenter}
                    pins={pins}
                    onMapMessage={handleMapMessage}
                    onLoadFailed={handleMapLoadFailed}
                    maxLevel={EXPLORE_MAP_MAX_LEVEL}
                  />
                </View>
              )}

              {mapFailed ? (
                // 폴백 세로 목록 — 지도가 죽어도 통일 카드로 일정을 계속 본다(화면 안 비움).
                <View className="w-full gap-sm">
                  {slots.map((slot, index) => (
                    <PoiSlotCard
                      key={buildSlotKey(activeDate, slot.poiId)}
                      slot={slot}
                      date={activeDate}
                      index={index}
                      variant="list"
                    />
                  ))}
                </View>
              ) : (
                // peekstrip 가로 목록 — 지도 밑에서 같은 통일 카드를 옆으로 넘겨 본다.
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-sm pr-lg"
                >
                  {slots.map((slot, index) => (
                    <PoiSlotCard
                      key={buildSlotKey(activeDate, slot.poiId)}
                      slot={slot}
                      date={activeDate}
                      index={index}
                      variant="peek"
                    />
                  ))}
                </ScrollView>
              )}
            </View>
          ) : null}
        </ScrollView>

        <View className="w-full px-lg pb-lg pt-sm">
          {isConfirmed ? (
            // 읽기전용 하단 2버튼 — 둘 다 비활성(실동작은 후속 티켓)이되 사유로 침묵을 깬다(INV-4).
            // [공유하기]는 Figma 가 분홍 primary 지만 비활성이라 brand색을 쓰지 않는다(회색 fill) —
            // 안 그러면 "눌릴 것 같은데 안 눌리는" 함정이 된다(02a ★1).
            <View className="w-full flex-row gap-sm">
              <Pressable
                testID="itinerary-confirmed-edit"
                accessibilityRole="button"
                disabled
                className="flex-1 items-center justify-center gap-[2px] rounded-button border border-hairline-strong bg-canvas px-md py-sm"
              >
                <Text className="font-noto-bold text-card-title font-bold text-ink">
                  {EDIT_LABEL}
                </Text>
                <Text className="font-noto text-caption text-muted">
                  {EDIT_DISABLED_REASON}
                </Text>
              </Pressable>
              <Pressable
                testID="itinerary-confirmed-share"
                accessibilityRole="button"
                disabled
                className="flex-1 items-center justify-center gap-[2px] rounded-button bg-hairline-strong px-md py-sm"
              >
                <Text className="font-noto-bold text-card-title font-bold text-muted-soft">
                  {SHARE_LABEL}
                </Text>
                <Text className="font-noto text-caption text-muted-soft">
                  {SHARE_DISABLED_REASON}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              testID="itinerary-confirm-cta"
              accessibilityRole="button"
              onPress={onConfirm}
              className="h-12 w-full items-center justify-center rounded-button bg-primary"
            >
              <Text className="font-noto-bold text-[16px] font-bold text-on-primary">
                {CONFIRM_LABEL}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {showSheet && selectedSlot !== null ? (
        <PinDetailSheet
          slot={selectedSlot}
          onClose={() => setSelectedSlot(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}
