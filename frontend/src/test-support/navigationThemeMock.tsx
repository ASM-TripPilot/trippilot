import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * `@react-navigation/native` 대역(테스트 인프라 — `AppProviders.test.tsx` 전용, 프로덕션 코드 아님).
 * 실물은 ESM 배포라 node 버킷 jest 가 못 읽는다. `ThemeProvider` 는 받은 value 를 호출 기록으로 남기고,
 * 자식을 표식 View 로 감싸 "테마가 화면 Stack 을 감싼다"는 배선을 `within` 으로 단언할 수 있게 한다.
 * 별도 파일인 이유는 `queryClientProbe.tsx` 와 같다(jest.mock 팩토리 안 RN 엘리먼트 금지).
 */
export const DefaultTheme = {
  dark: false,
  colors: { background: 'rgb(242, 242, 242)' },
};

export const ThemeProvider = jest.fn(
  ({ children }: { children: ReactNode }) => (
    <View testID="mock-theme-provider">{children}</View>
  )
);
