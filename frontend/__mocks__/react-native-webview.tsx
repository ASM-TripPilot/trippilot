import React from 'react';
import { View } from 'react-native';

// react-native-webview 수동 목(jest 규약: <rootDir>/__mocks__/<module>, M1 실측 —
// jest.mock() 호출 없이 모든 버킷·모든 테스트에 자동 적용된다).
// 네이티브 WebView는 iOS/Android 런타임에 의존하므로, 테스트에서는 props를 그대로 넘기는
// 통과 컴포넌트로 대체한다 — source·onError·onHttpError를 호스트 엘리먼트에서 그대로
// 관찰·발화할 수 있어야 한다(toHaveProp·props.onXxx() 직접 호출, KakaoMapView.test.tsx).
// 인라인 jest.mock 팩토리로 두면 NativeWind babel이 주입하는 `_ReactNativeCSSInterop`
// 참조가 out-of-scope로 걸리므로(함정 7), 모듈 스코프 파일로 분리한다
// (__mocks__/@gorhom/bottom-sheet.tsx·src/test-support/expoRouterTabsMock.tsx와 동형).
const Passthrough = React.forwardRef<unknown, { children?: React.ReactNode }>(
  ({ children, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({
      reload: () => {},
    }));
    return <View {...props}>{children}</View>;
  }
);
Passthrough.displayName = 'MockWebView';

export default Passthrough;
export const WebView = Passthrough;
