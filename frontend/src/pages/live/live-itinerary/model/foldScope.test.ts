/**
 * @jest-environment node
 */
import type { Trigger } from '@/shared/api/generated/schemas';

import { foldScope } from './foldScope';

/**
 * TRIP-562 · AC-2 보조 — scope 접기(승격). `LiveItineraryPage` 로컬 함수를 features/planb/model 로
 * 승격해 i09·라이브 페이지가 공유한다(복제 대신 승격).
 *
 * 무엇을 보장하나: 재계획 범위는 서버 계약상 `FULL_DAY`·`PARTIAL_SLOTS` 2종뿐(BR-U4-11). 트리거
 * scope 가 `FULL_DAY` 면 그대로, 그 외(`PARTIAL_SLOTS`·`NONE`·null·필드 생략=undefined)는 전부
 * 최소 침습 `PARTIAL_SLOTS` 로 접는다 — [대안 보기]가 이 값으로 세션을 연다.
 *
 * node-safe 잠금(`@jest-environment node`): 순수 함수라 RN 을 안 문다.
 */

// TS 상 undefined 도 넣기 위해 넓은 입력 타입으로 캐스팅한 표.
const CASES: [Trigger['scope'], 'FULL_DAY' | 'PARTIAL_SLOTS'][] = [
  ['FULL_DAY', 'FULL_DAY'],
  ['PARTIAL_SLOTS', 'PARTIAL_SLOTS'],
  ['NONE', 'PARTIAL_SLOTS'],
  [null, 'PARTIAL_SLOTS'],
  [undefined, 'PARTIAL_SLOTS'],
];

describe('🔴 foldScope', () => {
  it.each(CASES)('foldScope(%p) === %p', (input, expected) => {
    expect(foldScope(input)).toBe(expected);
  });
});
