/**
 * 시계(`Date`)만 고정하는 가짜 타이머 헬퍼(TRIP-1350). `jest.useFakeTimers({ now })` 는 `setTimeout` 까지 가짜로 바꿔
 * MSW·`findBy*`·react-query 알림이 멈추므로, `Date` 외 모든 타이머 API 를 진짜로 남겨 둔다 — 리포 여러 파일이 같은
 * `doNotFake` 14종 목록을 복사해 쓰던 것이다.
 *
 * 부르는 쪽이 `afterEach(() => jest.useRealTimers())` 로 되돌린다.
 */

/** `Date` 만 빼고 jest 가 가짜로 만들 수 있는 타이머 API 전부. */
export const REAL_TIMER_APIS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

/** 지금 시각을 `iso`(예: `'2026-06-11T03:00:00Z'`)로 고정한다. */
export function freezeDate(iso: string): void {
  jest.useFakeTimers({ now: new Date(iso), doNotFake: [...REAL_TIMER_APIS] });
}
