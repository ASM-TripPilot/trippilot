import type { ReactElement } from 'react';
import { useContext } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { Button } from '@/shared/ui/Button';
import { useToastBottom } from '@/shared/ui/useToastBottom';

/**
 * TRIP-783 · 하단 고정 CTA 바(widgets · presentation-only). 1~2버튼 변형을 `buttons` prop 으로 받는다
 * (h08=2버튼 `다시 짜기`(outline)+`확정하기`(primary) / h14=1버튼 `일정 저장하기`(primary full)).
 * 라벨·콜백은 소비처 주입. 변형 스타일(primary=채움 / outline=테두리)은 className 토큰으로 잠긴다 —
 * className 은 jest 렌더 트리에 평문 prop 으로 남아 심판이 읽는다.
 */

export interface CtaButton {
  label: string;
  /** `ink` = 검정 바탕(TRIP-1791 선택 모드 「N곳 빼기」). */
  variant: 'primary' | 'outline' | 'ink';
  onPress: () => void;
  /** 비활성(TRIP-799 D6·AC-9). 참이면 CtaBar 가 `<Pressable disabled>`(+회색)로 렌더해 press 가
   *  onPress 를 안 부른다. 미전달=활성(기존 소비처 무변경). 렌더 배선은 아래 CtaBar 본문
   *  (CTA3 가 잠금). h14 PARTIAL 잠금이 이 값을 쓴다(isConfirmLocked). */
  disabled?: boolean;
  /** TRIP-1791 · 두 버튼 동폭(`flex-1`). 미전달=기존 폭. */
  fill?: boolean;
  /** TRIP-1791 · 주면 기본 `sheet-cta-button-{i}` 를 **대체**한다(한 요소에 testID 는 하나). */
  testID?: string;
}

export interface CtaBarProps {
  buttons: CtaButton[];
}

// CTA 바 높이 — pt-md(12) + 버튼 52 + pb-lg(16) + 윗선 ≈ 81.3pt(TRIP-1112 실기 실측)를 올림.
// 바가 시트 위에 떠 있으므로, 스크롤 끝 내용이 바 뒤에 숨지 않게 본문 하단 여백으로 쓴다(셸·편집기).
// 출처: 아래 바 className `pt-md`·`pb-lg` + 공용 Button `lg`(min-h 52)(토스트 바닥도 이 값 위로 뜬다 — TRIP-1559).
// jest 는 값을 잠그지 않으니 그 className 을 바꾸면 이 값도 맞추고 실화면(6-b)으로 확인.
export const CTA_BAR_HEIGHT = 82;

export function CtaBar({ buttons }: CtaBarProps): ReactElement {
  const single = buttons.length === 1;
  // 토스트가 이 바 위에 뜨게 신고한다(TRIP-1559). Provider 없는 렌더에선 인셋 0.
  useToastBottom(
    CTA_BAR_HEIGHT + (useContext(SafeAreaInsetsContext)?.bottom ?? 0)
  );

  return (
    <View
      testID="sheet-cta-root"
      className="flex-row gap-sm bg-canvas px-lg pb-lg pt-md"
    >
      <View className="absolute inset-x-0 top-0 h-px bg-hairline" />
      {buttons.map((button, index) => {
        // 모양·비활성(회색 한 종)은 공용 Button 이 정한다(TRIP-1828). 여기는 폭만 정한다.
        const filled = button.variant !== 'outline';
        const width = filled || single || button.fill ? 'flex-1' : 'w-[140px]';
        return (
          <Button
            key={button.label}
            testID={button.testID ?? `sheet-cta-button-${index}`}
            variant={
              button.variant === 'outline' ? 'secondary' : button.variant
            }
            onPress={button.onPress}
            disabled={button.disabled === true}
            className={width}
          >
            {button.label}
          </Button>
        );
      })}
    </View>
  );
}
