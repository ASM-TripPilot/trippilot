import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatDistance } from '@/entities/place/lib/formatDistance';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { StayRecommendCard } from '@/entities/stay/ui/StayRecommendCard';
import { withObjectParticle } from '@/features/itinerary/lib/objectParticle';
import { LinkChevronGlyph } from '@/features/itinerary/ui/ItineraryGlyphs';
import type { StayRecommendView as StayRecommendViewModel } from '@/features/itinerary/model/stayRecommend';
import type { MapPin } from '@/shared/map';
import { MapSheetShell } from '@/widgets/map-sheet-shell/ui/MapSheetShell';

/**
 * TRIP-800 · h15 동선 기준 숙소 추천 pages 순수 뷰(presentation-only, Figma `4385:1623`). 지도+시트 셸 위에 헤더 ·
 * 추천 카드 · `다른 숙소 둘러보기` 링크 · 거점 지정 CTA 를 얹는다. 선택·요청·라우터는 페이지 몫이라
 * 이 화면은 `selectedId` 를 받아 그리고 누름을 콜백으로 올리기만 한다(프리뷰가 이 파일만 태울 수 있게
 * 네트워크 계층을 모른다). 셸(widgets)을 조립하므로 features 가 아니라 pages 층에 산다(features → widgets
 * import 는 층 규칙 위반) — `pages/planb-draft/ui/ReplanDraftView` 선례.
 *
 * 후보 순서는 받은 그대로다 — 서버 순서가 곧 "이동 합계가 짧은 순"이고, `추천` 배지도 입력 첫 카드에
 * 붙는다(재정렬·재판정 금지, INV-2 결). 거리만 보인다(INV-3).
 */

const TITLE = '동선 기준 숙소 추천';
const SORT_TAIL = '이동 합계가 짧은 순';
const BROWSE_LABEL = '다른 숙소 둘러보기';

export interface StayRecommendViewProps {
  view: StayRecommendViewModel;
  /** 선택 후보의 `savedStayId`. 목록에 없으면 첫 카드로 본다. */
  selectedId: string;
  onSelect: (savedStayId: string) => void;
  onConfirm: () => void;
  onBrowseOther: () => void;
  onBack: () => void;
  /** 요청 중·기간 미확정·지정 불가 — CTA 를 잠근다. */
  confirmDisabled?: boolean;
  /** 지정 실패·지정 불가 사유(INV-4 — 침묵 금지). */
  notice?: string | null;
}

export function StayRecommendView({
  view,
  selectedId,
  onSelect,
  onConfirm,
  onBrowseOther,
  onBack,
  confirmDisabled,
  notice,
}: StayRecommendViewProps): ReactElement {
  const { candidates, routePins } = view;
  const selected =
    candidates.find((candidate) => candidate.savedStayId === selectedId) ??
    candidates[0];

  // 지도 핀: 동선 핀은 그대로(kind 없음 = 경로선), 선택 후보 = 숙소 핀, 나머지 = 아웃라인 후보 핀.
  // 숙소·후보 번호는 동선 최대 번호 뒤로 매겨 React key·testID 가 겹치지 않게 한다(동선 번호는 카드
  // 번호와 대응이라 손대지 않는다).
  const firstFreeNumber =
    Math.max(0, ...routePins.map((pin) => pin.number)) + 1;
  const pins: MapPin[] = [
    ...routePins,
    ...candidates.map((candidate, index): MapPin => ({
      number: firstFreeNumber + index,
      lat: candidate.lat,
      lng: candidate.lng,
      kind: candidate === selected ? 'stay' : 'candidate',
    })),
  ];

  return (
    <MapSheetShell
      center={view.center}
      pins={pins}
      radiusCircle={{ center: view.center, radiusM: view.radiusM }}
      onBack={onBack}
      header={
        <View className="gap-md px-lg pt-sm">
          <View className="flex-row items-center justify-between">
            <Text
              testID="stay-recommend-title"
              className="font-noto-bold text-card-title font-bold text-ink"
            >
              {TITLE}
            </Text>
            <Text
              testID="stay-recommend-count"
              className="font-noto text-label text-muted"
            >
              {`${candidates.length}곳`}
            </Text>
          </View>
          <Text
            testID="stay-recommend-subtitle"
            className="font-noto text-label text-muted"
          >
            {`${view.summary} · ${SORT_TAIL}`}
          </Text>
        </View>
      }
      cta={[
        {
          label: `${withObjectParticle(selected.name)} 거점으로`,
          variant: 'primary',
          onPress: onConfirm,
          disabled: confirmDisabled,
        },
      ]}
    >
      <View className="gap-md px-lg pb-2xl pt-md">
        {candidates.map((candidate, index) => (
          <StayRecommendCard
            key={candidate.savedStayId}
            testID={`stay-recommend-card-${index}`}
            name={candidate.name}
            imageSource={candidate.imageSource}
            avgLabel={`평균 ${formatDistance(candidate.avgDistanceM)}`}
            maxLabel={`최대 ${formatDistance(candidate.maxDistanceM)}`}
            subtitle={`${candidate.district} · ${candidate.priceTier}`}
            priceLabel={formatPrice(candidate.price)}
            recommended={index === 0}
            selected={candidate === selected}
            onPress={() => onSelect(candidate.savedStayId)}
          />
        ))}
        <Pressable
          testID="stay-recommend-browse"
          accessibilityRole="link"
          onPress={onBrowseOther}
          className="flex-row items-center gap-xs py-[10px]"
        >
          <Text className="font-noto-bold text-card-title font-bold text-primary-text">
            {BROWSE_LABEL}
          </Text>
          <LinkChevronGlyph />
        </Pressable>
        {notice ? (
          <Text
            testID="stay-recommend-notice"
            className="font-noto text-label text-primary-text"
          >
            {notice}
          </Text>
        ) : null}
      </View>
    </MapSheetShell>
  );
}
