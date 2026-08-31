import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { ShareCardVM } from '../model/shareCard';
import { WatermarkLogoGlyph } from './ShareCardGlyphs';

/**
 * TRIP-574 · j06 카드 프리뷰 — 온디바이스 렌더 카드의 표면(캡처 대상 View).
 *
 * ★ 지도 degrade: 라이브 KakaoMapView(WebView)를 넣지 않는다 — (1) view-shot 은 WebView 콘텐츠를
 *   못 캡처하고(맹점①) (2) TripSummary/DayHighlight 계약에 좌표가 없어 애초에 못 그린다(맹점④).
 *   그래서 카드는 지도 없이 워터마크·동선 순서 목록·하단 그라디언트 텍스트 오버레이(지역·기간·제목·
 *   통계)로 조립한다. 픽셀 충실도(그라디언트·정렬·핀 좌표)는 [검증] 6-b 스크린샷 대조 전용.
 *
 * 종횡비 프레임(reflection-share-preview-frame)은 인라인 `style={{ aspectRatio }}` 로 노출한다 —
 * 화면이 선택 포맷의 aspectRatio 를 넘겨 9:16→1:1→4:5 전환이 관측된다(className 만으론 jest 가 못 읽음).
 */

export interface ShareCardPreviewProps {
  card: ShareCardVM;
  aspectRatio: number;
}

export function ShareCardPreview({
  card,
  aspectRatio,
}: ShareCardPreviewProps): ReactElement {
  const statsText = `방문 ${card.statsCells.totalVisits} · 이동 ${card.statsCells.distanceText} · 사진 ${card.statsCells.totalPhotos}`;
  const captionLine = [card.regionText, card.periodText]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View
      testID="reflection-share-preview-frame"
      style={{ aspectRatio }}
      className="w-full overflow-hidden rounded-card bg-ink"
    >
      <LinearGradient
        colors={['rgba(38,42,51,1)', 'rgba(17,18,22,1)']}
        style={{ flex: 1 }}
      >
        <View className="flex-1 p-lg">
          {/* 워터마크(좌상단) */}
          <View className="flex-row items-center gap-sm">
            <WatermarkLogoGlyph size={22} />
            <Text className="font-inter-bold text-card-title text-on-primary">
              {card.watermark}
            </Text>
          </View>

          {/* 동선 순서 목록 — 지도 대신 방문 순서를 번호로 보여준다(계약 공백 degrade). */}
          <View className="mt-lg flex-1 gap-sm">
            {card.orderedVisits.slice(0, 6).map((visit) => (
              <View key={visit.order} className="flex-row items-center gap-sm">
                <View className="h-[22px] w-[22px] items-center justify-center rounded-full bg-primary">
                  <Text className="font-inter-bold text-caption text-on-primary">
                    {visit.order}
                  </Text>
                </View>
                <Text className="text-label text-on-primary opacity-80">
                  {visit.dayLabel}
                </Text>
                <Text
                  className="flex-1 font-noto text-body text-on-primary"
                  numberOfLines={1}
                >
                  {visit.place}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* 하단 그라디언트 + 텍스트 오버레이(지역·기간·제목·코랄 밑줄·통계) */}
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.82)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
        >
          <View className="gap-[6px] px-lg pb-lg pt-3xl">
            {captionLine ? (
              <Text className="font-noto text-caption text-on-primary opacity-85">
                {captionLine}
              </Text>
            ) : null}
            {card.title ? (
              <Text
                className="font-noto-bold text-[30px] text-on-primary"
                numberOfLines={2}
              >
                {card.title}
              </Text>
            ) : null}
            <View className="h-[3px] w-[42px] rounded-[2px] bg-primary" />
            <Text className="font-noto text-label text-on-primary opacity-95">
              {statsText}
            </Text>
          </View>
        </LinearGradient>
      </LinearGradient>
    </View>
  );
}
