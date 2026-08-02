/**
 * `empty`·`filter-zero`·`error` 3상태 공용 안내 블록(01b Seed §1·§3-6). 세 상태가 "원형 배지
 * 72px + 제목 + 부제 + 버튼 N"으로 같은 모양이라 마크업을 한 번만 짠다 — 다른 것은 아이콘·
 * 문구·버튼 개수·위계(variant)뿐이고, 그 차이는 전부 호출부(`StaySearchScreen.tsx`)가 prop으로
 * 넘긴다. `empty`만 점선 박스(`dashed`)를 두른다.
 */
import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

export interface StateNoticeAction {
  testID: string;
  label: string;
  variant: 'outline' | 'filled' | 'link';
  /** 미지정 = 정직한 스텁(Q7) — 목적지 라우트가 없는 버튼은 onPress를 아예 안 준다. */
  onPress?: () => void;
}

export interface StateNoticeProps {
  testID: string;
  icon: ReactElement;
  title: string;
  description: string;
  actions: StateNoticeAction[];
  dashed?: boolean;
}

function ActionButton({ action }: { action: StateNoticeAction }): ReactElement {
  if (action.variant === 'link') {
    return (
      <Pressable
        testID={action.testID}
        accessibilityRole="button"
        onPress={action.onPress}
        className="items-center justify-center py-xs"
      >
        <Text className="font-noto-bold text-label font-bold text-primary">
          {action.label}
        </Text>
      </Pressable>
    );
  }
  const filled = action.variant === 'filled';
  return (
    <Pressable
      testID={action.testID}
      accessibilityRole="button"
      onPress={action.onPress}
      className={`h-12 w-[200px] items-center justify-center rounded-button ${
        filled ? 'bg-primary' : 'border border-hairline-strong bg-canvas'
      }`}
    >
      <Text
        className={`font-noto-bold text-card-title font-bold ${
          filled ? 'text-on-primary' : 'text-ink'
        }`}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

export function StateNotice({
  testID,
  icon,
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
      <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-primary-pale">
        {icon}
      </View>
      <Text className="text-center font-noto-bold text-[16px] font-bold text-ink">
        {title}
      </Text>
      <Text className="text-center font-noto text-label text-muted">
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
