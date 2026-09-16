import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { CarGlyph, WalkGlyph } from './MapSheetGlyphs';

/**
 * TRIP-783 · 카드 사이 거리 커넥터(widgets · presentation-only). 서버 `distanceRange` 문자열을 **가공
 * 없이 그대로** 나르고(BR-U3-08), null·빈 문자열이면 "이동 거리 계산 중"을 그린다(INV-3 — 소요시간
 * 필드 없음, 거리만). 이동수단 글리프는 `차량` 포함 여부로 고른다(SVG stroke/fill 이라 jest 원리적
 * 사각 · 6-b 육안). 점선·[길찾기] 는 신 설계에서 제거 — 그리지 않는다(구 `SlotConnector` 스텁 폐기).
 */

const DISTANCE_PENDING = '이동 거리 계산 중';

export interface DistanceConnectorProps {
  slotKey: string;
  distanceRange?: string | null;
}

export function DistanceConnector({
  slotKey,
  distanceRange,
}: DistanceConnectorProps): ReactElement {
  const hasDistance =
    distanceRange !== null &&
    distanceRange !== undefined &&
    distanceRange !== '';
  const isCar = hasDistance && distanceRange.includes('차량');

  return (
    <View
      testID={`sheet-connector-${slotKey}`}
      className="flex-row items-center gap-[6px] pl-md"
    >
      {isCar ? <CarGlyph /> : <WalkGlyph />}
      <Text
        testID={`sheet-connector-distance-${slotKey}`}
        className="font-noto text-label text-muted"
      >
        {hasDistance ? distanceRange : DISTANCE_PENDING}
      </Text>
    </View>
  );
}
