import type { ReactElement } from 'react';
import { Fragment, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
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
import { legDistance } from '../model/legDistance';
import type { PlanDayTab } from '../model/planState';
import { buildSlotKey } from '../model/slotKey';
import { timeBandLabel } from '../model/timeBandLabel';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  CarGlyph,
  ChevronRightGlyph,
  ExpandGlyph,
  LockGlyph,
  PencilGlyph,
  ShareGlyph,
  WalkGlyph,
} from './ItineraryGlyphs';
import { MapFallback } from './MapFallback';
import { PinDetailSheet } from './PinDetailSheet';
import { PoiSlotCard } from './PoiSlotCard';
import { SlotPhotoPlaceholder } from './SlotPhotoPlaceholder';

/**
 * h25/h34 완성·확정 일정 시간표 뷰 — Figma h34 `1884:1190`(TRIP-354 풀디자인 정합).
 *
 * 이 화면은 완성된 값만 받는다 — 조회도 판정도 하지 않는다. h11 초안과 갈리는 규칙:
 *  1. 완성이라 `isFixed` 무관하게 **모든 슬롯이 검증 시각을 보인다**(BR-U3-07 · h11 은 고정만).
 *  2. 카드는 **풀카드**다(TRIP-354 — 이전엔 골격) — 사진·장소명·영업시간·첫 태그를 각각 값 하나만
 *     담는 leaf 로 그린다. 라벨 축은 `timeBandLabel`(01b Q1, Figma 성격 축이 아니다).
 *  3. 카드 사이 **구간행**이 슬롯 `distanceRange` 를 **문자열 그대로** 나른다(BR-U3-08 파생 금지).
 *     날짜헤더의 "이동 X" 만 그 문자열들을 파싱·합산한 별개 파생이다(`legDistance`, Q2).
 *
 * 세그먼트 토글(시간표/지도)은 없다(TRIP-354 결정 D) — 지도는 날짜탭 밑에 **작은 viewOnly 글랜스**로
 * 상시 인라인이고, "지도 크게 보기"가 HEAD h26(제스처 지도 + peekstrip + 핀시트 + 폴백)을 화면 내
 * 확대 오버레이(`expanded` 로컬 상태)로 연다(Q5). 기본/오버레이 지도는 상호 배타다.
 *
 * INV-3: 소요시간(분/시간/소요)은 소스·렌더 어디에도 없다 — 영업시간은 `slot.openingHours`(서버값)
 * 로만 그린다. 자정 넘김은 **문자열로만** 다룬다(HC4 — `endAt < startAt` 이 정상이라 Date 정렬 금지).
 */

// appbar 제목은 status 로 갈린다(라이브 h34) — PLANNED 은 h25 그대로, CONFIRMED 은 확정 얼굴.
const APPBAR_TITLE_PLANNED = '완성 일정';
const APPBAR_TITLE_CONFIRMED = '확정 일정';
const CONFIRM_LABEL = '일정 확정하기';
// PARTIAL(생성 중) 예방 잠금 사유 — 침묵 금지(INV-4). 정확 문안은 정본에 없어 심판은 "만드는 중"
// 계열로만 잠근다(02a M4). 서버 계약(PARTIAL→409)의 예방 UX 일 뿐 — 권위는 서버(01b D2·D3).
const CONFIRM_LOCKED_NOTE =
  '일정을 만드는 중이에요 · 다 만들어지면 확정할 수 있어요';
// 확정 이후 안내 한 줄(TRIP-505 · BR-U3-30) — 배너·하단 2버튼을 지운 자리에 "바꾸려면 재생성뿐"
// 이라는 새 정보만 남긴다(중복 아닌 유일한 탈출구 · INV-4). 심판은 `/새로 만들어/` 부분만 잠근다.
const CONFIRMED_NOTE = '확정된 일정이에요. 바꾸려면 새로 만들어 주세요.';
const FIXED_CHIP = '고정';
// 풀카드 표면 문구(TRIP-354). 영업시간 null 은 "미확인"(PoiSlotCard 선례와 동일 규율).
const MISSING_HOURS = '미확인';
const NO_MAP_BADGE = '위치 정보 없음 · 지도 미표시';
// 휴관칩 문구 — Figma 목업은 "월 휴관 확인" 이지만 요일 필드가 계약에 없어 **발명 금지**(01b Q4 ·
// 02a ★10). 요일 없는 일반 문구로 둔다. 트리거는 `openingHoursKnown === false` 뿐(데이터 신호).
const WARN_CHIP = '휴관일 확인';
const DIRECTIONS_LABEL = '길찾기';
const MAP_EXPAND_LABEL = '지도 크게 보기';
const MAP_COLLAPSE_LABEL = '닫기';
// 구간행 이동수단 판정 — 서버 `distanceRange` 꼬리("· 차량 추정")로 도보/차량 아이콘만 가른다.
// 거리·이동수단만 본다(INV-3). 판정이 아니라 표시 아이콘 선택일 뿐이다.
const CAR_MODE_HINT = '차량';

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

