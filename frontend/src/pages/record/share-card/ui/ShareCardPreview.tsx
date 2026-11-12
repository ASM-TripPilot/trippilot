import type { ReactElement, Ref } from 'react';
import { Text, View } from 'react-native';

import {
  formatShareCardStats,
  MAGAZINE_TONES,
  SHARE_FORMATS,
  type MagazinePicture,
  type ShareCardVM,
} from '@/features/reflection/index.view';
import { PlacePhoto } from '@/shared/ui/PlacePhoto';
import { SHARE_ROUTE_LIMIT } from '../model/shareStory';
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
 * TRIP-1016: 1:1·4:5 는 폭(가용 폭 100%)이 크기를 정하고, 9:16 만 높이 530 상한으로 묶는다 —
 * 530 고정 + 비율이면 1:1·4:5 폭이 화면을 넘는다(캡처가 곧 이 프레임이라 넘친 이미지가 된다, BR-U5-46).
 *
 * TRIP-1781: 표지 사진(`picture`)이 있으면 프레임 전체 배경 + 스크림 + 사진 위 글자색. 이 프레임이 곧 저장·공유 PNG 라
 * 움직이는 연출 부품(켄번스 등)을 import 하지 않고 정지 `PlacePhoto` 로 그린다 — 중간 프레임이 PNG 에 박히지 않게(`photoUploadGuard` AC-13).
 * 사진 크롭·글자 대비는 Figma 확인 전 가정이다.
 */

const STORY_MAX_HEIGHT = 530;

export interface ShareCardPreviewProps {
  card: ShareCardVM;
  aspectRatio: number;
  /** TRIP-1071 캡처 대상 — 프레임 View 자체에 단다(래퍼에 달면 테두리·비율이 다른 이미지가 떠진다). */
  frameRef?: Ref<View>;
  /** 표지 사진 — 없으면(null·생략) 라이트 카드. */
  picture?: MagazinePicture | null;
}

export function ShareCardPreview({
  card,
  aspectRatio,
  frameRef,
  picture = null,
}: ShareCardPreviewProps): ReactElement {
  const statsText = formatShareCardStats(card.statsCells, card.mode);
  const frameStyle =
    aspectRatio === SHARE_FORMATS[0].aspectRatio
      ? { aspectRatio, height: STORY_MAX_HEIGHT }
      : { aspectRatio, width: '100%' as const };
  // 사진 위에서만 글자색을 덮는다(style 이 className 색을 이긴다) — 없으면 undefined 라 기존 색 그대로.
  const onPhoto = picture ? { color: MAGAZINE_TONES.onPhoto } : undefined;
  const captionLine = [card.regionText, card.periodText]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View
      ref={frameRef}
      testID="reflection-share-preview-frame"
      style={frameStyle}
      className="self-center overflow-hidden rounded-card border border-hairline bg-canvas"
    >
      {picture ? (
        <>
          {/* eslint-disable-next-line no-restricted-syntax -- 기기 사진(공유 카드) — 관광공사 POI 사진 아님 */}
          <PlacePhoto
            testID="reflection-share-preview-photo"
            imageUrl={picture.uri}
            category={picture.category}
            poiId={picture.poiId}
            className="absolute inset-0 h-full w-full"
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <View
            testID="reflection-share-preview-scrim"
            className="absolute inset-0 bg-scrim/45"
          />
        </>
      ) : null}

      {/* 워터마크(좌상단, ink) */}
      <View className="flex-row items-center gap-sm px-lg pt-lg">
        <WatermarkLogoGlyph size={22} />
        <Text
          className="font-inter-bold text-card-title text-ink"
          style={onPhoto}
        >
          {card.watermark}
        </Text>
      </View>

      {/* 지도 자리 — 좌표 계약 공백이라 가짜 지도 대신 placeholder(muted 박스)에 방문 순서를 얹는다.
          방문 0곳이면 빈 회색 박스를 그리지 않고 자리만 비운다(TRIP-1016 D10). */}
      {card.orderedVisits.length > 0 ? (
        <View
          testID="reflection-share-visit-order"
          className="mx-lg mt-md flex-1 justify-center gap-sm rounded-card bg-surface-soft p-md"
        >
          {card.orderedVisits.slice(0, SHARE_ROUTE_LIMIT).map((visit) => (
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
      ) : (
        <View className="flex-1" />
      )}

      {/* 하단 텍스트 — 지역·기간 / 제목 / 코랄 밑줄 / 통계(얼굴별 포매터) */}
      <View className="gap-[6px] px-lg pb-lg pt-md">
        {captionLine ? (
          <Text className="font-noto text-caption text-muted" style={onPhoto}>
            {captionLine}
          </Text>
        ) : null}
        {card.title ? (
          <Text
            className="font-noto-bold text-[30px] text-ink"
            style={onPhoto}
            numberOfLines={2}
          >
            {card.title}
          </Text>
        ) : null}
        <View className="h-[3px] w-[42px] rounded-[2px] bg-primary" />
        <Text className="font-noto text-label text-ink" style={onPhoto}>
          {statsText}
        </Text>
      </View>
    </View>
  );
}
