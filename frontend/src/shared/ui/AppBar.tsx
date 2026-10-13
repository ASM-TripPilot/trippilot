import { type ReactElement, type ReactNode } from 'react';
import { Pressable, type PressableProps, Text, View } from 'react-native';

// 뒤로 버튼 + 제목 한 줄짜리 앱바의 공용 틀(TRIP-1360). 화면마다 패딩·제목 크기·뒤로 버튼 칸이 Figma parity 티켓으로
// 제각각 맞춰져 있어(h-14 / pb-sm pl-[10px] / px-lg pt-[14px] …) **값은 소비처가 prop 으로 넘긴다** — 한 벌로
// 뭉개면 화면 픽셀이 바뀐다. 그림(글리프)·testID·접근성 문구도 소비처 몫이고, 이 틀은 배치(뒤로 | 제목 | 오른쪽)만 가진다.
// SafeArea 는 화면이 소유한다.

export interface AppBarBack {
  testID: string;
  onPress?: () => void;
  glyph: ReactNode;
  accessibilityLabel?: string;
  /** 'button' 을 명시한 화면만 역할을 단다(없는 화면은 그대로 둔다). */
  accessibilityRole?: 'button';
  hitSlop?: PressableProps['hitSlop'];
  className?: string;
}

export function AppBar({
  testID,
  className,
  back,
  title,
  titleClassName,
  right,
}: {
  testID?: string;
  /** 앱바 루트 className — 높이·패딩·간격은 화면 값 그대로. */
  className: string;
  back: AppBarBack;
  title: string;
  titleClassName: string;
  /** 있으면 제목 뒤에 `flex-1` 여백을 두고 맨 오른쪽에 그린다. */
  right?: ReactNode;
}): ReactElement {
  return (
    <View testID={testID} className={className}>
      <Pressable
        testID={back.testID}
        accessibilityRole={back.accessibilityRole}
        accessibilityLabel={back.accessibilityLabel}
        hitSlop={back.hitSlop}
        onPress={back.onPress}
        className={back.className}
      >
        {back.glyph}
      </Pressable>
      <Text className={titleClassName}>{title}</Text>
      {right === undefined ? null : (
        <>
          <View className="flex-1" />
          {right}
        </>
      )}
    </View>
  );
}
