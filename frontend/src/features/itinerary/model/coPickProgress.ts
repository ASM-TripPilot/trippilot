/**
 * TRIP-335 슬라이스2 · AC-6 (h16 진행 카운터) — "3/5 슬롯 선택됨 · 남은 2개"의 **유일한 판정처**.
 *
 * 무엇을 보장하나:
 *  - `total` = 전체 슬롯(고정 포함) · `remaining` = 빈 fillable 슬롯 수(고정이 아니고 && 아직 안 채운
 *    슬롯) · `filled` = `total - remaining`. 고정 슬롯은 채울 자리가 아니므로(숙소 등) 절대 `remaining`
 *    에 들어가지 않고 `filled` 로 접힌다("결정됨").
 *  - E2 확정 게이트는 `remaining === 0` 일 때만 열린다 — 이 함수의 `remaining` 이 그 진실이다.
 *
 * *(개념)* **순수 함수** — 같은 입력이면 항상 같은 출력, 바깥 상태를 읽지도 바꾸지도 않는다. 화면은
 * 이 값을 다시 계산하지 않고 props 로 받아 그리기만 한다(재판정 금지 · 구조 가드가 잠근다).
 */

export type CoPickProgressSlot = { fixed: boolean; filled: boolean };

export type CoPickProgress = {
  total: number;
  filled: number;
  remaining: number;
};

export function coPickProgress(
  slots: readonly CoPickProgressSlot[]
): CoPickProgress {
  const total = slots.length;
  const remaining = slots.filter((slot) => !slot.fixed && !slot.filled).length;
  return { total, filled: total - remaining, remaining };
}
