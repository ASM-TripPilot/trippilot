import React from 'react';
import { View } from 'react-native';

/**
 * react-native-draggable-flatlist 수동 목(jest 규약: <rootDir>/__mocks__/<module>).
 * node_modules 패키지 수동 목이라 `jest.mock(...)` 호출 없이 **자동 적용**된다(TRIP-577 03b 참고-1 ·
 * TRIP-921 02a §5-A 실측 — 옛 주석의 "명시 호출 필요"는 실측과 반대였다).
 *
 * 실제 리스트는 reanimated/gesture-handler 네이티브 런타임에 의존해 jest에서 제스처를 발화할
 * 수 없다. 그래서:
 *  - `renderItem`을 **data마다 실제로 태워** 카드가 렌더되게 한다 → "화면이 리스트에 슬롯을
 *    넘겼다"가 카드 존재로 증명된다(02a ★5). `getIndex`는 인덱스를 준다.
 *  - `drag`는 실물처럼 `onDragBegin(index)`를 **동기로** 부른다(실물 DraggableFlatList.tsx 의
 *    drag → onDragBegin, TRIP-921 02a ★4) — 롱프레스가 끌기 시작으로 이어지는지를 관찰하려고.
 *    실제 손가락 이동·놓을 자리 계산은 없다. `isActive`는 항상 false(떠 있는 카드는 못 본다).
 *  - `drag`가 불린 칸 index 를 `__dragLog`에 쌓는다(TRIP-921 5-b 경고-2) — "뷰 상태만 켰다"와
 *    "라이브러리 끌기를 실제로 불렀다"를 구분하는 유일한 흔적. 테스트는
 *    `import * as M from 'react-native-draggable-flatlist'` 의 `M.__dragLog`로 읽고, 쓰기 전에 비운다
 *    (`jest.requireMock` 은 다른 인스턴스를 돌려줘 늘 빈 배열이다 — 5-b 실측).
 *  - `onDragEnd`(그리고 testID 등 나머지 props)를 호스트 View에 남겨, 테스트가
 *    `getByTestId('itinerary-edit-list').props.onDragEnd({data,from,to})`로 직접 발화한다
 *    (webview 목의 `onError` 직접 호출 선례와 동형).
 *
 * 인라인 jest.mock 팩토리로 두면 NativeWind babel이 주입하는 `_ReactNativeCSSInterop` 참조가
 * out-of-scope로 걸리므로(@gorhom·webview 목과 같은 함정), 모듈 스코프 파일로 분리한다.
 */

type RenderItemParams<T> = {
  item: T;
  getIndex: () => number | undefined;
  drag: () => void;
  isActive: boolean;
};

type MockDraggableProps<T> = {
  data?: T[];
  keyExtractor?: (item: T, index: number) => string;
  renderItem?: (params: RenderItemParams<T>) => React.ReactNode;
  [key: string]: unknown;
};

/** drag() 가 불린 칸 index 기록(모듈 단일 — 테스트가 `length = 0` 으로 비운다). */
export const __dragLog: number[] = [];

function MockDraggableFlatList<T>({
  data,
  keyExtractor,
  renderItem,
  ...rest
}: MockDraggableProps<T>) {
  const items = data ?? [];
  const onDragBegin = rest.onDragBegin as ((index: number) => void) | undefined;
  return (
    // rest 에 onDragEnd·testID 등이 남아 호스트 prop 으로 관찰·발화된다.
    <View {...rest}>
      {items.map((item, index) => (
        <React.Fragment
          key={keyExtractor ? keyExtractor(item, index) : String(index)}
        >
          {renderItem
            ? renderItem({
                item,
                getIndex: () => index,
                drag: () => {
                  __dragLog.push(index);
                  onDragBegin?.(index);
                },
                isActive: false,
              })
            : null}
        </React.Fragment>
      ))}
    </View>
  );
}

export default MockDraggableFlatList;

// 셀 데코레이터는 통과 래퍼(실물은 reanimated 애니메이션만 얹는다).
export const ScaleDecorator = ({
  children,
}: {
  children?: React.ReactNode;
}) => <>{children}</>;
export const OpacityDecorator = ({
  children,
}: {
  children?: React.ReactNode;
}) => <>{children}</>;
export const ShadowDecorator = ({
  children,
}: {
  children?: React.ReactNode;
}) => <>{children}</>;
export const NestableDraggableFlatList = MockDraggableFlatList;
export const NestableScrollContainer = ({
  children,
  ...rest
}: {
  children?: React.ReactNode;
  [key: string]: unknown;
}) => <View {...rest}>{children}</View>;