export interface TimelineScreenProps {
  header: ItineraryHeaderData;
  days: PlanDayTab[];
  /** 활성 날의 슬롯만 — 페이지가 골라 내린다(키 조회지 판정 아님). */
  slots: ItineraryDaysItemSlotsItem[];
  activeDayIndex: number;
  onSelectDay: (index: number) => void;
  onBack: () => void;
  /** 확정 상태 축(TRIP-300) — 미지정은 PLANNED 취급. appbar 제목·배너·하단 영역을 가른다. */
  status?: ItineraryStatus;
  /** 확정 실패 인라인 안내 — truthy 면 PLANNED 타임라인 위에 그린다. null/undefined 면 없음. */
  confirmError?: string | null;
  /** PLANNED 확정 CTA press 콜백 — 곧장 확정 요청으로 잇는다(중간 다이얼로그 없음). */
  onConfirm?: () => void;
  /** 확정 예방 잠금(TRIP-337 · PARTIAL 생성 중) — true 면 확정 CTA 를 실제 disabled 로 두고 사유를
   * 병기한다. 페이지가 `isConfirmLocked(generationState)` 로 판정해 내린다. 미지정=잠금 없음. */
  confirmLocked?: boolean;
  /** PLANNED(h25) 편집 진입 어포던스 press 콜백 — 페이지가 edit 라우트 push 를 여기 배선(TRIP-482).
   * 미지정=기존 동작 불변(후방호환, `onConfirm?` 선례). CONFIRMED(h34) 얼굴엔 어포던스가 없다. */
  onEdit?: () => void;
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
 * 카드 사이 **구간행**(connector) — 슬롯[i]의 `distanceRange` 를 카드[i-1]↔[i] 사이에 그린다.
 * 첫 카드(i=0) 위엔 없고(직전 지점 없음), `distanceRange` 가 없으면 이 컴포넌트를 렌더하지 않는다
 * (부모가 가른다 — 빈 문자열 렌더 금지, AC6).
 *
 * 무엇을 보장하나: 서버 문자열을 **가공 없이 그대로** 나른다(BR-U3-08 — "약 950m" 에서 소요시간을
 * 유도하지 않는다). [길찾기]는 콜백을 아예 안 받는 죽은 스텁이라 press 가 무해하다(Q6 · 02a ★11).
 */
function SlotConnector({
  slotKey,
  distanceRange,
}: {
  slotKey: string;
  distanceRange: string;
}): ReactElement {
  const byCar = distanceRange.includes(CAR_MODE_HINT);
  return (
    <View
      testID={`itinerary-timeline-connector-${slotKey}`}
      className="w-full flex-row items-center gap-[7px] pl-md"
    >
      {byCar ? <CarGlyph size={16} /> : <WalkGlyph size={16} />}
      <Text
        testID={`itinerary-timeline-connector-distance-${slotKey}`}
        className="font-noto text-caption text-muted"
      >
        {distanceRange}
      </Text>
      <View className="h-0 flex-1 self-center border-t border-dashed border-hairline-strong" />
      <Pressable
        testID={`itinerary-timeline-connector-directions-${slotKey}`}
        accessibilityRole="button"
        hitSlop={6}
        className="flex-row items-center gap-[2px]"
      >
        <Text className="font-noto-bold text-caption font-bold text-primary-text">
          {DIRECTIONS_LABEL}
        </Text>
        <ChevronRightGlyph size={16} />
      </Pressable>
    </View>
  );
}

/**
 * 카드 한 장 — **풀카드**(TRIP-354). 사진·장소명·영업시간·첫 태그를 각각 값 하나만 담는 leaf 로
 * 그린다(RNTL `toHaveTextContent` 완전 일치 계약). 완성이라 고정 여부와 무관하게 검증 시각을
 * 그린다(BR-U3-07).
 *
 * 반쪽 계약(null 이 정상 경로 · INV-1):
 *  - `imageUrl` null → 사진 leaf 자체 부재(기본 이미지 발명 금지).
 *  - `openingHours` null → 빈칸이 아니라 "미확인".
 *  - `tags` [] → 태그 leaf 부재. `nameKo` null → 이름 leaf 부재(더미 텍스트 금지).
 *  - 좌표 null → 카드는 목록에 남고 "지도 미표시" 배지를 단다(INV-4).
 *  - 휴관칩은 `openingHoursKnown === false` 에서만(데이터 신호만, status 게이트 없음 · Q4).
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
  const fieldId = (role: string): string =>
    `itinerary-timeline-slot-${role}-${slotKey}`;
  const hasImage = slot.imageUrl !== null && slot.imageUrl !== undefined;
  const hasName = slot.nameKo !== null && slot.nameKo !== undefined;
  const firstTag = slot.tags.length > 0 ? slot.tags[0] : null;
  const hasCoord = typeof slot.lat === 'number' && typeof slot.lng === 'number';

  return (
    <View
      testID={`itinerary-timeline-slot-${slotKey}`}
      style={cardShadow}
      className="w-full flex-row items-start gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      <View className="h-[26px] w-[26px] items-center justify-center rounded-[8px] bg-primary">
        <Text
          testID={fieldId('no')}
          className="font-inter-bold text-label font-bold text-on-primary"
        >
          {String(index + 1)}
        </Text>
      </View>

      {hasImage ? (
        <Image
          testID={fieldId('image')}
          source={{ uri: slot.imageUrl as string }}
          resizeMode="cover"
          className="h-[78px] w-[78px] rounded-[12px]"
        />
      ) : (
        // 사진 없는 슬롯(imageUrl null) — 빈 자리 대신 카테고리 틴트 플레이스홀더(TRIP-465). 사진과
        // 상호 배타(hasImage 갈래) — 실사진을 지어내지 않는다(INV-1).
        <SlotPhotoPlaceholder
          category={slot.category}
          testID={fieldId('photoplaceholder')}
        />
      )}

      <View className="flex-1 items-start gap-xs">
        <View className="flex-row flex-wrap items-center gap-xs">
          <Text
            testID={fieldId('time')}
            className="font-noto text-label text-muted"
          >
            {slot.startAt.slice(0, 5)}
          </Text>
          <Text className="font-noto text-label text-muted">·</Text>
          <Text
            testID={fieldId('band')}
            className="font-noto text-label text-muted"
          >
            {timeBandLabel(slot.startAt)}
          </Text>
          {slot.endsNextDay ? (
            <View
              testID={fieldId('endsnext')}
              className="rounded-pill bg-surface-soft px-sm py-[2px]"
            >
              <Text className="font-noto text-caption text-muted">
                {`익일 ${slot.endAt.slice(0, 5)}`}
              </Text>
            </View>
          ) : null}
        </View>

        {hasName ? (
          <Text
            testID={fieldId('name')}
            numberOfLines={1}
            className="font-noto-bold text-card-title font-bold text-ink"
          >
            {slot.nameKo}
          </Text>
        ) : null}

        <View className="flex-row flex-wrap items-center gap-xs">
          <Text
            testID={fieldId('hours')}
            className="font-noto text-label text-muted"
          >
            {slot.openingHours === null || slot.openingHours === undefined
              ? MISSING_HOURS
              : slot.openingHours}
          </Text>
          {firstTag === null ? null : (
            <>
              <Text className="font-noto text-label text-muted">·</Text>
              <Text
                testID={fieldId('tag')}
                className="font-noto text-label text-muted"
              >
                {`#${firstTag}`}
              </Text>
            </>
          )}
        </View>

        {slot.openingHoursKnown === false ? (
          <View
            testID={fieldId('warnchip')}
            className="self-start rounded-pill bg-primary-text px-sm py-[2px]"
          >
            <Text className="font-noto-bold text-micro font-bold text-on-primary">
              {WARN_CHIP}
            </Text>
          </View>
        ) : null}

        {hasCoord ? null : (
          <View
            testID={fieldId('nomap')}
            className="self-start rounded-pill bg-surface-soft px-sm py-[2px]"
          >
            <Text className="font-noto text-caption text-muted-soft">
              {NO_MAP_BADGE}
            </Text>
          </View>
        )}

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
  onSelectDay,
  onBack,
  status,
  confirmError,
  onConfirm,
  confirmLocked = false,
  onEdit,
}: TimelineScreenProps): ReactElement {
  const activeDate = days[activeDayIndex]?.date ?? '';
  // 확정 얼굴 트리거 — 미지정(undefined)은 PLANNED 취급이라 기존 호출부가 그대로 편집 얼굴이다.
  const isConfirmed = status === 'CONFIRMED';

  // 지도 상태. 탭한 핀의 슬롯(상세 시트)·지도 로드 실패 여부·확대 오버레이 열림을 이 화면이 쥔다.
  const [selectedSlot, setSelectedSlot] =
    useState<ItineraryDaysItemSlotsItem | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  // TRIP-354 Q5 — "지도 크게 보기"가 여는 화면 내 확대 오버레이(h26). 세그먼트 토글 대체(결정 D).
  const [expanded, setExpanded] = useState(false);

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

  // 핀 상세 시트는 확대 오버레이(h26) 안에서만 뜬다 — 실패 아니고 핀이 골라졌을 때.
  const showSheet = expanded && !mapFailed && selectedSlot !== null;

  // 날짜헤더 "이동 X" — 그날 leg 거리들을 파싱·합산한 일자 총합(Q2). **첫 슬롯 제외**(`slice(1)`) —
  // 첫 슬롯엔 직전 지점이 없어 그 `distanceRange` 는 leg 가 아니고, 구간행도 `index>0` 으로 억제하는
  // 바로 그 집합이다(모집단 일치 — 서버가 첫 슬롯에 값을 실어도 헤더가 부풀지 않는다). 구간행이
  // 문자열을 그대로 나르는 것과 **다른 값**이다. null 이면 헤더에 아무 것도 안 그린다("{N}곳"만).
  const legLabel = legDistance(
    slots.slice(1).map((slot) => slot.distanceRange)
  );

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
          {isConfirmed ? (
            // 우상단 공유 아이콘(라이브 h34 · Q3) — CONFIRMED 에서만. 정적 스텁이라 onPress 를 아예
            // 안 받아 press 가 무해하다(실동작은 후속 TRIP-300 · 02a ★11). 하단 [공유하기]와 같은 상태축.
            <>
              <View className="flex-1" />
              <Pressable
                testID="itinerary-view-share"
                accessibilityRole="button"
                accessibilityLabel="공유"
                hitSlop={8}
              >
                <ShareGlyph />
              </Pressable>
            </>
          ) : (
            // PLANNED(h25) 편집 진입 어포던스(TRIP-482) — 앱바 우측 직접 진입(리포에 메뉴 프리미티브가
            // 없어 kebab 메뉴를 발명하지 않는다 · 01b Q1). press → onEdit(페이지가 edit 라우트 push 를
            // 여기 배선). CONFIRMED(h34)엔 이 자리 대신 하단 비활성 [일정 수정] 버튼이 온다(status 게이트).
            <>
              <View className="flex-1" />
              <Pressable
                testID="itinerary-view-edit"
                accessibilityRole="button"
                accessibilityLabel="일정 편집"
                onPress={onEdit}
                hitSlop={8}
              >
                <PencilGlyph />
              </Pressable>
            </>
          )}
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

          {expanded ? (
            // h26 확대 오버레이(TRIP-354 Q5) — 세그먼트 토글 대신 "지도 크게 보기"가 여는 화면 내
            // 확대 지도. HEAD 의 h26 렌더(제스처 지도 + peekstrip + 핀시트 + 폴백)를 그대로 담는다.
            // "지도 크게 보기" press → `setExpanded(true)` 로 이 오버레이가 열리고, "닫기" 로 인라인
            // 글랜스로 복귀한다. 기본/오버레이 지도는 상호 배타(`map-root` 언제나 하나).
            <View testID="itinerary-map-expanded" className="w-full gap-md">
              {mapFailed ? (
                <MapFallback onRetry={handleRetry} />
              ) : (
                <View className="h-[360px] w-full overflow-hidden rounded-card border border-hairline bg-surface-soft">
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
              <Pressable
                testID="itinerary-map-collapse"
                accessibilityRole="button"
                onPress={() => setExpanded(false)}
                className="self-start rounded-pill border border-hairline-strong px-md py-sm"
              >
                <Text className="font-noto-bold text-label font-bold text-muted">
                  {MAP_COLLAPSE_LABEL}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* 기본: 작은 viewOnly 글랜스 지도 + "지도 크게 보기"(결정 D · 세그먼트 토글 대체).
                  제스처·핀탭은 확대 오버레이(h26) 몫이라 글랜스엔 안 붙인다(01b Q5). */}
              <View className="relative w-full">
                <View
                  testID="itinerary-view-map"
                  className="h-[170px] w-full overflow-hidden rounded-card border border-hairline bg-surface-soft"
                >
                  <KakaoMapView
                    key={activeDate}
                    center={mapCenter}
                    pins={pins}
                    viewOnly
                    maxLevel={EXPLORE_MAP_MAX_LEVEL}
                  />
                </View>
                <Pressable
                  testID="itinerary-map-expand"
                  accessibilityRole="button"
                  onPress={() => setExpanded(true)}
                  hitSlop={6}
                  className="absolute right-md top-md flex-row items-center gap-[4px] rounded-pill bg-canvas px-md py-sm"
                >
                  <ExpandGlyph size={14} />
                  <Text className="font-noto-bold text-micro font-bold text-ink">
                    {MAP_EXPAND_LABEL}
                  </Text>
                </Pressable>
              </View>

              {/* 시간표 카드 목록 — 지도 밑 단일 스크롤. 골격 카드는 이 사이클에서 풀카드로 올라가고
                  (구현자), 구간행·이동합계가 붙는다. */}
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
                  {legLabel === null ? null : (
                    <>
                      <Text className="font-noto text-label text-muted">·</Text>
                      <Text
                        testID="itinerary-timeline-dayhdr-distance"
                        className="font-noto text-label text-muted"
                      >
                        {legLabel}
                      </Text>
                    </>
                  )}
                </View>
                {slots.map((slot, index) => {
                  const slotKey = buildSlotKey(activeDate, slot.poiId);
                  const range = slot.distanceRange;
                  // 구간행은 첫 카드(index 0) 위엔 없고, distanceRange 가 있을 때만(빈 문자열 렌더 금지).
                  const connectorRange =
                    index > 0 &&
                    range !== null &&
                    range !== undefined &&
                    range !== ''
                      ? range
                      : null;
                  return (
                    <Fragment key={slotKey}>
                      {connectorRange === null ? null : (
                        <SlotConnector
                          slotKey={slotKey}
                          distanceRange={connectorRange}
                        />
                      )}
                      <TimelineSlotCard
                        slot={slot}
                        date={activeDate}
                        index={index}
                      />
                    </Fragment>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>

        <View className="w-full px-lg pb-lg pt-sm">
          {isConfirmed ? (
            // 배너·비활성 2버튼을 지운 자리의 슬림 안내 한 줄(TRIP-505) — 확정 이후 손댈 방법은
            // 재생성뿐이라는 새 정보만 남긴다(침묵 금지 · INV-4). 정적 텍스트라 콜백·press 없음.
            <View
              testID="itinerary-confirmed-note"
              className="w-full items-center rounded-button bg-surface-soft px-md py-sm"
            >
              <Text className="font-noto text-label text-muted">
                {CONFIRMED_NOTE}
              </Text>
            </View>
          ) : (
            <View className="w-full gap-sm">
              {confirmLocked ? (
                <View
                  testID="itinerary-confirm-locked-notice"
                  className="w-full flex-row items-center gap-sm rounded-button bg-surface-soft px-md py-sm"
                >
                  <LockGlyph size={16} tone="muted" />
                  <Text className="flex-1 font-noto text-label text-muted">
                    {CONFIRM_LOCKED_NOTE}
                  </Text>
                </View>
              ) : null}
              {/* 잠금 시 실제 `disabled` — accessibilityState 만 켜면 press 가 살아 있어 확정 요청이
                  나간다(02a M1·M2). disabled 는 responder 를 떼 눌러도 onConfirm 이 안 불린다. */}
              <Pressable
                testID="itinerary-confirm-cta"
                accessibilityRole="button"
                disabled={confirmLocked}
                onPress={onConfirm}
                className={`h-12 w-full items-center justify-center rounded-button ${
                  confirmLocked ? 'bg-hairline-strong' : 'bg-primary'
                }`}
              >
                <Text
                  className={`font-noto-bold text-[16px] font-bold ${
                    confirmLocked ? 'text-muted-soft' : 'text-on-primary'
                  }`}
                >
                  {CONFIRM_LABEL}
                </Text>
              </Pressable>
            </View>
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
