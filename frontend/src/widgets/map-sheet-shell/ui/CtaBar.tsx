import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

/**
 * TRIP-783 · 하단 고정 CTA 바(widgets · presentation-only). 1~2버튼 변형을 `buttons` prop 으로 받는다
 * (h08=2버튼 `다시 짜기`(outline)+`확정하기`(primary) / h14=1버튼 `일정 저장하기`(primary full)).
 * 라벨·콜백은 소비처 주입. 변형 스타일(primary=채움 / outline=테두리)은 className 토큰으로 잠긴다 —
 * className 은 jest 렌더 트리에 평문 prop 으로 남아 심판이 읽는다(loginVisual 선례).
 */

export interface CtaButton {
  label: string;
  variant: 'primary' | 'outline';
  onPress: () => void;
  /** 비활성(TRIP-799 D6·AC-9). 참이면 CtaBar 가 `<Pressable disabled>`(+회색)로 렌더해 press 가
   *  onPress 를 안 부른다. 미전달=활성(기존 소비처 무변경). 렌더 배선은 아래 CtaBar 본문
   *  (CTA3 가 잠금). h14 PARTIAL 잠금이 이 값을 쓴다(isConfirmLocked). */
  disabled?: boolean;
}

export interface CtaBarProps {
  buttons: CtaButton[];
}

export function CtaBar({ buttons }: CtaBarProps): ReactElement {
  const single = buttons.length === 1;

  return (
    <View
      testID="sheet-cta-root"
      className="flex-row gap-sm border-t border-hairline bg-canvas px-lg pb-lg pt-md"
    >
      {buttons.map((button, index) => {
        const primary = button.variant === 'primary';
        // 비활성이면 press 를 죽이고(Pressable disabled) primary 채움을 회색으로 바꾼다(TRIP-799 D6·AC-9).
        // `disabled` prop 이 press 를 막아 onPress 가 안 나가고, 회색은 눈으로 잠김을 알린다.
        const disabled = button.disabled === true;
        const shape = primary
          ? `flex-1 ${disabled ? 'bg-hairline-strong' : 'bg-primary'}`
          : `${single ? 'flex-1' : 'w-[140px]'} border border-hairline-strong bg-canvas`;
        return (
          <Pressable
            key={button.label}
            testID={`sheet-cta-button-${index}`}
            accessibilityRole="button"
            onPress={button.onPress}
            disabled={disabled}
            className={`h-[52px] items-center justify-center rounded-card ${shape}`}
          >
            <Text
              className={`font-noto-bold text-[16px] font-bold ${primary ? 'text-on-primary' : 'text-ink'}`}
            >
              {button.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
