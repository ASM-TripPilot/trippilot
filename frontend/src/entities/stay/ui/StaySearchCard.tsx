import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { HeartFilledGlyph, HeartOutlineGlyph } from '@/shared/ui/HeartGlyphs';

/**
 * TRIP-807 · AC-3 — 숙소 검색 풀/레인 카드(e02 세로178 · d01·d05 레인200 공용). props-only.
 *
 * 사진은 계약(StayItem)에 URL 필드가 없어 항상 회색 자리(bg-surface-strong) — URL 을 지어내지
 * 않는다(INV-1). 메타는 이름·지역·가격 텍스트뿐(거리·소요시간 없음 · INV-3).
 *
 * testID 스킴은 소비처가 **명시 문자열**로 주입한다(★3) — e02 는 `stay-card-save-{key}-filled`,
 * d01 은 `explore-stay-heart-filled-{key}` 로 save/글리프 스킴이 갈려 단일 prefix 로 재현 불가라,
 * 카드가 완성된 testID(root/photo/save/filled/outline)를 받는다. 담김/미담김은 fill 색이 아니라
 * 서로 다른 글리프(HeartFilledGlyph/HeartOutlineGlyph) + accessibilityState.selected 로 관측한다
 * (글리프 fill 함정 회피). pending 이면 저장 Pressable 이 진짜 disabled(연타 가드).
 *
 * 카드 루트가 Pressable, 저장이 그 자식 Pressable — 하트 press 는 findEventHandler 가 하트에서
 * 멈춰 카드 push(onPress)를 삼키지 않는다(★F-4).
 */
export interface StaySearchCardSave {
  saved: boolean;
  pending?: boolean;
  onToggle: () => void;
  /** 저장 Pressable testID. */
  testID: string;
  /** 담김 글리프 testID. */
  filledTestID: string;
  /** 미담김 글리프 testID. */
  outlineTestID: string;
}

export interface StaySearchCardProps {
  /** 루트 Pressable testID(소비처 스킴 주입). */
  testID: string;
  /** 사진 자리 testID — e02 만 지정(d01·d05 미지정 = 사진 View 무 testID). */
  photoTestID?: string;
  name: string;
  region: string;
  priceText: string;
  /** full=e02(w-full·사진178·border+shadow) · rail=d01/d05(w-200·사진130). */
  variant: 'full' | 'rail';
  /** 저장 하트 — 지정 시에만 그린다(d05 는 미지정 = 하트 없음). */
  save?: StaySearchCardSave;
  /** 카드 탭(상세 진입) — 하트 press 가 삼키지 않는다. */
  onPress?: () => void;
}

// full variant 카드 그림자(e02 StayCard 이관값) — className 으로 못 줘 style prop 으로 옮긴다.
// shadowColor '#000000' 은 토큰화 대상 밖이라 raw-hex 가드 사정거리 밖(HomeScreen 선례).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 4,
} as const;

function SaveButton({
  save,
  size,
  className,
}: {
  save: StaySearchCardSave;
  size: number;
  className: string;
}): ReactElement {
  return (
    <Pressable
      testID={save.testID}
      accessibilityRole="button"
      // 담김=선택됨 — 빈/찬을 색이 아니라 이 상태 + 아래 글리프 정체성으로 관찰한다.
      accessibilityState={{ selected: save.saved }}
      // pending 이면 눌러도 onToggle 이 안 불린다(연타 가드) — disabled 가
      // accessibilityState.disabled 도 함께 세운다.
      disabled={save.pending}
      onPress={save.onToggle}
      className={className}
    >
      {save.saved ? (
        <HeartFilledGlyph testID={save.filledTestID} size={size} />
      ) : (
        <HeartOutlineGlyph testID={save.outlineTestID} size={size} />
      )}
    </Pressable>
  );
}

export function StaySearchCard({
  testID,
  photoTestID,
  name,
  region,
  priceText,
  variant,
  save,
  onPress,
}: StaySearchCardProps): ReactElement {
  if (variant === 'full') {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={onPress}
        style={cardShadow}
        className="w-full overflow-hidden rounded-card border border-hairline bg-canvas"
      >
        <View
          testID={photoTestID}
          className="h-[178px] w-full bg-surface-strong"
        >
          {save ? (
            <SaveButton
              save={save}
              size={22}
              className="absolute right-[32px] top-[14px] h-[28px] w-[30px] items-center justify-center"
            />
          ) : null}
        </View>
        <View className="w-full gap-xs px-[14px] pb-[14px] pt-md">
          <Text className="font-noto-bold text-[16px] font-bold text-ink">
            {name}
          </Text>
          <Text className="font-noto text-label text-muted">{region}</Text>
          <Text className="font-inter-bold text-[16px] font-bold text-ink">
            {priceText}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className="w-[200px]"
    >
      <View
        testID={photoTestID}
        className="h-[130px] w-full rounded-card bg-surface-strong"
      >
        {save ? (
          <SaveButton
            save={save}
            size={18}
            className="absolute right-sm top-sm h-8 w-8 items-center justify-center rounded-pill bg-on-primary"
          />
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        className="mt-sm font-noto-bold text-card-title font-bold text-ink"
      >
        {name}
      </Text>
      <Text numberOfLines={1} className="mt-xs font-noto text-label text-muted">
        {region}
      </Text>
      <Text className="mt-xs font-noto-bold text-card-title font-bold text-ink">
        {priceText}
      </Text>
    </Pressable>
  );
}
