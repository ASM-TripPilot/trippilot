import type { ReactElement } from 'react';
import { Pressable, View } from 'react-native';

/**
 * 공유 스위치 — DS `Toggle`(Figma `4464:1569`, 46×28 · 손잡이 22 · 여백 3). 도메인 무관 공용 부품.
 *
 * 세 모양: ON(primary 트랙·흰 손잡이 오른쪽) / OFF(hairline-strong 트랙·흰 손잡이 왼쪽) /
 * disabled(연회색 트랙·회색 손잡이 왼쪽). **disabled 가 checked 보다 우선한다** — OS 권한 거부인데
 * 켜진 색이 보이면 거짓 표시다. disabled 두 색(`#ECECEC`·`#C4C9CF`)은 토큰이 없다(스냅퍼 MISS).
 *
 * 접근성: role switch + `accessibilityState{checked,disabled}` + **real `disabled`** — state 만으로는
 * press 가 샌다(609 선례). 손잡이 testID 는 `${testID}-thumb`.
 */
export interface ToggleProps {
  testID: string;
  /** VoiceOver 가 읽는 스위치 이름(TRIP-991, 필수 — 라벨 없는 소비처를 tsc 가 막는다). 행 제목을 넘기고
   *  켜짐/꺼짐은 넣지 않는다(상태는 `accessibilityState.checked`). */
  accessibilityLabel: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}

export function Toggle({
  testID,
  accessibilityLabel,
  checked,
  disabled = false,
  onPress,
}: ToggleProps): ReactElement {
  const track = disabled
    ? 'items-start bg-[#ECECEC]'
    : checked
      ? 'items-end bg-primary'
      : 'items-start bg-hairline-strong';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-[28px] w-[46px] justify-center rounded-pill px-[3px] ${track}`}
    >
      <View
        testID={`${testID}-thumb`}
        className={`h-[22px] w-[22px] rounded-pill ${
          disabled ? 'bg-[#C4C9CF]' : 'bg-canvas'
        }`}
      />
    </Pressable>
  );
}
