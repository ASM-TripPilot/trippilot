import '../../global.css';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SplashGate } from '@/features/auth/containers/SplashGate';
import { startMockServer } from '@/mocks/native';

// dev mock 마스터 토글. 게이트가 부트스트랩을 마운트 즉시 호출하므로, 목은 컴포넌트 마운트 전
// (모듈 로드 시점)에 켜져 있어야 한다. 실 빌드에서는 꺼져 실 네트워크로 나간다.
if (process.env.EXPO_PUBLIC_API_MOCK === '1') {
  startMockServer();
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SplashGate />
    </GestureHandlerRootView>
  );
}
