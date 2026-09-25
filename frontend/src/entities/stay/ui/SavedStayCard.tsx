import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * TRIP-807 · AC-4 — 저장 숙소 degrade 카드(e04 세로 · g02 시트 행 공용). props-only.
 *
 * **degrade 카드 = 계약 공백을 정직하게 비운다** — `SavedStay` 계약에 사진 URL·지역·거리·가격이
 * 없어 카드는 이름 + `subtitle` 슬롯(날짜)만 그린다(가격·거리·₩ 발명 0 · INV-1). 사진은 회색 자리.
 *
 * 하트는 카드가 소유하지 않는다(하트 불가지) — e04 항상채움 하트·g02 선택 체크를 소비처가
 * `trailing` 슬롯으로 주입한다. 그래서 카드에 fill 토글 상태가 없고, 담김 표식은 색이 아니라
 * `accessibilityState.selected`(관측 가능)로 잰다(★4·★5).
 *
 * layout 으로 두 배치를 가른다: vertical(e04 — 사진178 상단, trailing 오버레이) · row(g02 — 사진56
 * 좌, trailing 우). 선택 표식·접두는 소비처가 정하고 계약(이름·selected·subtitle·trailing·onPress)은
 * 같다.
 */
export interface SavedStayCardProps {
  /** 루트 testID(소비처 스킴 주입 — e04 `saved-stay-card-{id}` · g02 `trip-base-staysheet-cand-{id}`). */
  testID: string;
  name: string;
  /** 날짜 슬롯 — 지정 시에만 렌더(소비처가 <Text> 로 조립, e04 날짜라벨 · g02 날짜/"날짜 없음"). */
  subtitle?: ReactNode;
  /** 트레일링 슬롯 — 지정 시에만 렌더(e04 항상채움 하트 · g02 선택 체크). 카드는 내용을 모른다. */
  trailing?: ReactNode;
  /** accessibilityState.selected(색 아님) — e04 true 고정 · g02 토글. 기본 false. */
  selected?: boolean;
  layout: 'vertical' | 'row';
  onPress?: () => void;
  /** 사진 URL — **row(g02) 전용**. 지정 시 <Image>(56×56 r12 cover), 미지정 시 회색 placeholder.
   *  SavedStay 계약엔 없어(실측) 실데이터는 항상 미지정 → 회색 자리(INV-1, 값은 프리뷰만). */
  imageUrl?: string;
  /** 동네(표시용 문자열) — row 서브라인 접두 · vertical(e04) 지역줄. 값 있을 때만 렌더(degrade). */
  region?: string;
  /** 가격(표시용 문자열 "145,000원~") — row 는 단일 Text, vertical(e04)은 2톤(금액 ink + "~" muted).
   *  값 있을 때만 렌더(degrade). */
  priceLabel?: string;
  /** 거점 여부 — **vertical(e04) 전용**. true 면 사진 좌상단 "거점" 배지(TRIP-729). row(g02)는 무시. */
  isBase?: boolean;
}

