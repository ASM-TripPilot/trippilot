import type { ReactElement } from 'react';
import { Image, Text, View } from 'react-native';

import type { ItineraryDaysItemSlotsItem } from '@/shared/api/generated/schemas';

import { buildSlotKey } from '../model/slotKey';

/**
 * TRIP-301 · 통일 POI 슬롯 카드 — 지도 밑 peekstrip(가로)과 지도 실패 폴백 목록(세로)
 * **두 곳이 이 컴포넌트 하나를 쓴다**(D8 · AC-9). 같은 slotKey 접두(`itinerary-poi-card-`)로
 * 두 표면이 같은 값을 그린다.
 *
 * ⚠️ 시간표 세그먼트 카드(`itinerary-timeline-slot-*`)와는 **다른 계열**이다 — 그 카드는 이
 * 사이클에서 안 건드린다(TRIP-354 소관). 접두가 달라 TRIP-299 카드 카운터에 안 섞인다.
 *
 * 표면 = 사진·번호·장소명·시각·분류·영업시간·거리. 안 그리는 것: tags·길찾기·휴관칩(D9).
 * 각 하위 필드는 **값 하나만 담는 leaf** 여야 한다 — 화면 테스트가 `toHaveTextContent(문자열)`
 * (정규화 후 완전 일치)로 읽기 때문이다. 그래서 시각은 분류 leaf 와 **다른 Text** 로 뗀다.
 *
 * 반쪽 계약(null 이 정상 경로):
 *  - `openingHours` null → 빈칸이 아니라 "미확인"(AC-4).
 *  - `distanceRange` null → 거리 줄 **부재**(AC-5, INV-3 파생 금지 — 문자열은 가공 없이 그대로).
 *  - 좌표 null → 핀은 못 찍어도 카드는 목록에 남고 "지도 미표시" 배지를 단다(AC-2 · INV-4).
 */

const MISSING_HOURS = '미확인';
const NO_MAP_BADGE = '위치 정보 없음 · 지도 미표시';

// 카드 그림자(TimelineSlotCard 와 동일한 Figma 값). RN 은 box-shadow 가 없어 스타일로 옮긴다.
// `#000000` 은 raw-hex 가드의 토큰 색 목록(브랜드 팔레트)에 없어 그림자 색으로 정당하다.
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 2,
} as const;

/** peekstrip(가로 스크롤 한 장)과 폴백 목록(세로 한 행)의 두 레이아웃. testID·표면은 같다. */
export type PoiSlotCardVariant = 'peek' | 'list';

export interface PoiSlotCardProps {
  slot: ItineraryDaysItemSlotsItem;
  /** slotKey 조립용 활성 날짜(페이지가 고른 날). */
  date: string;
  /** 이 날 안에서의 순번 — 번호 배지(1..n 연속). 지도 핀 번호와 같은 값이다(좌표 결번은 핀만 뛴다). */
  index: number;
  variant: PoiSlotCardVariant;
}

export function PoiSlotCard({
  slot,
  date,
  index,
  variant,
}: PoiSlotCardProps): ReactElement {
  const slotKey = buildSlotKey(date, slot.poiId);
  const hasCoord = typeof slot.lat === 'number' && typeof slot.lng === 'number';
  const fieldId = (role: string): string =>
    `itinerary-poi-card-${role}-${slotKey}`;

  const badge = (
    <View className="h-[24px] w-[24px] items-center justify-center rounded-[8px] bg-primary">
      <Text className="font-inter-bold text-caption font-bold text-on-primary">
        {String(index + 1)}
      </Text>
    </View>
  );

  const photo = (imageClass: string): ReactElement =>
    slot.imageUrl === null || slot.imageUrl === undefined ? (
      <View className={`${imageClass} bg-surface-soft`} />
    ) : (
      <Image
        testID={fieldId('image')}
        source={{ uri: slot.imageUrl }}
        resizeMode="cover"
        className={imageClass}
      />
    );

  // 텍스트 블록 — 두 변형이 공유한다. 각 leaf 는 자기 값 하나만 담는다(완전 일치 계약).
  const textBlock = (
    <View className="flex-1 gap-[3px]">
      {slot.nameKo === null || slot.nameKo === undefined ? null : (
        <Text
          testID={fieldId('name')}
          numberOfLines={1}
          className="font-noto-bold text-card-title font-bold text-ink"
        >
          {slot.nameKo}
        </Text>
      )}

      <View className="flex-row flex-wrap items-center gap-xs">
        <Text className="font-noto text-caption text-muted">
          {slot.startAt.slice(0, 5)}
        </Text>
        {slot.category === null || slot.category === undefined ? null : (
          <>
            <Text className="font-noto text-caption text-muted">·</Text>
            <Text
              testID={fieldId('category')}
              className="font-noto text-caption text-muted"
            >
              {slot.category}
            </Text>
          </>
        )}
      </View>

      <Text
        testID={fieldId('hours')}
        className="font-noto text-caption text-muted"
      >
        {slot.openingHours === null || slot.openingHours === undefined
          ? MISSING_HOURS
          : slot.openingHours}
      </Text>

      {slot.distanceRange === null ||
      slot.distanceRange === undefined ||
      slot.distanceRange === '' ? null : (
        <Text
          testID={fieldId('distance')}
          className="font-noto text-caption text-muted"
        >
          {slot.distanceRange}
        </Text>
      )}

      {hasCoord ? null : (
        <View
          testID={fieldId('nomap')}
          className="mt-[2px] self-start rounded-pill bg-surface-soft px-sm py-[2px]"
        >
          <Text className="font-noto text-caption text-muted-soft">
            {NO_MAP_BADGE}
          </Text>
        </View>
      )}
    </View>
  );

  if (variant === 'peek') {
    return (
      <View
        testID={`itinerary-poi-card-${slotKey}`}
        style={cardShadow}
        className="w-[210px] gap-sm rounded-card border border-hairline bg-canvas p-sm"
      >
        <View className="w-full overflow-hidden rounded-[10px]">
          {photo('h-[110px] w-full')}
          <View className="absolute left-sm top-sm">{badge}</View>
        </View>
        {textBlock}
      </View>
    );
  }

  return (
    <View
      testID={`itinerary-poi-card-${slotKey}`}
      style={cardShadow}
      className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas p-md"
    >
      {badge}
      <View className="overflow-hidden rounded-[10px]">
        {photo('h-[56px] w-[56px]')}
      </View>
      {textBlock}
    </View>
  );
}
