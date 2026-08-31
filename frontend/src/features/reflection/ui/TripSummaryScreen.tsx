import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KakaoMapView, type MapCenter, type MapPin } from '@/shared/map';

import { BackArrowGlyph, LocationOffGlyph } from './ReflectionGlyphs';
import { DayHighlightCard } from './DayHighlightCard';
import type { SummaryStatCells } from '../model/summaryStats';
import type { OrderedVisit } from '../model/summaryView';

/**
 * TRIP-572 · j04 여행 요약 화면(순수 프레젠테이션 — VM·콜백 주입, 조회/조립 0).
 * 조회·조립(summaryStats·resolveSummaryView·toOrderedVisitList·shareEnabled·daySubtitle)은
 * `pages/trip-summary` 가 진다(이 파일은 `@/shared/*` 만 import — 프리뷰 격리 렌더 안전, FSD 경계).
 * 화면은 완성된 셀·VM 을 받아 그릴 뿐 `ready`·`hasLocationData`·거리 대시를 자체 해석하지 않는다
 * (571 DailyReflectionScreen 동형 — 화면이 폴백을 발명하면 심판 사각이 생긴다는 571 교훈).
 *
 * 무엇을 보장하나(승인 계약):
 *  - AC-1(정상 MAP): stats 3셀 + 지도 히어로(map-root) + 날짜카드 ≥1.
 *  - AC-2(BR-U5-39): view VISIT_LIST → 지도 노드 부재 + 순서 방문 목록 + 거리 셀 "—"(정직 degrade).
 *  - AC-3(BR-U5-43): distanceSource 라벨(근사/경로)이 거리 셀에 표기된다(거리 미측정이면 라벨 숨김).
 *  - AC-5(BR-U5-48): shareEnabled:false → 공유 버튼 비활성 + press 콜백 0회(종료·요약 전 공유 불가).
 *
 * 지도는 `shared/map/KakaoMapView`(viewOnly 글랜스, `itineraryMapSurfaceStructure` 옵트인 등재) —
 * 실 좌표(mapCenter+mapPins)가 있을 때만 렌더하고 없으면 "지도 준비 중" 자리표시(가짜 기본 센터 지도
 * 금지, 571 경고-2 동형). `DayHighlight` 계약에 좌표가 없어 런타임은 늘 자리표시 가지다 — AC-1 은
 * mapPins 를 주입해 MAP 경로만 검증하고, 실 좌표 배선은 계약 확장 후속 티켓. `mapCenter?`·`mapPins?`
 * 는 옵셔널(테스트가 안 넘겨도 컴파일 통과해야 하므로 required 불가).
 */

export type SummaryViewMode = 'MAP' | 'VISIT_LIST';

export interface DayCardVM {
  key: string;
  dateLabel: string;
  countLabel: string;
  subtitle: string;
}

export interface TripSummaryScreenProps {
  stats: SummaryStatCells;
  distanceSourceLabel: string;
  view: SummaryViewMode;
  mapCenter?: MapCenter;
  mapPins?: MapPin[];
  dayCards: DayCardVM[];
  orderedVisits: OrderedVisit[];
  shareEnabled: boolean;
  onShare: () => void;
  onBack: () => void;
}

function StatCell({
  value,
  label,
  caption,
}: {
  value: string;
  label: string;
  caption?: string;
}): ReactElement {
  return (
    <View className="flex-1 items-center gap-[2px]">
      <Text className="font-noto-bold text-[20px] font-bold text-ink">
        {value}
      </Text>
      <Text className="text-label text-muted">{label}</Text>
      {caption ? (
        <Text className="text-[11px] text-muted-soft">{caption}</Text>
      ) : null}
    </View>
  );
}

