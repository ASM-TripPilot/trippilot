/**
 * `empty`·`filter-zero`·`error` 3상태 공용 안내 블록(01b Seed §1·§3-6). 세 상태가 "원형 배지
 * 72px + 제목 + 부제 + 버튼 N"으로 같은 모양이라 마크업을 한 번만 짠다 — 다른 것은 아이콘·
 * 문구·버튼 개수·위계(variant)뿐이고, 그 차이는 전부 호출부(`StaySearchScreen.tsx`)가 prop으로
 * 넘긴다. `empty`만 점선 박스(`dashed`)를 두른다.
 */
import type { ReactElement, ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button } from '@/shared/ui/Button';

export interface StateNoticeAction {
  testID: string;
  label: string;
  variant: 'outline' | 'filled' | 'link';
  /** 미지정 = 정직한 스텁(Q7) — 목적지 라우트가 없는 버튼은 onPress를 아예 안 준다. */
  onPress?: () => void;
  /** 미지정=활성(TRIP-726 F-9). 완화할 대상이 없는 등 눌러도 무의미한 버튼을 숨기지 않고
   * 비활성으로 보여줄 때 true — 진짜 `disabled` 로 넘긴다(블록 버튼은 Button 회색, link 는 opacity-40). */
  disabled?: boolean;
}

/** `icon`·`illustration` 중 정확히 하나 — 판별 유니온으로 강제한다(TRIP-223 03b W-1). 두
 * 슬롯을 그냥 옵셔널로 두면 호출부가 둘 다 빠뜨려도 tsc가 안 운다(아이콘 배지가 조용히
 * 사라진다) — `?: never` 짝이 "둘 다 없음"과 "둘 다 있음"을 타입 에러로 되돌린다. */
type StateNoticeVisual =
  | { icon: ReactElement; illustration?: never }
  | { icon?: never; illustration: ReactNode };

export type StateNoticeProps = StateNoticeVisual & {
  testID: string;
  title: string;
  description: string;
  actions: StateNoticeAction[];
  dashed?: boolean;
};

function ActionButton({ action }: { action: StateNoticeAction }): ReactElement {
  if (action.variant === 'link') {
    // link 는 블록 버튼이 아니라 글자 버튼 — disabled 면 흐림(opacity-40) + 실제 비활성 둘 다.
    const dimmed = action.disabled ? ' opacity-40' : '';
    return (
      <Pressable
        testID={action.testID}
        accessibilityRole="button"
        onPress={action.onPress}
        disabled={action.disabled}
        className={`items-center justify-center py-xs${dimmed}`}
      >
        <Text className="font-noto-bold text-label font-bold text-primary">
          {action.label}
        </Text>
      </Pressable>
    );
  }
  // 블록 버튼은 공용 Button(TRIP-1828) — 비활성은 opacity-40 대신 회색 한 종이다.
  return (
    <Button
      testID={action.testID}
      size="md"
      variant={action.variant === 'filled' ? 'primary' : 'secondary'}
      onPress={action.onPress}
      disabled={action.disabled}
      className="w-[200px]"
    >
      {action.label}
    </Button>
  );
}

export function StateNotice({
  testID,
  icon,
  illustration,
  title,
  description,
  actions,
  dashed = false,
}: StateNoticeProps): ReactElement {
  return (
    <View
      testID={testID}
      className={`w-full items-center gap-md rounded-card px-lg py-3xl ${
        dashed ? 'border-[1.5px] border-dashed border-hairline-strong' : ''
      }`}
    >
      {illustration ??
        (icon ? (
          <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-primary-pale">
            {icon}
          </View>
        ) : null)}
      <Text className="text-center font-noto-bold text-[16px] font-bold text-ink">
        {title}
      </Text>
      <Text
        className="text-center font-noto text-label text-muted"
        lineBreakStrategyIOS="hangul-word"
      >
        {description}
      </Text>
      <View className="gap-[10px]">
        {actions.map((action) => (
          <ActionButton key={action.testID} action={action} />
        ))}
      </View>
    </View>
  );
}
