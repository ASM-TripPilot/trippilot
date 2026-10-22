import type { ReactElement, ReactNode } from 'react';
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { pickRegionCover } from '@/entities/trip';
import { APP_ICON_COLORS, AppIconGlyph } from '@/features/auth/index.view';
import { SparkleGlyph } from '@/features/open-assistant';
import { ChevronRightGlyph, GLYPH_COLORS } from '@/shared/ui/glyphs';
import { HeartFilledGlyph, HeartOutlineGlyph } from '@/shared/ui/HeartGlyphs';
import { Image } from '@/shared/ui/Image';
import { PlacePhoto } from '@/shared/ui/PlacePhoto';

import {
  TourFlameGlyph,
  TourMapBackdrop,
  TourMapPinBody,
  TourMapRoute,
  TourScaleBar,
  TourVisitCheck,
} from './TourGlyphs';

// c10 무대 조각 6벌(TRIP-1595) — 전부 **장식**이다. 누르는 요소(Pressable)를 하나도 두지 않는다(AC5): 하트·예약 버튼·칩은 모양만 같은 View 다.
// 사진은 Figma 실사진이 아니라 번들 일러스트(결정 D1): 감천 26380 · 광안리 26500 · 해운대 호텔은 숙소 일반 그림. 값은 Figma 노드 그대로다.

// 그림자는 토큰 대상이 아니다 — RN 은 box-shadow 가 없어 shadow* 로 옮긴다(HomeScreen 카드 그림자 관례).
const CARD_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 2,
} as const;
const SOFT_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;
const DOT_SHADOW = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 5,
  elevation: 1,
} as const;

const GAMCHEON_COVER = pickRegionCover([{ seq: 1, regionCode: '26380' }]);
const GWANGALLI_COVER = pickRegionCover([{ seq: 1, regionCode: '26500' }]);

/** 사진 우상단 흰 원 32 + 하트 18 — 눌리지 않는 장식(`HeartButton` 은 Pressable 이라 쓰지 않는다). */
function HeartDot({
  filled,
  right,
  top,
}: {
  filled: boolean;
  right: number;
  top: number;
}): ReactElement {
  return (
    <View
      className="absolute h-[32px] w-[32px] items-center justify-center rounded-pill bg-canvas"
      style={[{ right, top }, DOT_SHADOW]}
    >
      {filled ? <HeartFilledGlyph /> : <HeartOutlineGlyph />}
    </View>
  );
}

function PlaceCard({
  name,
  meta,
  filled,
  cover,
}: {
  name: string;
  meta: ReactNode;
  filled: boolean;
  cover: ReturnType<typeof pickRegionCover>;
}): ReactElement {
  return (
    <View className="w-[160px] gap-[7px]">
      <View className="h-[120px] w-[160px] overflow-hidden rounded-button">
        {cover ? (
          <Image
            source={cover}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
        ) : null}
        <HeartDot filled={filled} right={8} top={8} />
      </View>
      <Text className="font-noto-bold text-body font-bold text-ink">
        {name}
      </Text>
      {meta}
    </View>
  );
}

export function TourPlacesFragment(): ReactElement {
  return (
    <View className="flex-row gap-md">
      <PlaceCard
        name="감천문화마을"
        filled
        cover={GAMCHEON_COVER}
        meta={
          <Text className="font-noto text-caption text-muted">부산 사하구</Text>
        }
      />
      <PlaceCard
        name="광안리 해변"
        filled={false}
        cover={GWANGALLI_COVER}
        meta={
          <View className="flex-row items-center gap-xs">
            <TourFlameGlyph />
            <Text className="font-noto text-caption text-muted">
              지금 급상승
            </Text>
          </View>
        }
      />
    </View>
  );
}

