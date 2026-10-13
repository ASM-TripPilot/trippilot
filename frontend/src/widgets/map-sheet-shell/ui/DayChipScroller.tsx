import { Children, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

/**
 * TRIP-1260 · 일차 칩 줄 가로 스크롤(widgets · presentation-only). 칩은 손대지 않고 감싸기만 한다 —
 * 6일 이상이면 화면 밖 칩에 닿게 밀 수 있고, 선택 칩이 화면 밖이면 그 칩이 보이게 스크롤한다(왼쪽 여백 16).
 * 칩 x 는 칩마다 감싼 host View 의 onLayout 으로 모은다(함수 컴포넌트 prop 은 기기에서 버려질 수 있다).
 */

function reveal(scroll: ScrollView | null, chipX: number): void {
  scroll?.scrollTo({ x: Math.max(0, chipX - 16), animated: true });
}

export interface DayChipScrollerProps {
  /** 선택된 칩의 순번 — children 순서 기준, 0부터. 맞는 칩이 없으면(-1 등) 스크롤하지 않는다. */
  selectedIndex: number;
  children: ReactNode;
}

export function DayChipScroller({
  selectedIndex,
  children,
}: DayChipScrollerProps): ReactElement {
  const scrollRef = useRef<ScrollView>(null);
  const chipX = useRef<number[]>([]);

  useEffect(() => {
    const x = chipX.current[selectedIndex];
    if (x !== undefined) reveal(scrollRef.current, x);
  }, [selectedIndex]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      alwaysBounceHorizontal={false}
      keyboardShouldPersistTaps="handled"
      className="grow-0"
      contentContainerClassName="gap-sm"
    >
      {Children.map(children, (child, index) => (
        <View
          onLayout={(event) => {
            const { x } = event.nativeEvent.layout;
            chipX.current[index] = x;
            if (index === selectedIndex) reveal(scrollRef.current, x);
          }}
        >
          {child}
        </View>
      ))}
    </ScrollView>
  );
}
