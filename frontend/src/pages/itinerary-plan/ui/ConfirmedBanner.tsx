import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { CheckGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';

/**
 * TRIP-801 · h16 확정 성공 배너(D3·AC-1) — 지도 위 일차 칩 **아래에** 얹는 카드(셸 `mapCard` 슬롯).
 * 일정이 확정됐음을 알린다. 순수 프레젠테이션(useState·조회·라우터·api import 0 — NoBaseNoticeCard
 * 선례)이라 페이지·프리뷰가 노드로 주입한다. 카피는 정본 부재라 이 파일이 소유하는 발명 상수.
 *
 * 색은 브랜드 계열(primary-pale 배경 + primary-text 잉크 + 같은 잉크의 CheckGlyph) — 확정 실패
 * 안내(`itinerary-confirm-error`)와 같은 톤이라 화면에서 한 벌로 읽힌다. raw hex 없이 토큰만 쓴다.
 */
const CONFIRMED_BANNER_TEXT = '일정이 확정됐어요';

export function ConfirmedBanner(): ReactElement {
  return (
    <View
      testID="itinerary-confirmed-banner"
      className="flex-row items-center gap-xs self-start rounded-card border border-hairline bg-primary-pale px-md py-sm"
    >
      <CheckGlyph size={16} />
      <Text className="font-noto-bold text-label font-bold text-primary-text">
        {CONFIRMED_BANNER_TEXT}
      </Text>
    </View>
  );
}
