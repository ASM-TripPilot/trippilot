import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { COLOR_TOKENS } from '@/shared/config';
import { respectPressGuard, usePressLock } from '@/shared/lib/pressGuard';

/**
 * 공용 블록 버튼(TRIP-1828) — 크기·색·비활성·연타 막기를 한 곳에서 정한다. 값의 근거는 Figma DS `Button`(`4473:2884`:
 * 52 · r12 · 16 Bold). DS 에 disabled·loading 변형이 없어 비활성은 화면 손그림 다수값(#EDEDED = `hairline`)을 따른다.
 *
 * 누름 규칙:
 * - 창은 **따르기만** 한다(`respectPressGuard`) — 열린 창·화면 전환 중엔 무시하고, 자기 누름은 창을 열지 않는다.
 *   창을 열어야 하는 이동 버튼은 호출부가 지금처럼 `guardPress(…)` 로 감싸 넘긴다(두 번 감싸면 0회가 되는 함정 회피).
 * - `onPress` 가 Promise 를 돌려주면 끝날 때까지(성공·실패 둘 다) 잠금을 쥐고 busy 로 그린다. void 면 잠금 없음.
 */

export type ButtonSize = 'lg' | 'md';
export type ButtonVariant = 'primary' | 'secondary' | 'ink';

// 임의값 px 로 적는다 — 이 앱 NativeWind rem 은 14 라 `min-h-12`(3rem)는 42 로 그려진다(6-b 실측).
const SIZE_BOX = { lg: 'min-h-[52px]', md: 'min-h-[48px]' } as const;
const SURFACE = {
  primary: 'bg-primary',
  secondary: 'border border-hairline-strong bg-canvas',
  ink: 'bg-ink',
} as const;
const LABEL = {
  primary: 'text-on-primary',
  secondary: 'text-ink',
  ink: 'text-on-primary',
} as const;
const SPINNER = {
  primary: COLOR_TOKENS['on-primary'],
  secondary: COLOR_TOKENS.ink,
  ink: COLOR_TOKENS['on-primary'],
} as const;

/** 버튼 모양 클래스. Button 으로 못 옮기는 행(글리프 children·보이기만 비활성)이 Pressable 에 직접 단다. */
export function buttonClasses({
  size = 'lg',
  variant = 'primary',
  disabled = false,
}: {
  size?: ButtonSize;
  variant?: ButtonVariant;
  disabled?: boolean;
}): { box: string; label: string } {
  // 비활성은 변형과 무관하게 한 종이다.
  const surface = disabled ? 'bg-hairline' : SURFACE[variant];
  const text = disabled ? 'text-muted-soft' : LABEL[variant];
  return {
    box: `${SIZE_BOX[size]} items-center justify-center rounded-button ${surface}`,
    label: `text-center font-noto-bold text-[16px] font-bold ${text}`,
  };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

interface ButtonProps {
  children: string;
  /** 없으면 눌러도 아무 일이 없다(예전 Pressable 과 같다 — 프리뷰·선택 콜백 화면). */
  onPress?: () => void | Promise<unknown>;
  size?: ButtonSize;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  /** 배치 전용(flex-1·w-full·여백) — 모양은 넣지 않는다. */
  className?: string;
}

export function Button({
  children,
  onPress,
  size = 'lg',
  variant = 'primary',
  disabled = false,
  loading = false,
  testID,
  accessibilityLabel,
  className,
}: ButtonProps): ReactElement {
  const lock = usePressLock();
  const [pending, setPending] = useState(false);
  const busy = loading || pending;
  const inert = disabled || busy;
  const classes = buttonClasses({ size, variant, disabled });
  // 가로 여백은 Button 만 진다 — 탈출구 행은 자기 pl/pr 를 쓰므로 buttonClasses 에 넣으면 충돌한다.
  // 12 인 이유: 칸이 정해진 버튼(확인창 두 칸 136·OTA 시트 375 폭)의 가장 긴 글자가 아직 한 줄에 든다.
  const box = `${classes.box} min-w-[44px] px-md`;
  const { label } = classes;

  const handlePress = respectPressGuard(() => {
    // 잠금은 상태가 아니라 누르는 순간 쥔다 — 다시 그리기 전 같은 틱 둘째 누름도 막는다.
    if (!lock.acquire()) return;
    let result: unknown;
    try {
      result = onPress?.();
    } catch (error) {
      lock.release();
      throw error;
    }
    if (!isThenable(result)) {
      lock.release();
      return;
    }
    setPending(true);
    const done = (): void => {
      lock.release();
      setPending(false);
    };
    // 실패도 같은 길로 풀고, 거절은 여기서 받아 "처리 안 된 거절"을 만들지 않는다(알림은 호출부 몫).
    result.then(done, done);
  });

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={handlePress}
      className={className ? `${box} ${className}` : box}
    >
      {/* 진행 중에도 글자는 남긴다(폭 유지 + 낭독 이름). 스피너는 그 위에 겹친다. */}
      <Text className={busy ? `${label} opacity-0` : label}>{children}</Text>
      {busy ? (
        <View
          pointerEvents="none"
          className="absolute inset-0 items-center justify-center"
        >
          <ActivityIndicator
            color={disabled ? COLOR_TOKENS['muted-soft'] : SPINNER[variant]}
          />
        </View>
      ) : null}
    </Pressable>
  );
}
