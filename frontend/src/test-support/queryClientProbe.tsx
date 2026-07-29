import { View } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

/**
 * `SplashGate`를 대신할 QueryClient 관찰 프로브(테스트 인프라 —
 * `rootLayoutQueryProvider.test.tsx` 전용, 프로덕션 코드 아님).
 *
 * 왜 별도 모듈인가: `jest.mock`의 인라인 팩토리 안에서 RN 엘리먼트를 만들면 NativeWind babel이
 * 주입한 모듈 스코프 변수를 팩토리가 참조하게 되어 jest의 호이스트 규칙(out-of-scope 변수
 * 금지)을 위반한다 — `splashGateMock.tsx`와 같은 이유로 별도 파일을 둔다.
 *
 * 동작: `useQueryClient()`를 부르고 받은 인스턴스를 모듈 스코프 홀더에 담은 뒤, "렌더에
 * 도달했다"는 마커로 `<View testID="query-client-probe" />`를 그린다. `SplashGate`라는
 * 이름으로 export하는 이유: `jest.mock('@/app-shell/ui/SplashGate', () => require(...))`가
 * 심볼명으로 대체하므로 이름이 같아야 배선이 성립한다(`splashGateMock.tsx`가 같은 규약).
 *
 * `src/test-support/`는 `noMswInStaticGraph.test.ts`의 `TEST_ONLY_DIRS`에 들어 있어
 * 프로덕션 정적 그래프 스캔에서 제외된다 — 이 모듈이 `@tanstack/react-query`를 import해도
 * 그 가드에 걸리지 않는다.
 */

let observedQueryClient: QueryClient | null = null;

export function SplashGate() {
  observedQueryClient = useQueryClient();
  return <View testID="query-client-probe" />;
}

/** 관찰된 QueryClient 인스턴스를 읽는다(테스트 단언용). */
export function getObservedQueryClient(): QueryClient | null {
  return observedQueryClient;
}

/** `beforeEach`에서 홀더를 비운다 — 테스트 간 상태 누수 방지. */
export function resetObservedQueryClient(): void {
  observedQueryClient = null;
}
