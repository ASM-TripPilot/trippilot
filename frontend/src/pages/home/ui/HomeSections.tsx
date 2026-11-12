// 홈 본문 섹션 — 담는 곳·뜨는 장소·지난 여행·추천 스트립과 그 카드들.
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { HomeLocationPinGlyph } from './HomeGlyphs';
import { ABSOLUTE_FILL, SCRIM_LOCATIONS } from './homeSurface';
import { HeartButton } from '@/shared/ui/HeartButton';
import { Image } from '@/shared/ui/Image';
import { PoiPhoto } from '@/shared/ui/PoiPhoto';
import { Skeleton } from '@/shared/ui/Skeleton';
import type {
  HomeCollectionCard,
  HomeCollectionsLane,
  HomeSections,
  HomeSpotCard,
  HomeSpotsLane,
  PastTrip,
} from '../model/homeTypes';

// 사진 위 흰 글씨 가독성을 위한 스크림 그라디언트(브리프 §3-D 명시 raw 허용 — 스크림은 토큰
// 대상이 아니다). 상단 30%는 투명, 하단은 검정. 카드별 하단 농도만 Figma 실측대로 다르다.
const DEST_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'] as const;
const SPOT_SCRIM_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.66)'] as const;
// postTrip 가로 사진 카드 스크림(Figma 2092:1521). 색은 DEST_SCRIM 재사용, 시작 위치만
// 0.3→0.4 로 늦춰(작은 카드라 글씨 영역이 아래 1/3) 하단만 짙게 눌러 흰 타이틀 가독성 확보.
const PAST_TRIP_SCRIM_LOCATIONS = [0.4, 1] as const;

