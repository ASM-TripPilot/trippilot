import { setupServer } from 'msw/native';

import { handlers } from './handlers';

/**
 * RN dev 런타임용 MSW 서버(D2). msw/node(테스트)와 같은 handlers 1벌을 공유하며,
 * EXPO_PUBLIC_API_MOCK 이 켜진 dev 빌드에서 _layout 이 startMockServer() 로 시작한다 →
 * 백엔드 없이 axios 요청을 handlers 로 응답한다.
 *
 * R1(01b): msw/native 의 RN 인터셉트는 실기/시뮬에서 미검증이다(테스트는 msw/node 로 견고).
 * 런타임 인터셉트가 안 되면 폴백은 env fake seam 이며 겹2에서 상환한다. 매칭 안 된 요청은
 * bypass 로 실 네트워크에 흘려 dev 흐름을 막지 않는다.
 */
const server = setupServer(...handlers);

export function startMockServer(): void {
  server.listen({ onUnhandledRequest: 'bypass' });
}
