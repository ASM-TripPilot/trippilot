import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { InfoCircleGlyph } from '@/shared/ui/glyphs';

/**
 * TRIP-799 · h14 거점 없음 안내 카드(D4) — 선택일에 고정 숙소 슬롯도, 그날을 덮는 거점 배정도 없을 때(TRIP-1704)
 * 시트 children 말미에 뜨는 hairline 카드.
 *
 * TRIP-1428 · Figma 의 "동선 기준 추천 보기 ›" 링크는 숨긴다 — h15 숙소 추천(US-SCHED-11)이 서버에 배선되지
 * 않아 눌러도 안 되는 화면으로 갔다(INV-4). 배선 칸이 서면 링크를 되살린다(git 이력 참고). 안내 줄은 남긴다(BR-U1-40).
 *
 * TRIP-1756 · `unknown` 이면 같은 틀에서 "없다"가 아니라 "확인하지 못했다"로 말한다(거점 조회 실패 — 없다고 단정하면
 * 거짓이다, INV-4). 다시 시도는 `onRetry` 로만 받는다 — 이 파일에 훅·`@/shared/api` 를 들이면 프리뷰 지뢰가 터진다.
 *
 * 순수 프레젠테이션(useState·조회·라우터 0). 카피는 정본 부재라 이 파일이 소유하는 발명 상수다(config 상수, 01b D4).
 * 별 파일로 둔 이유: 컨테이너(`ItineraryPlanPage`)와 한 파일에 있으면 프리뷰가 그 컨테이너의 `@/shared/api`
 * import 사슬을 전이 로드해 프리뷰 스모크(`devPreviewReleaseGate`) 지뢰 목이 터진다(repo-traps 작업 관례).
 */

/** 발명 display copy(정본 부재, 01b D4) — Figma h14 거점없음 프레임 문구. */
const NO_BASE_TITLE = '거점 숙소가 없어요';
const BASE_UNKNOWN_TITLE = '거점 숙소를 확인하지 못했어요';

export function NoBaseNoticeCard({
  unknown = false,
  onRetry,
}: {
  unknown?: boolean;
  onRetry?: () => void;
}): ReactElement {
  return (
    <View
      testID={
        unknown ? 'itinerary-plan-base-unknown' : 'itinerary-plan-no-base'
      }
      className="flex-row items-center gap-xs rounded-card border border-hairline bg-canvas px-md py-sm"
    >
      <InfoCircleGlyph size={16} />
      <Text className="shrink font-noto text-label text-muted">
        {unknown ? BASE_UNKNOWN_TITLE : NO_BASE_TITLE}
      </Text>
      {unknown && onRetry ? (
        <Pressable
          testID="itinerary-plan-base-unknown-retry"
          accessibilityRole="button"
          onPress={onRetry}
          className="ml-auto"
        >
          <Text className="font-noto-bold text-label font-bold text-primary">
            다시 시도
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
