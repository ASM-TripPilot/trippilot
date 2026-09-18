import type { ReactElement, ReactNode } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

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
  /** 동네(표시용 문자열) — **row 전용**. 서브라인 접두, 값 있을 때만 렌더(degrade). */
  region?: string;
  /** 가격(표시용 문자열 "165,000원~") — **row 전용**. 가격 줄, 값 있을 때만 렌더(degrade). */
  priceLabel?: string;
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

  return (
    <Pressable
      testID={testID}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={cardShadow}
      className="mb-lg rounded-card border border-hairline bg-canvas"
    >
      {/* 사진 자리 — 계약에 imageUrl 없음(INV-1), 회색 placeholder + trailing 오버레이. */}
      <View className="h-[178px] w-full rounded-t-card bg-surface-strong">
        {trailing ? (
          <View className="absolute right-[14px] top-[14px]">{trailing}</View>
        ) : null}
      </View>
      <View className="gap-xs px-[14px] pb-[14px] pt-[13px]">
        <Text className="font-noto-bold text-card-title font-bold text-ink">
          {name}
        </Text>
        {subtitle}
      </View>
    </Pressable>
  );
}
