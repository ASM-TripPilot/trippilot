/**
 * 취향 선택 알약 칩 shell (TRIP-610 승격) — id-agnostic 순수 프레젠테이션, 아이콘 없음.
 *
 * 온보딩 `PrefStep2Screen` 의 로컬 `Chip`(활동·음식)을 여기로 올려, l05 취향 수정 화면
 * (`PreferencesEditScreen`)이 전 축을 칩형으로 재사용한다(설정엔 옵션 글리프가 없어 칩형이 정답 —
 * 02a §4-★D-glyph 가 아이콘 없는 편집 화면을 허용). 선택은 `bg-primary` 색 전환으로만 보이고,
 * 관찰 계약은 `accessibilityState.selected`(온보딩 칩 그대로 — `toBeSelected()` 가 이걸 본다).
 *
 * 호출자가 완성된 `testID` 문자열을 준다(칩이 조립하지 않음 — 온보딩 `onboarding-pref2-activity-<slug>`,
 * 설정 `settings-pref-<axis>-<한국어값>`).
 */
import type { ReactElement } from 'react';
import { Pressable, Text } from 'react-native';

export interface PrefChipProps {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function PrefChip({
  testID,
  label,
  selected,
  onPress,
}: PrefChipProps): ReactElement {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`items-center justify-center rounded-pill px-[15px] py-[9px] ${
        selected ? 'bg-primary' : 'border border-hairline bg-canvas'
      }`}
    >
      <Text
        className={
          selected
            ? 'font-noto-bold text-[13.5px] font-bold text-on-primary'
            : 'font-noto text-[13.5px] text-ink'
        }
      >
        {label}
      </Text>
    </Pressable>
  );
}
