import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapPinOffGlyph, RetryGlyph } from './MapSheetGlyphs';

/**
 * TRIP-919 · 지도 폴백 바(widgets · presentation-only) — Figma h14 `4286:2123` `mapfallback`.
 * 셸이 지도 실패를 감지하면 지도 자리에 기본으로 얹는다. 재시도 상태는 셸이 쥐고 이 바는 `onRetry`
 * 를 부르기만 한다. 블록은 day-chip 줄 바로 아래(노치 아래 + 칩 높이)에 가운데 정렬로 둔다.
 * 반경 8 은 코드 토큰이 없어 임의값이다(01b Q2 — 킷 §3 반경 동기화 대기).
 */
export function MapFallbackBar({
  onRetry,
}: {
  onRetry: () => void;
}): ReactElement {
  return (
    <View testID="map-sheet-fallback" className="flex-1 bg-canvas-alt">
      <SafeAreaView edges={['top']} className="items-center gap-sm pt-[46px]">
        <View className="flex-row items-center gap-sm">
          <View className="h-2xl w-2xl items-center justify-center rounded-pill bg-surface-strong">
            <MapPinOffGlyph />
          </View>
          <Text className="font-noto text-caption text-body">
            지도를 불러올 수 없어요 · 일정은 아래 목록에서 볼 수 있어요
          </Text>
        </View>
        <Pressable
          testID="map-sheet-fallback-retry"
          accessibilityRole="button"
          onPress={onRetry}
          className="flex-row items-center gap-[6px] rounded-[8px] border border-hairline-strong bg-canvas px-lg py-sm"
        >
          <RetryGlyph />
          <Text className="font-noto-bold text-label font-bold text-ink">
            다시 시도
          </Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}
