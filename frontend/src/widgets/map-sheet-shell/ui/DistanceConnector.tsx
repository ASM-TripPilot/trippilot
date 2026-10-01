import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { CarGlyph, WalkGlyph } from './MapSheetGlyphs';

/**
 * TRIP-783 · 카드 사이 거리 커넥터(widgets · presentation-only). 서버 `distanceRange` 문자열을 **가공
 * 없이 그대로** 나른다(BR-U3-08, INV-3 — 소요시간 필드 없음, 거리만). TRIP-1054: 값이 없으면
 * (null·빈 문자열) 글리프만 남기고 문구 칸을 그리지 않으며(QA #038 — 편집 일정은 값이 영원히 없어
 * "계산 중"은 거짓 신호), `약 0.0km` 로 시작하면 `바로 옆`으로 바꾼다(QA #035). 이동수단 글리프는
 * `자가용` 포함 여부로 고른다(AI 수단 어휘 도보·대중교통·자가용 — TRIP-1076. 대중교통 글리프는 Figma
 * 선행 전까지 보류라 도보 글리프. 선 모양·색은 jest 사각 · 6-b 육안). 점선·[길찾기] 는 신
 * 설계에서 제거 — 그리지 않는다(구 `SlotConnector` 스텁 폐기).
 */

const ZERO_DISTANCE_LABEL = '바로 옆';

/** 서버 거리 문자열이 0km(같은 좌표 추정)인가 — 접두 `약 0.0km` 만 본다(정규화 없음). */
export function isZeroDistance(distanceRange: string): boolean {
  return distanceRange.startsWith('약 0.0km');
}

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
  const isCar = hasDistance && distanceRange.includes('자가용');

  return (
    <View
      testID={`sheet-connector-${slotKey}`}
      className="flex-row items-center gap-[6px] pl-md"
    >
      {isCar ? <CarGlyph /> : <WalkGlyph />}
      {hasDistance ? (
        <Text
          testID={`sheet-connector-distance-${slotKey}`}
          className="font-noto text-label text-muted"
        >
          {isZeroDistance(distanceRange) ? ZERO_DISTANCE_LABEL : distanceRange}
        </Text>
      ) : null}
    </View>
  );
}