// ── 공용 섹션 헤더(타이틀 + '더 보기') ──────────────────────────────────
// asButton은 role(버튼으로 읽히는가)을, onMore는 press 핸들러를 각각 정한다 — 둘은 함께
// 움직이지 않는다: 배선 인스턴스(뜨는 장소)는 콜백이 안 넘어온 단위 테스트에서도 버튼이어야
// 하므로(370-AC-4) role은 콜백 유무가 아니라 구조로 굳힌다. 비배선 인스턴스(asButton 없음 = 컬렉션)는
// '더 보기' 자체를 그리지 않는다(TRIP-939 B-5 — 목적지가 생기면 asButton+onMore 로 되살린다).
function SectionHeader({
  title,
  moreTestID,
  onMore,
  asButton = false,
}: {
  title: string;
  moreTestID: string;
  onMore?: () => void;
  asButton?: boolean;
}): ReactElement {
  return (
    <View className="w-full flex-row items-center justify-between px-lg">
      <Text className="font-noto-bold text-section font-bold text-ink">
        {title}
      </Text>
      {asButton ? (
        <Pressable
          testID={moreTestID}
          accessibilityRole="button"
          onPress={onMore}
        >
          <Text className="font-noto-bold text-[12.5px] font-bold text-muted underline">
            더 보기
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ── 컬렉션 카드(요즘 사람들이 담는 곳 · 내가 담은 곳 · 추천) ─────────────
// 하단 메타는 지역+핀으로 그린다(discovery·추천 공용).
function CollectionCard({
  card,
  index,
  onPressCard,
}: {
  card: HomeCollectionCard;
  index: number;
  onPressCard?: (poiId: string) => void;
}): ReactElement {
  const { poiId } = card;
  const onPress = poiId && onPressCard ? () => onPressCard(poiId) : undefined;
  return (
    <Pressable
      testID={`home-collection-card-${index}`}
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      className="h-[300px] w-[230px] overflow-hidden rounded-[18px]"
    >
      <PoiPhoto
        testID={`home-collection-photo-${index}`}
        imageUrl={card.imageUrl}
        imageLicense={card.imageLicense}
        surface="overlay"
        category={card.category}
        poiId={poiId}
        cachePolicy="memory-disk"
        recyclingKey={poiId ?? card.imageUrl ?? undefined}
        transition={120}
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={DEST_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute inset-x-0 top-[12px] flex-row items-center justify-between px-[12px]">
        <View className="rounded-pill bg-primary px-[10px] py-[4px]">
          <Text className="font-noto-bold text-[10.5px] font-bold text-on-primary">
            {card.badge}
          </Text>
        </View>
      </View>
      <View className="absolute inset-x-0 bottom-[16px] gap-[6px] px-[14px]">
        <Text className="font-noto-bold text-[18px] font-bold text-on-primary">
          {card.title}
        </Text>
        <View className="flex-row items-center gap-[4px]">
          <HomeLocationPinGlyph size={12} />
          <Text className="font-noto text-micro text-on-primary opacity-90">
            {card.region}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── 스팟 카드(지금 뜨는 장소, 2×2 그리드 셀) ────────────────────────────
// 하트는 poiId(실데이터)와 save 배선이 둘 다 있을 때만 — 픽스처엔 담을 대상이 없다(AC-14).
// 카드는 poiId + onPressCard 가 있을 때만 버튼(TRIP-1221 상세 이동) — 하트는 자기 Pressable 이 먼저 받는다.
function SpotCard({
  card,
  index,
  lane,
}: {
  card: HomeSpotCard;
  index: number;
  lane?: HomeSpotsLane;
}): ReactElement {
  const { poiId } = card;
  const onToggleSave = lane?.onToggleSave;
  const onPressCard = lane?.onPressCard;
  return (
    <Pressable
      testID={`home-spot-card-${index}`}
      accessibilityRole={poiId && onPressCard ? 'button' : undefined}
      // 보이는 글자 그대로(TRIP-1281) — 없으면 iOS 가 자식 하트 라벨을 카드에 끌어다 붙인다.
      accessibilityLabel={[card.title, card.tag].filter(Boolean).join(', ')}
      onPress={poiId && onPressCard ? () => onPressCard(poiId) : undefined}
      className="h-[166px] flex-1 overflow-hidden rounded-card"
    >
      <PoiPhoto
        testID={`home-spot-photo-${index}`}
        imageUrl={card.imageUrl}
        imageLicense={card.imageLicense}
        surface="overlay"
        category={card.category}
        poiId={poiId}
        cachePolicy="memory-disk"
        recyclingKey={poiId ?? card.imageUrl ?? undefined}
        transition={120}
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={SPOT_SCRIM_COLORS}
        locations={SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute inset-x-0 bottom-[12px] gap-[3px] px-[12px]">
        <Text className="font-noto-bold text-body font-bold text-on-primary">
          {card.title}
        </Text>
        <Text className="font-noto text-micro text-on-primary opacity-90">
          {card.tag}
        </Text>
      </View>
      {poiId && onToggleSave ? (
        <HeartButton
          saved={(lane.savedPoiIds ?? []).includes(poiId)}
          pending={(lane.pendingPoiIds ?? []).includes(poiId)}
          onPress={() => onToggleSave(poiId)}
          testID={`home-spot-save-${poiId}`}
          filledTestID={`home-spot-heart-filled-${poiId}`}
          outlineTestID={`home-spot-heart-outline-${poiId}`}
          name={card.title}
          className="absolute right-sm top-sm"
        />
      ) : null}
    </Pressable>
  );
}

// ── 섹션1: 요즘 사람들이 담는 곳(가로 스크롤 · 3상태) ───────────────────
// TRIP-1209 — `lane`(실데이터)이 오면 섹션이 자기 상태를 따로 갖는다(SpotsSection 과 같은 패턴):
// 대기=스켈레톤 · 실패=한 줄 재시도(INV-4) · 0장=섹션 통째 숨김. 없으면 `sections.collections`(픽스처).
// `sections.kind==='loading'`(홈 전면 로딩)이면 lane 과 무관하게 스켈레톤이다.
export function CollectionsSection({
  sections,
  title = '요즘 사람들이 담는 곳',
  lane,
}: {
  sections: HomeSections;
  /** 컬렉션 헤더 카피. 미지정이면 기본 "요즘 사람들이 담는 곳"(discovery), planning 은 지역
   *  카피("부산에서 담을 만한 곳")를 주입(TRIP-696 파라미터화). */
  title?: string;
  lane?: HomeCollectionsLane;
}): ReactElement | null {
  const status =
    sections.kind === 'loading' ? 'loading' : (lane?.status ?? 'ready');
  const cards =
    sections.kind === 'loading' ? [] : (lane?.cards ?? sections.collections);
  if (lane && status === 'ready' && cards.length === 0) return null;
  return (
    <View className="w-full gap-md">
      <SectionHeader title={title} moreTestID="home-collections-more" />
      {status === 'error' ? (
        <Pressable
          testID="home-collections-error"
          accessibilityRole="button"
          onPress={lane?.onRetry}
          className="mx-lg rounded-card bg-surface-soft px-lg py-2xl"
        >
          <Text className="font-noto text-label text-muted">
            장소를 불러오지 못했어요 · 다시 시도
          </Text>
        </Pressable>
      ) : status === 'ready' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        >
          {cards.map((card, index) => (
            <CollectionCard
              key={card.poiId ?? card.title}
              card={card}
              index={index}
              onPressCard={lane?.onPressCard}
            />
          ))}
        </ScrollView>
      ) : (
        <View
          testID="home-collections-skeleton"
          className="mx-lg flex-row gap-md overflow-hidden"
        >
          {[0, 1].map((i) => (
            <Skeleton
              key={i}
              className="h-[300px] w-[230px] rounded-[18px] bg-surface-strong"
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── 섹션2: 지금 뜨는 장소(2×2 그리드 · 3상태) ───────────────────────────
// TRIP-1049 — `spotsLane`(실데이터)이 오면 섹션이 자기 상태를 따로 갖는다: 대기=스켈레톤 ·
// 실패=한 줄 재시도(INV-4) · 0장=섹션 통째 숨김. 없으면 지금처럼 `sections.spots`(픽스처).
// `sections.kind==='loading'`(홈 전면 로딩)이면 spotsLane 과 무관하게 스켈레톤이다.
export function SpotsSection({
  sections,
  onMore,
  lane,
}: {
  sections: HomeSections;
  onMore?: () => void;
  lane?: HomeSpotsLane;
}): ReactElement | null {
  const status =
    sections.kind === 'loading' ? 'loading' : (lane?.status ?? 'ready');
  const cards =
    sections.kind === 'loading' ? [] : (lane?.cards ?? sections.spots);
  if (lane && status === 'ready' && cards.length === 0) return null;
  return (
    <View className="w-full gap-md">
      <SectionHeader
        title="지금 뜨는 장소"
        moreTestID="home-spots-more"
        onMore={onMore}
        asButton
      />
      {lane?.saveErrorMessage ? (
        <Pressable
          testID="home-spot-save-error"
          accessibilityRole="button"
          onPress={lane.onDismissSaveError}
          className="mx-lg rounded-card bg-surface-soft px-lg py-md"
        >
          <Text className="font-noto text-label text-muted">
            {lane.saveErrorMessage}
          </Text>
        </Pressable>
      ) : null}
      {status === 'error' ? (
        <Pressable
          testID="home-spots-error"
          accessibilityRole="button"
          onPress={lane?.onRetry}
          className="mx-lg rounded-card bg-surface-soft px-lg py-2xl"
        >
          <Text className="font-noto text-label text-muted">
            장소를 불러오지 못했어요 · 다시 시도
          </Text>
        </Pressable>
      ) : status === 'ready' ? (
        <View className="mx-lg gap-md">
          {[0, 1].map((row) => (
            <View key={row} className="flex-row gap-md">
              {cards.slice(row * 2, row * 2 + 2).map((card, i) => (
                <SpotCard
                  key={card.poiId ?? card.title}
                  card={card}
                  index={row * 2 + i}
                  lane={lane}
                />
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View testID="home-spots-skeleton" className="mx-lg gap-md">
          {[0, 1].map((row) => (
            <View key={row} className="flex-row gap-md">
              {[0, 1].map((c) => (
                <Skeleton
                  key={c}
                  className="h-[166px] flex-1 rounded-card bg-surface-strong"
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── 지난 여행 가로 사진 카드(postTrip · Figma 2092:1521) ──────────────────
// 158×120 rounded-12 사진 카드 — object-cover 사진(uri null 이면 토큰 tint) 위 하단 스크림,
// 흰 타이틀14 + 둘째줄 dateLabel10.5(opacity 88). CollectionCard 와 같은 "사진+스크림+흰 글씨"
// 계열이나 치수·둘째줄이 달라 별 함수로 둔다(HOME_SCREEN_SOURCE_FILES 동결 — 파일 내부 함수).
function PastTripCard({
  trip,
  index,
}: {
  trip: PastTrip;
  index: number;
}): ReactElement {
  return (
    <View
      testID={`home-past-trip-card-${index}`}
      className="h-[120px] w-[158px] overflow-hidden rounded-[12px]"
    >
      <View className="absolute inset-0 bg-surface-strong" />
      {/* eslint-disable-next-line no-restricted-syntax -- 지난 여행 커버 — 관광공사 POI 사진 아님 */}
      <Image
        source={trip.imageUrl ? { uri: trip.imageUrl } : undefined}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
        style={ABSOLUTE_FILL}
      />
      <LinearGradient
        colors={DEST_SCRIM_COLORS}
        locations={PAST_TRIP_SCRIM_LOCATIONS}
        style={ABSOLUTE_FILL}
      />
      <View className="absolute inset-x-0 bottom-[14px] gap-[2px] px-[12px]">
        <Text className="font-noto-bold text-[14px] font-bold text-on-primary">
          {trip.title}
        </Text>
        <Text className="font-noto text-[10.5px] text-on-primary opacity-[0.88]">
          {trip.dateLabel}
        </Text>
      </View>
    </View>
  );
}

// ── 지난 여행 섹션(postTrip · 가로 스크롤 사진 카드) ─────────────────────
// 헤더 "지난 여행"16 + "전체 보기"(콜백 있을 때만 버튼, TRIP-1369) · 가로 스크롤 사진 카드.
export function PastTripsSection({
  trips,
  onPressMore,
}: {
  trips: readonly PastTrip[];
  onPressMore?: () => void;
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <View className="w-full flex-row items-center justify-between px-lg">
        <Text className="font-noto-bold text-[16px] font-bold text-ink">
          지난 여행
        </Text>
        {/* 콜백이 있을 때만 버튼 — 콜백 없는 호출부(프리뷰)에 죽은 버튼을 만들지 않는다(심사 2.1). */}
        <Pressable
          testID="home-past-trips-more"
          accessibilityRole={onPressMore ? 'button' : undefined}
          onPress={onPressMore}
        >
          <Text className="font-noto-bold text-label font-bold text-muted underline">
            전체 보기
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {trips.map((trip, index) => (
          <PastTripCard
            key={`${trip.title}-${index}`}
            trip={trip}
            index={index}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ── 컬렉션 가로 스트립(postTrip '다음엔 여기 어때요') ──────────────────────
export function CollectionStrip({
  title,
  collections,
}: {
  title: string;
  collections: readonly HomeCollectionCard[];
}): ReactElement {
  return (
    <View className="w-full gap-md">
      <SectionHeader title={title} moreTestID="home-collections-more" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {collections.map((card, index) => (
          <CollectionCard key={card.title} card={card} index={index} />
        ))}
      </ScrollView>
    </View>
  );
}
