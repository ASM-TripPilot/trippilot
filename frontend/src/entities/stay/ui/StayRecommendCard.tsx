import type { ReactElement } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * TRIP-800 · h15 동선 기준 추천 숙소 카드(props-only, Figma `4385:1731`). 사진 64 · 이름(+`추천` 배지) ·
 * 평균/최대 이동 거리 · `{구} · {가격대}` ↔ 가격. 문자열은 전부 소비처가 만들어 넘긴다(거리·가격 서식은
 * 화면이 `formatDistance`·`formatPrice` 로). 거리만 싣는다 — 소요시간 칸이 없다(INV-3).
 *
 * `SavedStayCard` 와 별도인 이유: 저장 숙소 degrade 카드는 계약 공백을 비우는 카드라 배지·거리 줄·
 * 선택 테두리가 없다. 선택은 색이 아니라 `accessibilityState.selected`(관측 가능)와 테두리를 **같은
 * 루트**에 함께 건다.
 */
export interface StayRecommendCardProps {
  testID: string;
  name: string;
  /** 번들 `require` 또는 `{ uri }`. 없으면 회색 자리. */
  imageSource?: ImageSourcePropType;
  /** 예 `평균 900m`. */
  avgLabel: string;
  /** 예 `최대 1.4km`. */
  maxLabel: string;
  /** 예 `해운대구 · 중간가`. */
  subtitle: string;
  /** 예 `120,000원~` · `가격 미확인`. */
  priceLabel: string;
  /** `추천` 배지 — 소비처가 정한다(서버 순서 첫 카드). 선택과 무관. */
  recommended: boolean;
  selected: boolean;
  onPress: () => void;
}

// Figma 카드 그림자 0 2 10 rgba(0,0,0,.06) — className 으로 못 줘 style prop(SavedStayCard cardShadow 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
} as const;

// 거리 줄 위치 핀(13, Figma `4388:1623`) — entities 는 features 글리프를 못 물어 인라인(SavedStayCard
// BaseBadgePinGlyph 선례). 색 muted-soft.
function DistancePinGlyph(): ReactElement {
  return (
    <Svg width={13} height={13} viewBox="0 0 13 13" fill="none">
      <Path
        d="M10.8337 5.41634C10.8337 8.66634 6.50033 11.9163 6.50033 11.9163C6.50033 11.9163 2.16699 8.66634 2.16699 5.41634C2.16699 4.26707 2.62354 3.16487 3.4362 2.35221C4.24885 1.53955 5.35105 1.08301 6.50033 1.08301C7.6496 1.08301 8.7518 1.53955 9.56446 2.35221C10.3771 3.16487 10.8337 4.26707 10.8337 5.41634Z"
        stroke="#9AA1AB"
        strokeWidth={1.08333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M6.5 7.04199C7.39746 7.04199 8.125 6.31446 8.125 5.41699C8.125 4.51953 7.39746 3.79199 6.5 3.79199C5.60254 3.79199 4.875 4.51953 4.875 5.41699C4.875 6.31446 5.60254 7.04199 6.5 7.04199Z"
        stroke="#9AA1AB"
        strokeWidth={1.08333}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function StayRecommendCard({
  testID,
  name,
  imageSource,
  avgLabel,
  maxLabel,
  subtitle,
  priceLabel,
  recommended,
  selected,
  onPress,
}: StayRecommendCardProps): ReactElement {
  // Figma 가격은 숫자 Inter + "원" Noto 2폰트. 한 Text 안의 중첩 Text 라 전체 문자열은 그대로 한 덩어리다.
  const wonPrice = priceLabel.endsWith('원~');

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={cardShadow}
      className={`h-[100px] w-full flex-row items-center gap-md rounded-[12px] bg-canvas py-md pl-md pr-[14px] ${
        selected ? 'border-[1.5px] border-primary' : 'border border-hairline'
      }`}
    >
      {imageSource !== undefined ? (
        <Image
          source={imageSource}
          resizeMode="cover"
          className="h-[64px] w-[64px] rounded-[12px]"
        />
      ) : (
        <View className="h-[64px] w-[64px] rounded-[12px] bg-surface-strong" />
      )}
      <View className="flex-1 gap-[6px]">
        <View className="w-full flex-row items-center gap-[7px]">
          <Text
            numberOfLines={1}
            className="flex-1 font-noto-bold text-card-title font-bold text-ink"
          >
            {name}
          </Text>
          {recommended ? (
            <View className="rounded-[12px] bg-primary-pale px-sm py-[3px]">
              <Text className="font-noto-bold text-micro font-bold text-primary">
                추천
              </Text>
            </View>
          ) : null}
        </View>
        <View className="flex-row items-center gap-[7px]">
          <View className="flex-row items-center gap-xs">
            <DistancePinGlyph />
            <Text className="font-noto-bold text-caption font-bold text-ink">
              {avgLabel}
            </Text>
          </View>
          <Text className="font-noto text-caption text-muted">{maxLabel}</Text>
        </View>
        <View className="w-full flex-row items-center gap-sm">
          <Text
            numberOfLines={1}
            className="flex-1 font-noto text-caption text-muted"
          >
            {subtitle}
          </Text>
          {wonPrice ? (
            <Text className="font-inter-bold text-label font-bold text-ink">
              {priceLabel.slice(0, -2)}
              <Text className="font-noto-bold">원</Text>~
            </Text>
          ) : (
            <Text className="font-noto-bold text-label font-bold text-ink">
              {priceLabel}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
