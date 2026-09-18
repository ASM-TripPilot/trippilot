import React from 'react';
import { View } from 'react-native';

// @gorhom/bottom-sheet 수동 목(jest 규약: <rootDir>/__mocks__/<module>).
// 실제 시트는 reanimated/gesture-handler 네이티브 런타임에 의존하므로 테스트에서는
// children 을 그대로 렌더하는 통과 컴포넌트로 대체한다 — 시트의 "마운트 여부"만 관찰한다.
// 인라인 jest.mock 팩토리로 두면 NativeWind babel 이 주입하는 _ReactNativeCSSInterop
// 참조가 out-of-scope 로 걸리므로, 모듈 스코프 파일로 분리한다.
//
// backdropComponent 확장(TRIP-352): 실제 <BottomSheet> 는 딤(backdrop)을 라이브러리
// 기본값으로 그리지 않는다 — 화면이 backdropComponent 를 명시해야 딤이 생긴다. 이전 목은
// 이 prop 을 렌더하지 않아(children 만) 딤이 테스트 트리에 아예 안 나타났다. 여기서 그 prop
// 을 받아 실제로 렌더한다 — 화면이 넘긴 커스텀 딤(testID=auth-sheet-backdrop)이 트리에 뜨게
// 해서 jest 가 딤의 존재/부재/토큰을 관찰할 수 있게 한다. 실제 라이브러리처럼 시트 콘텐츠
// **뒤에** 그린다(children 앞에 배치). 목은 애니메이션 prop 을 넘기지 않으므로, 딤 컴포넌트는
// prop 없이도 자기 노드를 렌더해야 한다.
const Passthrough = React.forwardRef<
  unknown,
  {
    children?: React.ReactNode;
    backdropComponent?: React.ComponentType<Record<string, unknown>>;
  }
>(({ children, backdropComponent: Backdrop, ...props }, ref) => {
  React.useImperativeHandle(ref, () => ({
    present: () => {},
    dismiss: () => {},
    close: () => {},
    expand: () => {},
    collapse: () => {},
  }));
  return (
    <View {...props}>
      {Backdrop ? <Backdrop /> : null}
      {children}
    </View>
  );
});
Passthrough.displayName = 'MockBottomSheet';

export default Passthrough;
export const BottomSheet = Passthrough;
export const BottomSheetModal = Passthrough;
export const BottomSheetView = Passthrough;
export const BottomSheetModalProvider = Passthrough;
export const BottomSheetBackdrop = Passthrough;
export const BottomSheetScrollView = Passthrough;
export const useBottomSheetModal = () => ({
  dismiss: () => {},
  dismissAll: () => {},
});
