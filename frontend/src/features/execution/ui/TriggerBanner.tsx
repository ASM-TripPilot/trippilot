import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { WarningTriangleGlyph } from './ExecutionGlyphs';

/**
 * TRIP-561 · TriggerBanner(i01) — 영향 슬롯 카드 안 경고 줄.
 *
 * `[경고삼각형][본문]` 뿐 — **버튼·chevron·× 가 없다**(재계획 어포던스는 i08 칩 소관, 라이브
 * i01 실측). **순수 프레젠테이션**이다: `text` 는 페이지가 서버 reason 을 넣어 조립한 완성 문구라
 * 여기서 시각·소요시간을 만들지 않는다(BR-U4-35 · INV-3). 색은 토큰(`bg-primary-pale`·
 * `text-primary-text`), 아이콘 색은 글리프 raw(SVG className 불가 관례).
 */

export interface TriggerBannerProps {
  text: string;
  /** 없으면 공통 경고삼각형 폴백(3변형 모두 같은 leading). */
  icon?: ReactNode;
}

export function TriggerBanner({ text, icon }: TriggerBannerProps) {
  return (
    <View
      testID="execution-live-trigger-banner"
      className="mt-sm flex-row items-start gap-[6px] rounded-[10px] bg-primary-pale py-sm pl-[10px] pr-[11px]"
    >
      <View className="pt-[2px]">
        {icon ?? <WarningTriangleGlyph size={13} />}
      </View>
      <Text className="flex-1 font-noto text-caption text-primary-text">
        {text}
      </Text>
    </View>
  );
}
