import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { HeartFilledGlyph } from './HeartGlyphs';

/**
 * 콜라주 빈 상태(TRIP-1050, Figma `1695:1183`·`1702:1183`) — 사진 3장 겹침 + 중앙 하트 원 +
 * 제목·본문 + 아이콘 CTA. 틀(배치·크기·간격·그림자)은 여기서 고정하고, 문구·CTA 아이콘·testID·
 * press 는 소비처가 넘긴다(shared 는 도메인을 모른다, README §65). 실사진은 에셋 라이선스·계약
 * 공백으로 회색 자리다. 겹침·z 순서·그림자 실제 모양은 jest 사각이라 6-b 육안 몫이다.
 *
 * 파생 testID: `{testID}-art` · `{testID}-photo-0/1/2` · `{testID}-heart`.
 */

export type CollageEmptyStateProps = {
  testID: string;
  title: string;
  /** 명시 줄바꿈(`\n`)을 포함할 수 있다 — Text 하나로 그린다. */
  description: string;
  ctaTestID: string;
  ctaLabel: string;
  /** 분홍 버튼 위에 그려지므로 소비처가 흰(on-primary) 글리프를 넘긴다. */
  ctaIcon: ReactNode;
  onPressCta?: () => void;
};

// 그림자 세 벌은 className 으로 못 줘 style prop. shadowColor '#000000' 은 raw-hex 가드의
// TOKENIZED_HEX 밖이다. 사진 = 킷 §3 작은 그림자, CTA = 카드 그림자, 하트 원 = 두 Figma 프레임 값.
const photoShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 2,
};
const heartShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.1,
  shadowRadius: 18,
  elevation: 6,
};
const ctaShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
};

export function CollageEmptyState({
  testID,
  title,
  description,
  ctaTestID,
  ctaLabel,
  ctaIcon,
  onPressCta,
}: CollageEmptyStateProps): ReactElement {
  return (
    <View
      testID={testID}
      className="w-full flex-1 items-center px-[28px] pt-[96px]"
    >
      {/* 겹침 기하는 절대좌표(장식 요소). 중앙(photo-1)을 마지막에 그려 양옆 위로 올린다. */}
      <View testID={`${testID}-art`} className="h-[170px] w-[320px]">
        <View
          testID={`${testID}-photo-0`}
          style={photoShadow}
          className="absolute left-[6px] top-[26px] h-[138px] w-[120px] rounded-[12px] border-[3px] border-canvas bg-surface-strong"
        />
        <View
          testID={`${testID}-photo-2`}
          style={photoShadow}
          className="absolute left-[194px] top-[26px] h-[138px] w-[120px] rounded-[12px] border-[3px] border-canvas bg-surface-strong"
        />
        <View
          testID={`${testID}-photo-1`}
          style={photoShadow}
          className="absolute left-[96px] top-[4px] h-[158px] w-[128px] items-center justify-center rounded-[12px] border-[3px] border-canvas bg-surface-soft"
        >
          <View
            testID={`${testID}-heart`}
            style={heartShadow}
            className="h-[52px] w-[52px] items-center justify-center rounded-pill bg-canvas"
          >
            <HeartFilledGlyph size={26} />
          </View>
        </View>
      </View>
      <Text className="mt-2xl text-center font-noto-bold text-[20px] font-bold text-ink">
        {title}
      </Text>
      <Text className="mt-[10px] text-center font-noto text-label leading-[21px] text-muted">
        {description}
      </Text>
      <Pressable
        testID={ctaTestID}
        accessibilityRole="button"
        onPress={onPressCta}
        style={ctaShadow}
        className="mt-2xl h-[52px] flex-row items-center justify-center gap-sm rounded-[12px] bg-primary pl-[22px] pr-2xl"
      >
        {ctaIcon}
        <Text className="font-noto-bold text-card-title font-bold text-on-primary">
          {ctaLabel}
        </Text>
      </Pressable>
    </View>
  );
}