export function TourStayFragment(): ReactElement {
  return (
    // 그림자는 바깥, 사진 모서리 클립은 안쪽 — overflow 를 같은 View 에 두면 iOS 에서 그림자가 잘린다.
    <View
      className="w-[300px] rounded-button border border-hairline bg-canvas"
      style={CARD_SHADOW}
    >
      <View className="overflow-hidden rounded-button">
        <View className="h-[140px] w-full">
          <PlacePhoto
            category="숙소"
            poiId="onboarding-tour-stay"
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
          />
          <HeartDot filled={false} right={10} top={12} />
        </View>
        <View className="gap-xs px-lg pb-lg pt-md">
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            해운대 오션 호텔
          </Text>
          <Text className="font-noto text-label text-muted">해운대 · 350m</Text>
          <View className="flex-row pt-sm">
            <View className="h-[36px] items-center justify-center rounded-button border border-hairline-strong bg-canvas px-md">
              <Text className="font-noto-bold text-label font-bold text-ink">
                외부에서 예약하기
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

// 3/6 지도 카드 안 좌표(342×200 기준, Figma 그대로). 핀 박스 28×36 의 좌상단, 팁은 (+14, +35).
const MAP_PINS = [
  { n: 1, x: 63, y: 115 },
  { n: 2, x: 147, y: 73 },
  { n: 3, x: 186, y: 15 },
  { n: 4, x: 251, y: 41 },
] as const;
const MAP_ROUTE_POINTS = [
  [77, 150],
  [161, 108],
  [200, 50],
  [265, 76],
] as const;
// 거리 라벨(INV-3: 소요시간 없이 거리만).
const MAP_LABELS = [
  { text: '2.1km', x: 122, y: 134 },
  { text: '0.8km', x: 184, y: 86 },
  { text: '0.6km', x: 218, y: 74 },
] as const;
const HALO = {
  textShadowColor: '#FFFFFF',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 3,
} as const;

function Chip({
  label,
  selected,
}: {
  label: string;
  selected: boolean;
}): ReactElement {
  return (
    <View
      className={`rounded-button px-[14px] py-[9px] ${
        selected ? 'bg-primary-pale' : 'bg-surface-soft'
      }`}
    >
      {selected ? (
        <Text className="font-noto-bold text-label font-bold text-primary">
          {label}
        </Text>
      ) : (
        <Text className="font-noto text-label text-ink">{label}</Text>
      )}
    </View>
  );
}

export function TourPlanFragment(): ReactElement {
  return (
    <View className="w-[342px] gap-md">
      <View className="h-[200px] w-[342px] overflow-hidden rounded-button">
        <TourMapBackdrop />
        <TourMapRoute points={MAP_ROUTE_POINTS} />
        {MAP_LABELS.map(({ text, x, y }) => (
          <Text
            key={text}
            className="absolute font-inter-bold text-micro font-bold text-ink"
            style={[{ left: x, top: y }, HALO]}
          >
            {text}
          </Text>
        ))}
        {MAP_PINS.map(({ n, x, y }) => (
          <View
            key={n}
            className="absolute h-[36px] w-[28px]"
            style={{ left: x, top: y }}
          >
            <TourMapPinBody />
            <Text
              className="absolute left-0 right-0 text-center font-inter-bold text-label font-bold leading-[16px] text-on-primary"
              style={{ top: 6 }}
            >
              {n}
            </Text>
          </View>
        ))}
        <View className="absolute" style={{ left: 274, top: 186 }}>
          <TourScaleBar />
        </View>
        <Text
          className="absolute font-inter-bold text-[10px] font-bold text-body"
          style={{ left: 291, top: 172 }}
        >
          1 km
        </Text>
      </View>
      <View className="flex-row gap-sm">
        <Chip label="완전 AI가 짜기" selected />
        <Chip label="AI와 같이 짜기" selected={false} />
        <Chip label="직접 짜기" selected={false} />
      </View>
    </View>
  );
}

export function TourTripFragment(): ReactElement {
  return (
    <View className="w-[342px] gap-md">
      <View
        className="gap-sm rounded-button border border-hairline bg-canvas px-lg py-md"
        style={CARD_SHADOW}
      >
        <View className="flex-row items-center gap-sm">
          <LinearGradient
            colors={APP_ICON_COLORS}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4.455,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#DB2647',
              shadowOffset: { width: 0, height: 0.909 },
              shadowOpacity: 0.28,
              shadowRadius: 2.182,
            }}
          >
            <AppIconGlyph size={12} />
          </LinearGradient>
          <Text className="flex-1 font-inter-bold text-caption font-bold text-body">
            TripPilot
          </Text>
          <Text className="font-noto text-caption text-muted">지금</Text>
        </View>
        <View className="gap-xs">
          <Text className="font-noto-bold text-body font-bold text-ink">
            날씨가 일정에 영향을 줄 수 있어요
          </Text>
          <Text className="font-noto text-label text-body">
            비 예보 · 해운대 17시
          </Text>
        </View>
      </View>
      <View
        className="flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-lg py-md"
        style={CARD_SHADOW}
      >
        <TourVisitCheck />
        <View className="flex-1 gap-xs">
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            광안리 해변
          </Text>
          <Text className="font-noto text-label text-muted">11:00 방문</Text>
        </View>
      </View>
    </View>
  );
}

