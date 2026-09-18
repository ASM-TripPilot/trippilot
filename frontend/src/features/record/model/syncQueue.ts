import { resolveVisitConflict } from '@/shared/api/visitConflict';

/**
 * TRIP-568 · AC-1(PBT-U5-F2)·AC-2(BR-U5-20) — 오프라인 큐의 순수 재생 모델.
 *
 * 무엇을 보장하나:
 *  - `enqueue` 는 방문 편집을 `LOCAL` 로 큐 끝에 얹는다(입력 배열은 안 건드린다 — 캐시가 준
 *    배열을 제자리에서 흔들면 리렌더 통지가 새는 리포 관례).
 *  - `replayQueue` 는 큐를 입력 순서대로 한 번 훑어 각 항목의 새 상태를 정한다:
 *    성공→`SYNCED`, 409 `VISIT_ALREADY_RECORDED`→`SYNCED`(이미 서버에 있음=멱등 수렴),
 *    409 `VISIT_CONFLICT`→`CONFLICT`(사용자가 골라야 함), 그 외 실패→`PENDING`(재시도 대상,
 *    조용히 SYNCED 로 삼키지 않는다).
 *  - **이미 해소된 항목(SYNCED·CONFLICT)은 재실행하지 않는다** — 같은 큐를 두 번 재생해도
 *    실행자가 두 번 안 불려 부작용이 중복되지 않는다(멱등의 핵심).
 *
 * 이 파일은 순수 값·순수 함수뿐이다. 진짜 HTTP 는 호출자가 `execute`(ReplayExecutor)로
 * **주입**한다(DI) — 그래서 fast-check 가 진짜 네트워크 없이 임의 큐를 재생할 수 있다. 409 분류는
 * 새 HTTP 함수를 짓지 않고 공용 `resolveVisitConflict`(shared/api)를 재사용한다(맹점①, G5).
 *
 * ponytail: 큐는 caller-owned·in-memory 천장 — 내구 영속화(AsyncStorage 등)와 NetInfo 복구
 * 트리거 실배선은 후속 티켓(부모 TRIP-129).
 */

export type SyncStatus = 'LOCAL' | 'PENDING' | 'SYNCED' | 'CONFLICT';

export interface SyncQueueItem {
  id: string;
  visitCheckId: string;
  status: SyncStatus;
}

/** 재생 실행자 — 진짜 HTTP 는 밖에서 주입한다(성공하면 resolve, 서버 거절이면 throw). */
export type ReplayExecutor = (item: SyncQueueItem) => Promise<void>;

/** 재실행하지 않는 터미널 상태 — 이미 해소돼 다시 밀 필요가 없다(멱등). */
const TERMINAL: readonly SyncStatus[] = ['SYNCED', 'CONFLICT'];

export function enqueue(
  queue: SyncQueueItem[],
  item: { id: string; visitCheckId: string }
): SyncQueueItem[] {
  return [
    ...queue,
    { id: item.id, visitCheckId: item.visitCheckId, status: 'LOCAL' },
  ];
}

/** 한 항목의 재생 결과 상태를 정한다(터미널은 그대로 두고, 아니면 실행자를 태워 분류). */
async function replayItem(
  item: SyncQueueItem,
  execute: ReplayExecutor
): Promise<SyncStatus> {
  if (TERMINAL.includes(item.status)) return item.status;
  try {
    await execute(item);
    return 'SYNCED';
  } catch (error) {
    const { kind } = resolveVisitConflict(error);
    if (kind === 'alreadyRecorded') return 'SYNCED';
    if (kind === 'conflict') return 'CONFLICT';
    return 'PENDING';
  }
}

export async function replayQueue(
  queue: SyncQueueItem[],
  execute: ReplayExecutor
): Promise<SyncQueueItem[]> {
  const next: SyncQueueItem[] = [];
  for (const item of queue) {
    const status = await replayItem(item, execute);
    next.push({ ...item, status });
  }
  return next;
}
