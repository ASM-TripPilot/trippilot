import type { Trigger } from '@/shared/api/generated/schemas';

/**
 * TRIP-562 · scope 접기 — `LiveItineraryPage` 로컬 함수를 features/planb/model 로 승격(i09·라이브
 * 페이지 공용, 복제 대신 승격).
 *
 * 재계획 범위는 서버 계약상 `FULL_DAY`·`PARTIAL_SLOTS` 2종뿐(BR-U4-11). 트리거 scope 가 `FULL_DAY`
 * 면 그대로, 그 외(`PARTIAL_SLOTS`·`NONE`·null·필드 생략=undefined)는 전부 최소 침습 `PARTIAL_SLOTS`
 * 로 접는다 — [대안 보기] 가 이 값으로 세션을 연다.
 *
 * node-safe: RN 런타임을 import 하지 않는다(`import type` 만) — 구조가드가 node 환경에서 스캔.
 */
export function foldScope(
  scope: Trigger['scope']
): 'FULL_DAY' | 'PARTIAL_SLOTS' {
  return scope === 'FULL_DAY' ? 'FULL_DAY' : 'PARTIAL_SLOTS';
}
