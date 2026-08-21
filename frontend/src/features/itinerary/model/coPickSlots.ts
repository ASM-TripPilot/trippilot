import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

import { buildSlotKey } from './slotKey';

/**
 * TRIP-504 · copick 선형 순회의 슬롯 진행 판정(01b 순회 세부) — 비고정(`isFixed=false`) 슬롯을
 * day 순서 → 슬롯 순서로 훑어 **다음 갈 슬롯의 키**를 낸다. 키 규약은 `"{date}#{poiId}"`
 * (`slotKey.ts`의 `buildSlotKey` — 규약이 두 곳에서 갈리지 않게 그 함수를 재사용한다).
 *
 * - `firstCoPickSlotKey(days)` = h09 생성 완료 시 GeneratingPage 가 처음 착지시킬 슬롯.
 * - `nextCoPickSlotKey(days, currentKey)` = h14 확정 후 전진할 다음 슬롯. 없으면 `null`(→h17).
 * 고정 슬롯(숙소 등)은 채울 자리가 아니라 건너뛴다. 없으면 `null`.
 *
 * *(개념)* **순수 함수** — 같은 days 면 항상 같은 키. 바깥 상태를 읽지도 바꾸지도 않는다.
 */

/** 첫 비고정 슬롯 키. day/슬롯 순서로 훑어 처음 만난 비고정을 낸다 — 없으면 `null`. */
export function firstCoPickSlotKey(days: ItineraryDaysItem[]): string | null {
  for (const day of days) {
    for (const slot of day.slots) {
      if (!slot.isFixed) return buildSlotKey(day.date, slot.poiId);
    }
  }
  return null;
}

/**
 * 현재 키 **다음**의 비고정 슬롯 키. 현재 키를 만난 뒤부터 다시 훑어 처음 만난 비고정을 내되,
 * 사이의 고정은 건너뛰고 일자 경계도 넘는다. 다음이 없거나(마지막) 현재 키가 목록에 없으면
 * `null`(엉뚱한 슬롯으로 튀지 않는다).
 */
export function nextCoPickSlotKey(
  days: ItineraryDaysItem[],
  currentKey: string
): string | null {
  let passedCurrent = false;
  for (const day of days) {
    for (const slot of day.slots) {
      const key = buildSlotKey(day.date, slot.poiId);
      if (passedCurrent) {
        if (!slot.isFixed) return key;
      } else if (key === currentKey) {
        passedCurrent = true;
      }
    }
  }
  return null;
}
