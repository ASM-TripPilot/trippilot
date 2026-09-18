import React from 'react';
import { View } from 'react-native';

/**
 * react-native-draggable-flatlist 수동 목(jest 규약: <rootDir>/__mocks__/<module>).
 * `jest.mock('react-native-draggable-flatlist')`로 활성한다 — node_modules(스코프) 패키지라
 * @gorhom/bottom-sheet·react-native-webview 목처럼 명시 호출이 필요하다(02a §5-E 실측).
 *
 * 실제 리스트는 reanimated/gesture-handler 네이티브 런타임에 의존해 jest에서 제스처를 발화할
 * 수 없다. 그래서:
 *  - `renderItem`을 **data마다 실제로 태워** 카드가 렌더되게 한다 → "화면이 리스트에 슬롯을
 *    넘겼다"가 카드 존재로 증명된다(02a ★5). `drag`는 무해 no-op, `getIndex`는 인덱스를 준다.
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

function MockDraggableFlatList<T>({
  data,
  keyExtractor,
  renderItem,
  ...rest
}: MockDraggableProps<T>) {
  const items = data ?? [];
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
                drag: () => {},
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
