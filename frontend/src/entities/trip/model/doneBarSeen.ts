import { readIdSet, writeIdSet } from '@/shared/storage';

/**
 * TRIP-1428 · 완료 배너(h05 done-bar) "이미 알린 여행 id" 집합 — 목록(pages/itinerary-list)과 확정 훅
 * (features/edit-itinerary)이 함께 쓰도록 pages 아래 층에 둔다.
 */

/** SecureStore 키 규칙(영숫자·`.`·`-`·`_`). 값을 바꾸면 기존 기기의 seen 이 버려져 배너가 다시 뜬다. */
const DONE_BAR_SEEN_KEY = 'itinerary.doneBar.seen';

/** 저장된 seen 집합을 읽는다. 읽기 실패는 그대로 reject(목록은 "배너 없음"으로 닫힌다). */
export function readDoneBarSeen(): Promise<string[]> {
  return readIdSet(DONE_BAR_SEEN_KEY);
}

/** seen 집합을 통째로 쓴다. 쓰기 실패는 그대로 reject(호출부가 삼킨다). */
export function writeDoneBarSeen(ids: readonly string[]): Promise<void> {
  return writeIdSet(DONE_BAR_SEEN_KEY, ids);
}

/**
 * 여행 하나를 seen 에 더한다(읽기 → 합집합 → 쓰기). 읽기가 실패하면 쓰지 않는다(덮어써 잃지 않게).
 * 어떤 실패에도 reject·throw 하지 않는다 — 확정 성공 콜백 안에서 불린다(throw 하면 TanStack 이 확정 실패로 바꾼다).
 */
export async function markDoneBarSeen(tripId: string): Promise<void> {
  try {
    const seen = await readDoneBarSeen();
    if (seen.includes(tripId)) return;
    await writeDoneBarSeen([...seen, tripId]);
  } catch {
    // 배너가 한 번 더 뜨는 것보다 확정을 깨는 쪽이 나쁘다.
  }
}
