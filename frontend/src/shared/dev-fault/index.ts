/**
 * 실패 주입 — 개발 빌드 전용. 운영 코드는 이 모듈을 `if (__DEV__ …) require()` 로만 문다(상수 접기로 운영 그래프에서 사라짐).
 * 남으면 `metro.config.js` 운영 blockList 가 export 를 깨뜨리고, `scripts/bundle-report.cjs` 가 소스맵에서 잡는다.
 */
export { FaultInjectionBadge } from './FaultInjectionBadge';
export { installFaultInjection } from './interceptor';
export { faultStore } from './store';
export type { FaultLinkAction, FaultLinkParams, FaultRule } from './rules';
