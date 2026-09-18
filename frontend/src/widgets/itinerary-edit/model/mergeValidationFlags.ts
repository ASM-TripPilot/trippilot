import type { ItineraryDaysItem } from '@/shared/api/generated/schemas';

/**
 * TRIP-443 · BR-U4-45 복구 방어 순수 머지 — 서버 재검증 결과에서 **위반 플래그만** 취하고
 * 편집 본문(poiId·startAt·endAt·슬롯 순서·isFixed)은 로컬 편집값을 유지한다.
 *
 * 왜: 외부 API 복구 후 자동 재검증이 돌 때, 수동 편집분을 서버 recalc로 덮으면 사용자의 손편집이
 * 사라진다(BR-U4-45 "수동 결과를 유지한 채"). 그래서 (date,poiId) 일치 서버 슬롯의
 * `hasViolation`/`violationReason`만 로컬에 얹고 나머지는 로컬을 권위로 둔다. 매칭 없는 로컬 슬롯은
 * hasViolation=false(서버 침묵 = 위반 없음), 서버에만 있는 슬롯은 버린다(로컬 형/순서 유지).
 */
export function mergeValidationFlags(
  localDays: ItineraryDaysItem[],
  serverDays: ItineraryDaysItem[]
): ItineraryDaysItem[] {
  // (date,poiId) → 서버 위반 판정. 슬롯 배열 순서가 아니라 이 키로 매칭하므로 서버 순서·잉여 슬롯이
  // 로컬 본문을 흔들지 못한다(M3·M5).
  const flagByKey = new Map<
    string,
    { hasViolation: boolean; violationReason: string | null }
  >();
  for (const day of serverDays) {
    for (const slot of day.slots) {
      flagByKey.set(`${day.date}#${slot.poiId}`, {
        hasViolation: slot.hasViolation === true,
        violationReason: slot.violationReason ?? null,
      });
    }
  }

  return localDays.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => {
      const flag = flagByKey.get(`${day.date}#${slot.poiId}`);
      const hasViolation = flag?.hasViolation ?? false;
      // 위반이 없으면 사유도 지운다 — 후속 응답이 위반을 걷으면 로컬 stale 사유가 남지 않는다(M1'·M5).
      return {
        ...slot,
        hasViolation,
        violationReason: hasViolation ? (flag?.violationReason ?? null) : null,
      };
    }),
  }));
}
