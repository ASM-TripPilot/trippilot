/**
 * 일정 시트 헤더 meta·목록 key — h07·h08(`DraftPage`)·h14·h16(`ItineraryPlanPage`)·h11
 * (`CoPickCompletePage`) 공용 순수 함수. 페이지마다 복붙돼 있던 식을 동작 그대로 모았다.
 * 페이지별 차이는 옵션으로만 남긴다 — Draft `{count:'all', km:true}` · Plan
 * `{count:'excludeFixedStay', km:true, confirmed}` · CoPick `{count:'excludeFixedStay', km:false}`.
 * (곳 수 규칙 통일·CoPick km 붙이기는 동작 변경이라 여기서 하지 않았다.)
 */
import { legDistance } from '@/entities/place';
import type { ItineraryDaysItemSlotsItem } from '@/shared/api/index.schemas';

type SheetSlot = Pick<
  ItineraryDaysItemSlotsItem,
  'isFixed' | 'category' | 'distanceRange'
>;

export type SheetCountRule = 'all' | 'excludeFixedStay';

/** 고정 숙소 = `isFixed && category === '숙소'`(시각 고정 꼭 갈 곳도 `isFixed` 라 카테고리까지 본다). */
export function isFixedStay(
  slot: Pick<SheetSlot, 'isFixed' | 'category'>
): boolean {
  return slot.isFixed && slot.category === '숙소';
}

/**
 * "[확정됨 · ]N곳[ · X.Xkm]" — km 는 커넥터가 그리는 구간(`slots.slice(1)`)의 `legDistance` 에서
 * "이동 " 을 뗀 값. 구간 하나라도 null·깨진 값이면 접힌다(INV-3 소요 어휘 없음 · INV-4 TRIP-1110).
 */
export function sheetMeta(
  slots: readonly SheetSlot[],
  opts: { count: SheetCountRule; km: boolean; confirmed?: boolean }
): string {
  const n =
    opts.count === 'all'
      ? slots.length
      : slots.filter((slot) => !isFixedStay(slot)).length;
  const legLabel = opts.km
    ? legDistance(slots.slice(1).map((slot) => slot.distanceRange))
    : null;
  const body =
    legLabel === null ? `${n}곳` : `${n}곳 · ${legLabel.replace('이동 ', '')}`;
  return opts.confirmed === true ? `확정됨 · ${body}` : body;
}

/** 같은 날 같은 장소 두 번(BR-U2-04 위반 데이터, TRIP-1296)에도 겹치지 않는 목록 key — 순번을 섞는다. */
export function sheetRowKeys(
  index: number,
  poiId: string
): { card: string; conn: string } {
  return { card: `card-${index}-${poiId}`, conn: `conn-${index}-${poiId}` };
}
