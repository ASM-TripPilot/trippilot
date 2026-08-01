import React from 'react';
import { View } from 'react-native';

// @gorhom/bottom-sheet 수동 목(jest 규약: <rootDir>/__mocks__/<module>).
// 실제 시트는 reanimated/gesture-handler 네이티브 런타임에 의존하므로 테스트에서는
// children 을 그대로 렌더하는 통과 컴포넌트로 대체한다 — 시트의 "마운트 여부"만 관찰한다.
// 인라인 jest.mock 팩토리로 두면 NativeWind babel 이 주입하는 _ReactNativeCSSInterop
// 참조가 out-of-scope 로 걸리므로, 모듈 스코프 파일로 분리한다.
const Passthrough = React.forwardRef<unknown, { children?: React.ReactNode }>(
  ({ children, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({
      present: () => {},
      dismiss: () => {},
      close: () => {},
      expand: () => {},
      collapse: () => {},
    }));
    return <View {...props}>{children}</View>;
  }
);
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
