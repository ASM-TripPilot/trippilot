import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ChevronRightGlyph } from './AssistantSheetGlyphs';

/**
 * 도우미 시트 카드의 공용 외곽선 껍데기(TRIP-1528) — 흰 바탕 + hairline 1 + 반경 12, 안쪽은 잘라 낸다.
 * 반경 12 는 브래킷이다: 코드 토큰 `rounded-card` 는 16 이라 Figma(12)와 4 어긋나고, 킷 §3 이 "card=12 는
 * Figma 가 먼저, 토큰 동기화는 별 티켓"이라 적은 그 드리프트다.
 */
const SHELL = 'overflow-hidden rounded-[12px] border border-hairline bg-canvas';

export function OutlineCard({
  testID,
  className = '',
  children,
}: {
  testID?: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <View testID={testID} className={`${SHELL} ${className}`}>
      {children}
    </View>
  );
}

/**
 * 외곽선 한 줄 행 카드 — 행 전체가 터치 영역이다.
 * 기본(링크 행) = 라벨 Bold 14 primary-text + 붉은 chevron. `icon` 을 주면 아이콘 행(여행 없음, TRIP-1529) =
 * 앞 아이콘 + 라벨 ink 15 Bold + 회색 chevron.
 */
export function ActionRow({
  testID,
  label,
  onPress,
  icon,
  iconTestID,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  iconTestID?: string;
}): ReactElement {
  const withIcon = icon != null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      className={`${SHELL} flex-row items-center py-md pr-md ${
        // 아이콘 행: 간격 12 · 왼쪽 14 는 토큰에 없는 Figma 값(5027:5814)
        withIcon ? 'gap-[12px] pl-[14px]' : 'gap-sm pl-lg'
      }`}
    >
      {withIcon ? <View testID={iconTestID}>{icon}</View> : null}
      <Text
        className={
          withIcon
            ? 'flex-1 font-noto-bold text-[15px] font-bold leading-[20px] text-ink'
            : 'flex-1 font-noto-bold text-body font-bold text-primary-text'
        }
      >
        {label}
      </Text>
      <ChevronRightGlyph size={20} color={withIcon ? '#6A6A6A' : '#C13515'} />
    </Pressable>
  );
}
