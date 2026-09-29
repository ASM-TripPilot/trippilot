import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { UnplacedMustVisitRow } from '../model/unplacedMustVisits';
import { AlertCircleGlyph } from './ItineraryGlyphs';

/**
 * TRIP-1094 · h08 초안·h14/h16 완성 일정 시트 맨 위의 "일정에 넣지 못한 꼭 갈 곳" 블록. Figma 전용
 * 프레임이 없어 `DraftFallbackBanner` 일부 실패 한 줄(컨테이너·아이콘) + 폴백 카드 두 줄(이름·보조 문구)로
 * 합성했다.
 *
 * 순수 표시(훅·조회·라우터 0) — 두 페이지가 공유하고 프리뷰가 네트워크 계층 없이 가져다 쓴다. 누를 것이
 * 없다(제안 버튼은 후속 · 결정 2). 0건이면 아무것도 안 그린다(빈 배열 = 전부 배치됨).
 */

/** 정본 카피 없음 — 이 파일이 소유하는 제목(사유 문장 아님 · Seed Q2). */
const TITLE = '일정에 넣지 못한 꼭 갈 곳';

export function UnplacedMustVisitNotice({
  rows,
}: {
  rows: UnplacedMustVisitRow[];
}): ReactElement | null {
  if (rows.length === 0) return null;

  return (
    <View
      testID="itinerary-unplaced-mustvisit"
      className="w-full flex-row items-start gap-sm rounded-button border border-hairline bg-surface-soft px-md py-md"
    >
      <AlertCircleGlyph />
      <View className="flex-1 gap-md">
        <Text className="font-noto text-label text-body">{TITLE}</Text>
        {rows.map((row, index) => (
          <View
            // 서버가 같은 poiId 를 두 번 보낼 일은 사실상 없지만(BR-U1-50) key 충돌 경고는 막는다.
            key={`${row.poiId}-${index}`}
            testID={`itinerary-unplaced-mustvisit-${row.poiId}`}
            className="items-start gap-[6px]"
          >
            {row.name === null ? null : (
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                {row.name}
              </Text>
            )}
            <Text className="font-noto text-label text-muted">
              {row.message}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
