import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import * as Sentry from '@sentry/react-native';

import type { SentryTracing } from './initSentry';

type Props = { tracing: SentryTracing | null; children: ReactNode };

function Passthrough({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

function TracedRoot({
  tracing,
  children,
}: {
  tracing: SentryTracing;
  children: ReactNode;
}) {
  // expo-router 는 추적이 켜졌을 때만 불러온다 — 정적 import 면 이 파일을 쓰는 AppProviders 테스트가 로드 단계에서 깨진다(02a §5).
  const { useNavigationContainerRef } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-router') as typeof import('expo-router');
  const navigationRef = useNavigationContainerRef();
  // 렌더마다 wrap 하면 컴포넌트 타입이 바뀌어 앱 전체가 다시 마운트된다 — 처음 한 번만 만든다.
  const [Wrapped] = useState(
    () => Sentry.wrap(Passthrough) as ComponentType<{ children?: ReactNode }>
  );

  // 렌더 중이 아니라 effect — 컨테이너가 마운트되며 ref.current 를 채운 뒤에 등록해야 SDK 가 잡는다.
  useEffect(() => {
    tracing.navigation.registerNavigationContainer(navigationRef);
  }, [tracing, navigationRef]);

  return <Wrapped>{children}</Wrapped>;
}

/**
 * 앱 최상위를 Sentry 에 연결한다(TRIP-1743 M-2). 추적이 켜졌을 때(`tracing` 이 null 이 아닐 때)만 `Sentry.wrap` 으로 감싸
 * "앱 시작 끝"을 알리고 화면 이동 추적에 expo-router 컨테이너를 등록한다. 꺼졌으면 자식을 그대로 그린다.
 */
export function SentryRoot({ tracing, children }: Props) {
  if (!tracing) return <>{children}</>;
  return <TracedRoot tracing={tracing}>{children}</TracedRoot>;
}