function Stat({
  value,
  label,
}: {
  value: string;
  label: string;
}): ReactElement {
  return (
    <View className="flex-1 items-center gap-xs">
      <Text className="font-inter-bold text-hero font-bold text-ink">
        {value}
      </Text>
      <Text className="font-noto text-caption text-muted">{label}</Text>
    </View>
  );
}

export function TourRecordFragment(): ReactElement {
  return (
    <View className="w-[342px] gap-md">
      <View
        className="flex-row items-center rounded-button border border-hairline bg-canvas py-[18px]"
        style={DOT_SHADOW}
      >
        <Stat value="12" label="총 방문" />
        <Stat value="38km" label="총 거리" />
        <Stat value="24" label="총 사진" />
      </View>
      <View
        className="flex-row items-center gap-md rounded-button border border-hairline bg-canvas px-[14px] py-md"
        style={SOFT_SHADOW}
      >
        <View className="h-[56px] w-[56px] overflow-hidden rounded-[10px]">
          {GWANGALLI_COVER ? (
            <Image
              source={GWANGALLI_COVER}
              contentFit="cover"
              style={{ width: '100%', height: '100%' }}
            />
          ) : null}
        </View>
        <View className="flex-1 gap-[3px]">
          <View className="flex-row items-center gap-[6px]">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              1일차
            </Text>
            <Text className="font-noto text-label text-muted">· 5곳</Text>
          </View>
          <Text className="font-noto text-label text-muted">
            광안리→감천, 바다와 골목
          </Text>
        </View>
        <ChevronRightGlyph />
      </View>
    </View>
  );
}

export function TourAssistantFragment(): ReactElement {
  return (
    <View
      className="w-[342px] gap-md rounded-button border border-hairline bg-canvas p-lg"
      style={CARD_SHADOW}
    >
      <View className="flex-row justify-end">
        <View className="rounded-card bg-surface-strong px-[14px] py-sm">
          <Text className="font-noto text-body leading-[22px] text-ink">
            지금까지 짠 일정 검토해줘
          </Text>
        </View>
      </View>
      <View className="flex-row items-start gap-md">
        <View
          className="h-[40px] w-[40px] items-center justify-center rounded-pill bg-canvas"
          style={DOT_SHADOW}
        >
          <SparkleGlyph size={20} color={GLYPH_COLORS.primary} />
        </View>
        <Text className="flex-1 font-noto text-body leading-[22px] text-ink">
          1일차 동선을 보니 황령산에서 미술관까지 0.8km예요. 그대로 두셔도
          괜찮아요.
        </Text>
      </View>
    </View>
  );
}
