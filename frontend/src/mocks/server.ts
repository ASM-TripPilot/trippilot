import { setupServer } from 'msw/node';

import { handlers } from './handlers';

/**
 * jest 통합테스트용 MSW 노드 서버(테스트 인프라).
 *
 * *(개념)* `setupServer(...handlers)` (msw/node): Node 환경에서 HTTP 요청을 가로채는 서버.
 * 테스트가 `server.listen()` 으로 켜고 `server.close()` 로 끈다 → 그 사이의 실제 axios 호출이
 * handlers 로 응답된다(백엔드 불필요). RN dev 런타임용 msw/native 배선은 구현자 몫(D2).
 */
export const server = setupServer(...handlers);
