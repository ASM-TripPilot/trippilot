import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  ChevronRightGlyph,
  InfoCircleGlyph,
} from '@/features/itinerary/ui/ItineraryGlyphs';

/**
 * TRIP-799 · h14 거점 없음 안내 카드(D4) — 선택일에 고정 숙소 슬롯이 없을 때 시트 children 말미에
 * 뜨는 hairline 카드. 링크를 누르면 h15("동선 기준 추천")로 항법한다.
 *
 * 순수 프레젠테이션(useState·조회·라우터 0) — 항법은 `onPress` 콜백으로 소비처(페이지·프리뷰)가
 * 진다. 카피는 정본 부재라 이 파일이 소유하는 발명 상수다(config 상수, 01b D4). 별 파일로 둔
 * 이유: 컨테이너(`ItineraryPlanPage`)와 한 파일에 있으면 프리뷰가 그 컨테이너의 `@/shared/api`
 * import 사슬을 전이 로드해 `devPreviewBandNav` 지뢰 목이 터진다(repo-traps 작업 관례).
 */

/** 발명 display copy(정본 부재, 01b D4) — Figma h14 거점없음 프레임 문구. */
const NO_BASE_TITLE = '거점 숙소가 없어요';
const NO_BASE_LINK = '동선 기준 추천 보기';

export function NoBaseNoticeCard({
  onPress,
}: {
  onPress: () => void;
}): ReactElement {
  return (
    <View
      testID="itinerary-plan-no-base"
      className="flex-row items-center justify-between gap-sm rounded-card border border-hairline bg-canvas px-md py-sm"
    >
      <View className="flex-1 flex-row items-center gap-xs">
        <InfoCircleGlyph size={16} tone="muted" />
        <Text className="font-noto text-label text-muted">{NO_BASE_TITLE}</Text>
      </View>
      <Pressable
        testID="itinerary-plan-no-base-link"
        onPress={onPress}
        className="flex-row items-center gap-[2px]"
      >
        <Text className="font-noto-bold text-label font-bold text-primary-text">
          {NO_BASE_LINK}
        </Text>
        <ChevronRightGlyph size={16} />
      </Pressable>
    </View>
  );
}
