import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

import { formatShareCardStats, type ShareCardVM } from '../model/shareCard';
import { WatermarkLogoGlyph } from './ShareCardGlyphs';

/**
 * TRIP-574 · j06 카드 프리뷰 — 온디바이스 렌더 카드의 표면(캡처 대상 View).
 * TRIP-766: 다크 골격 폐기 → 라이트 카드(ink 텍스트·로고 배지). 통계 라인은 얼굴별 포매터로.
 *
 * ★ 지도 degrade(INV-4): 라이브 지도를 넣지 않는다 — TripSummary/DayHighlight 계약에 좌표가 없어
 *   애초에 못 그린다(맹점④). 가짜 지도 대신 placeholder(muted 박스) 위에 방문 순서를 얹어 정직하게
 *   접는다. raster 정적 지도·좌표는 TRIP-634 후속. 픽셀 충실도는 [검증] 6-b 스크린샷 대조 전용.
 *
 * 종횡비 프레임(reflection-share-preview-frame)은 인라인 `style={{ aspectRatio }}` 로 노출한다 —
 * 화면이 선택 포맷의 aspectRatio 를 넘겨 9:16→1:1→4:5 전환이 관측된다(className 만으론 jest 가 못 읽음).
 * 높이 530 고정 + aspectRatio → 폭이 비율로 정해진다(feed 4:5 폭 초과는 6-b 실측 몫).
 */

export interface ShareCardPreviewProps {
  card: ShareCardVM;
  aspectRatio: number;
}

export function ShareCardPreview({
  card,
  aspectRatio,
}: ShareCardPreviewProps): ReactElement {
  const statsText = formatShareCardStats(card.statsCells, card.mode);
  const captionLine = [card.regionText, card.periodText]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View
      testID="reflection-share-preview-frame"
      style={{ aspectRatio, height: 530 }}
      className="self-center overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      {/* 워터마크(좌상단, ink) */}
      <View className="flex-row items-center gap-sm px-lg pt-lg">
        <WatermarkLogoGlyph size={22} />
        <Text className="font-inter-bold text-card-title text-ink">
          {card.watermark}
        </Text>
      </View>

      {/* 지도 자리 — 좌표 계약 공백이라 가짜 지도 대신 placeholder(muted 박스)에 방문 순서를 얹는다. */}
      <View className="mx-lg mt-md flex-1 justify-center gap-sm rounded-card bg-surface-soft p-md">
        {card.orderedVisits.slice(0, 6).map((visit) => (
          <View key={visit.order} className="flex-row items-center gap-sm">
            <View className="h-[22px] w-[22px] items-center justify-center rounded-full bg-primary">
              <Text className="font-inter-bold text-caption text-on-primary">
                {visit.order}
              </Text>
            </View>
            <Text className="text-label text-muted">{visit.dayLabel}</Text>
            <Text
              className="flex-1 font-noto text-body text-ink"
              numberOfLines={1}
            >
              {visit.place}
            </Text>
          </View>
        ))}
      </View>

      {/* 하단 텍스트 — 지역·기간 / 제목 / 코랄 밑줄 / 통계(얼굴별 포매터) */}
      <View className="gap-[6px] px-lg pb-lg pt-md">
        {captionLine ? (
          <Text className="font-noto text-caption text-muted">
            {captionLine}
          </Text>
        ) : null}
        {card.title ? (
          <Text
            className="font-noto-bold text-[30px] text-ink"
            numberOfLines={2}
          >
            {card.title}
          </Text>
        ) : null}
        <View className="h-[3px] w-[42px] rounded-[2px] bg-primary" />
        <Text className="font-noto text-label text-ink">{statsText}</Text>
      </View>
    </View>
  );
}
