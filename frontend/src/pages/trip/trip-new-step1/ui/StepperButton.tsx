import { type ReactElement } from 'react';
import { Pressable } from 'react-native';

/**
 * 스테퍼 원버튼(흰 배경 · 테두리 · pill · 36×36) — 비활성이면 opacity 로 죽인다.
 * `CompanionEditSheet`(인원)·`DestinationEditSheet`(박 수)가 같이 쓴다(TRIP-1360 — 두 파일의 로컬 사본을 1벌로).
 */
export function StepperButton({
  testID,
  disabled,
  onPress,
  children,
}: {
  testID: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactElement;
}): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`h-9 w-9 items-center justify-center rounded-pill border border-hairline-strong bg-canvas ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      {children}
    </Pressable>
  );
}