// 거점 배지 핀(TRIP-729, Figma 1701:1195) — entities→features import 금지라 features 글리프
// (TripGlyphs.BaseBadgePinGlyph·StayGlyphs.MapPinGlyph)를 못 써 카드에 인라인으로 그린다. entities 는
// raw-hex 미스캔(카드 `#000000` shadow 선례와 동형)이라 흰색 리터럴이 안전하다. 색·모양은 어느 심판도
// 안 본다(*Glyphs fill 무심판 계열, ★1) — 6-b/TRIP-831 육안. MapPinGlyph 와 같은 벡터를 흰색·13px 로.
function BaseBadgePinGlyph(): ReactElement {
  return (
    <Svg width={13} height={13} viewBox="0 0 32 32" fill="none">
      <Path
        d="M26.6667 13.3333C26.6667 21.3333 16 29.3333 16 29.3333C16 29.3333 5.33333 21.3333 5.33333 13.3333C5.33333 10.5044 6.45714 7.79125 8.45753 5.79086C10.4579 3.79047 13.171 2.66667 16 2.66667C18.829 2.66667 21.5421 3.79047 23.5425 5.79086C25.5429 7.79125 26.6667 10.5044 26.6667 13.3333Z"
        stroke="#FFFFFF"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M16 17.3333C18.2091 17.3333 20 15.5425 20 13.3333C20 11.1242 18.2091 9.33333 16 9.33333C13.7909 9.33333 12 11.1242 12 13.3333C12 15.5425 13.7909 17.3333 16 17.3333Z"
        stroke="#FFFFFF"
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// e04 세로 카드 그림자 이관값 — className 으로 못 줘 style prop. shadowColor '#000000' 은 토큰화
// 대상 밖이라 raw-hex 가드 사정거리 밖(HomeScreen softCardShadow 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
} as const;

export function SavedStayCard({
  testID,
  name,
  subtitle,
  trailing,
  selected = false,
  layout,
  onPress,
  imageUrl,
  region,
  priceLabel,
  isBase = false,
}: SavedStayCardProps): ReactElement {
  if (layout === 'row') {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={onPress}
        className={`w-full flex-row items-center gap-md rounded-[12px] py-[10px] pl-[10px] pr-[14px] ${
          selected
            ? 'border-[1.5px] border-primary'
            : 'border border-hairline-strong'
        }`}
      >
        {/* 사진 — 지정 시 <Image>, 미지정 시 회색 placeholder(계약 공백, INV-1). */}
        {imageUrl !== undefined ? (
          <Image
            testID={`${testID}-photo`}
            source={{ uri: imageUrl }}
            resizeMode="cover"
            className="h-[56px] w-[56px] rounded-[12px]"
          />
        ) : (
          <View
            testID={`${testID}-photo-placeholder`}
            className="h-[56px] w-[56px] rounded-[12px] bg-surface-strong"
          />
        )}
        <View className="flex-1 gap-[2px]">
          <Text className="font-noto-bold text-card-title font-bold text-ink">
            {name}
          </Text>
          {/* 서브라인 = 동네 · 날짜(subtitle). 동네는 값 있을 때만(degrade). 거리 표시는 제거됨(기준점 미정·BE 미제공, 제품 결정 2026-09-17). */}
          <Text className="font-noto text-caption text-muted">
            {region !== undefined ? `${region} · ` : null}
            {subtitle}
          </Text>
          {/* 가격 줄 — 값 있을 때만(계약 공백이면 미렌더). */}
          {priceLabel !== undefined ? (
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {priceLabel}
            </Text>
          ) : null}
        </View>
        {trailing}
      </Pressable>
    );
  }

  // 2톤 가격(vertical 전용, TRIP-729) — "145,000원~" 를 금액(ink) + "~"(muted) 두 Text 형제로 가른다
  // (e03 StayDetailScreen 725 선례). 바깥이 반드시 View 라야 getByText('145,000원')·getByText('~') 가
  // 각각 매치된다(중첩·단일 Text 면 '145,000원~' 로 결합 집계돼 탈락, [[getByText 집계 경계]]).
  const priceAmount =
    priceLabel !== undefined ? priceLabel.replace(/~$/, '') : undefined;
  const priceHasSuffix = priceLabel !== undefined && priceLabel.endsWith('~');

  return (
    <Pressable
      testID={testID}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={cardShadow}
      className="mb-lg rounded-[12px] border border-hairline bg-canvas"
    >
      {/* 사진 자리 — 계약에 imageUrl 없음(INV-1), 회색 placeholder + 거점 배지·trailing 오버레이. */}
      <View className="h-[178px] w-full rounded-t-[12px] bg-surface-strong">
        {isBase ? (
          <View
            testID={`${testID}-base-badge`}
            className="absolute left-[12px] top-[12px] flex-row items-center gap-[5px] rounded-[8px] bg-primary py-[5px] pl-[10px] pr-[11px]"
          >
            <BaseBadgePinGlyph />
            <Text className="font-noto-bold text-micro font-bold text-on-primary">
              거점
            </Text>
          </View>
        ) : null}
        {trailing ? (
          <View className="absolute right-[12px] top-[12px]">{trailing}</View>
        ) : null}
      </View>
      <View className="gap-[3px] px-[14px] pb-[14px] pt-[13px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {name}
        </Text>
        {/* 지역줄 — 값 있을 때만(degrade). 거리 미표시(제품 결정 2026-09-17·계약 공백). */}
        {region !== undefined ? (
          <Text className="font-noto text-label text-muted">{region}</Text>
        ) : null}
        {/* 2톤 가격줄 — 값 있을 때만(degrade). */}
        {priceLabel !== undefined ? (
          <View className="flex-row items-baseline">
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {priceAmount}
            </Text>
            {priceHasSuffix ? (
              <Text className="font-noto text-caption text-muted">~</Text>
            ) : null}
          </View>
        ) : null}
        {subtitle}
      </View>
    </Pressable>
  );
}
