import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { RefreshGlyph, WarningTriangleGlyph } from './ItineraryGlyphs';

/**
 * TRIP-301 · 지도 실패 폴백(h31) — 지도를 못 불러온 자리에 실패 박스 + 재시도를 그린다.
 * **화면을 비우지 않는다**: 밑에는 통일 POI 카드 세로 목록이 그대로 남아(부모가 그림) 침묵
 * 실패를 막는다(INV-4). 재시도는 부모가 지도를 key remount 로 다시 로드한다(D7).
 *
 * 문구는 비어 있지 않다(침묵 금지) — 왜 실패했고 무엇을 할 수 있는지 말한다.
 */

const FALLBACK_TITLE = '지도를 불러올 수 없어요';
const FALLBACK_NOTE = '일정은 아래 목록에서 볼 수 있어요';
const RETRY_LABEL = '다시 시도';

export interface MapFallbackProps {
  onRetry: () => void;
}

export function MapFallback({ onRetry }: MapFallbackProps): ReactElement {
  return (
    <View
      testID="itinerary-map-fallback"
      className="w-full items-center gap-sm rounded-card border border-hairline bg-surface-soft px-lg py-xl"
    >
      <WarningTriangleGlyph size={28} />
      <Text className="font-noto-bold text-card-title font-bold text-ink">
        {FALLBACK_TITLE}
      </Text>
      <Text className="font-noto text-caption text-muted">{FALLBACK_NOTE}</Text>
      <Pressable
        testID="itinerary-map-retry"
        accessibilityRole="button"
        onPress={onRetry}
        hitSlop={8}
        className="mt-xs flex-row items-center gap-xs rounded-pill border border-hairline-strong px-md py-sm"
      >
        <RefreshGlyph size={18} />
        <Text className="font-noto-bold text-label font-bold text-muted">
          {RETRY_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}