export function TripSummaryScreen({
  stats,
  distanceSourceLabel,
  view,
  mapCenter,
  mapPins,
  dayCards,
  orderedVisits,
  shareEnabled,
  onShare,
  onBack,
}: TripSummaryScreenProps): ReactElement {
  // disabled 는 fireEvent.press 를 항상 막지는 않으므로(RNTL) 콜백 게이트를 한 번 더 둔다(571 저장버튼 동형).
  const handleShare = () => {
    if (!shareEnabled) return;
    onShare();
  };
  const hasMap = mapCenter !== undefined && (mapPins?.length ?? 0) > 0;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* 헤더 — 뒤로 · 제목 · 공유(코랄, ready 로 활성) */}
      <View className="w-full flex-row items-center bg-canvas pb-[12px] pl-[12px] pr-lg pt-[4px]">
        <Pressable
          testID="reflection-summary-back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onBack}
          className="pr-[4px]"
        >
          <BackArrowGlyph size={24} />
        </Pressable>
        <Text className="font-noto-bold text-[18px] font-bold text-ink">
          여행 요약
        </Text>
        <View className="flex-1" />
        <Pressable
          testID="reflection-summary-share"
          disabled={!shareEnabled}
          accessibilityState={{ disabled: !shareEnabled }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={handleShare}
        >
          <Text
            className={`font-noto-bold text-body font-bold ${
              shareEnabled ? 'text-primary' : 'text-muted-soft'
            }`}
          >
            공유
          </Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-md px-lg pb-[32px] pt-[8px]"
      >
        {/* stats 3셀 — 방문·거리(출처 라벨)·사진. 거리는 미측정이면 "—"(0km 아님). */}
        <View
          testID="reflection-summary-stats"
          className="w-full flex-row items-center rounded-card border border-hairline bg-canvas px-lg py-[18px]"
        >
          <StatCell value={String(stats.totalVisits)} label="총 방문" />
          <View className="h-[28px] w-px bg-hairline" />
          <StatCell
            value={stats.distanceText}
            label="총 거리"
            caption={
              stats.distanceText === '—' ? undefined : distanceSourceLabel
            }
          />
          <View className="h-[28px] w-px bg-hairline" />
          <StatCell value={String(stats.totalPhotos)} label="총 사진" />
        </View>

        {view === 'MAP' ? (
          <>
            {hasMap ? (
              <View className="h-[220px] w-full overflow-hidden rounded-card">
                <KakaoMapView center={mapCenter} pins={mapPins} viewOnly />
              </View>
            ) : (
              // 실 좌표가 없으면 지도를 그리지 않는다 — 하드코딩 기본 센터를 실데이터처럼 그리면
              // 거짓 정보가 된다(571 경고-2 동형). DayHighlight 계약에 좌표가 없어 오늘은 늘 이 가지.
              <View
                testID="reflection-summary-map-pending"
                className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl"
              >
                <LocationOffGlyph size={30} />
                <Text className="font-noto text-label text-muted">
                  지도 준비 중
                </Text>
              </View>
            )}

            {dayCards.map((card) => (
              <DayHighlightCard
                key={card.key}
                dateLabel={card.dateLabel}
                countLabel={card.countLabel}
                subtitle={card.subtitle}
              />
            ))}
          </>
        ) : (
          <>
            {/* 위치 전무 — 빈 지도 대신 순서 방문 목록(BR-U5-39). */}
            <View className="w-full items-center gap-sm rounded-card border-[1.5px] border-dashed border-hairline-strong bg-surface-soft px-lg py-3xl">
              <LocationOffGlyph size={30} />
              <Text className="text-center font-noto text-label text-muted">
                위치 기록이 없어 지도를 표시할 수 없어요
              </Text>
              <Text className="text-center text-label text-muted-soft">
                대신 방문 장소를 순서대로 보여드릴게요
              </Text>
            </View>

            {orderedVisits.map((visit) => (
              <View
                key={visit.order}
                testID="reflection-summary-visit-item"
                className="w-full flex-row items-center gap-md rounded-card border border-hairline bg-canvas px-lg py-[14px]"
              >
                <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-primary">
                  <Text className="font-noto-bold text-label font-bold text-on-primary">
                    {visit.order}
                  </Text>
                </View>
                <Text className="text-label text-muted">{visit.dayLabel}</Text>
                <Text className="flex-1 font-noto text-body text-ink">
                  {visit.place}
                </Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
