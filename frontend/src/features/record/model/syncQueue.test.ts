import { AxiosError } from 'axios';
import fc from 'fast-check';

import { VISIT_CONFLICT_CODES } from '@/shared/api/visitConflict';

import {
  enqueue,
  replayQueue,
  type ReplayExecutor,
  type SyncQueueItem,
  type SyncStatus,
} from './syncQueue';

/**
 * TRIP-568 · AC-1(PBT-U5-F2, 블로킹)·AC-2(BR-U5-20) — 오프라인 큐의 순수 재생 모델.
 *
 * 무엇을 보장하나:
 *  - **AC-1 멱등**: 같은 큐를 두 번 재생해도 결과 상태가 같다(PBT-U5-F2). 재생 중 이미 서버에
 *    있는 항목(409 alreadyRecorded)을 다시 밀어도 상태가 안 뒤집히고, **터미널 항목은 재실행조차
 *    안 한다**(부작용 중복 금지 — 재생 도중 앱이 죽어 재시도해도 중복 안 남게).
 *  - **AC-2 두 갈래**: 재생 중 409 는 실패가 아니다 — `VISIT_ALREADY_RECORDED`→`SYNCED`(수렴),
 *    `VISIT_CONFLICT`→`CONFLICT`(해소필요). **raw `status===409` 로 뭉치면 진짜 충돌이 조용히
 *    SYNCED 로 덮인다**(BR-U5-21 침묵 승자 금지, 맹점①). 그래서 두 결과가 서로 다름을 못박는다.
 *
 * 개념(코드 초심자용):
 *  - **멱등(idempotent)**: 같은 연산을 두 번 해도 결과가 한 번 한 것과 같다.
 *  - **DI(의존성 주입)**: HTTP 호출을 함수 밖에서 `execute` 인자로 넣어, 테스트가 진짜 네트워크
 *    없이 **가짜 실행자**로 대체한다. `replayQueue(queue, execute)` 의 `execute` 가 그 이음매다.
 *  - **PBT(속성 기반 테스트)**: 예제를 손으로 적는 대신 "어떤 큐에도 성립해야 하는 성질"을 적으면
 *    fast-check 가 임의 입력을 만들어 반례를 찾는다(리포 CI 차단 게이트).
 *
 * 3동작 뼈대: 준비=큐+가짜 실행자 → 실행=replayQueue → 단언=결과 상태·실행자 호출.
 */

/** 페이크 실행자가 각 항목에 대해 취할 거동. */
type Fate = 'ok' | 'already' | 'conflict' | 'unknown';

/** visitConflict.test 미러 — `isAxiosError` 브랜드가 붙어야 분류가 실제로 돈다. */
function httpError(status: number, code?: string): AxiosError {
  const error = new AxiosError('request failed');
  error.response = {
    status,
    statusText: '',
    data: code === undefined ? {} : { error: { code, message: '서버 문구' } },
    headers: {},
    config: { headers: {} },
  } as AxiosError['response'];
  return error;
}

/** fate 에 맞춰 성공/throw 하는 가짜 실행자 + 호출 기록(진짜 네트워크 없음). */
function makeExecutor(fateOf: Map<string, Fate>): {
  execute: ReplayExecutor;
  calledIds: string[];
} {
  const calledIds: string[] = [];
  const execute: ReplayExecutor = async (item) => {
    calledIds.push(item.id);
    const fate = fateOf.get(item.id) ?? 'ok';
    if (fate === 'ok') return;
    if (fate === 'already')
      throw httpError(409, VISIT_CONFLICT_CODES.alreadyRecorded);
    if (fate === 'conflict')
      throw httpError(409, VISIT_CONFLICT_CODES.conflict);
    throw new Error('boom'); // unknown — 비-axios, 분류 폴백 대상
  };
  return { execute, calledIds };
}

function item(id: string, status: SyncStatus = 'LOCAL'): SyncQueueItem {
  return { id, visitCheckId: `vc-${id}`, status };
}

/** 결과 상태 비교 키 — 순서 무관 id→status 매핑(멱등 비교의 정본). */
function statusSnapshot(items: SyncQueueItem[]): [string, SyncStatus][] {
  return items.map((i) => [i.id, i.status] as [string, SyncStatus]).sort();
}

describe('enqueue — 큐 적재(비파괴)', () => {
  it('항목을 LOCAL 로 append 하고 입력 배열을 건드리지 않는다', () => {
    const base: SyncQueueItem[] = [];

    const next = enqueue(base, { id: 'a', visitCheckId: 'vc-a' });

    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ id: 'a', visitCheckId: 'vc-a', status: 'LOCAL' });
    // 비파괴 — 캐시가 준 배열을 제자리에서 흔들면 리렌더 통지가 샌다(리포 관례).
    expect(base).toEqual([]);
  });
});

describe('🔴 replayQueue — 예제 (AC-1 멱등 · AC-2 수렴)', () => {
  it('4항목을 상태별로 확정하고, 2차 재생은 미해소 항목만 재실행한다', async () => {
    // 준비 — ok·already·conflict·unknown 네 갈래.
    const queue = [item('ok1'), item('al1'), item('cf1'), item('uk1')];
    const fateOf = new Map<string, Fate>([
      ['ok1', 'ok'],
      ['al1', 'already'],
      ['cf1', 'conflict'],
      ['uk1', 'unknown'],
    ]);
    const { execute, calledIds } = makeExecutor(fateOf);

    // 실행 — 1차 재생.
    const once = await replayQueue(queue, execute);

    // 단언 — 성공·409수렴은 SYNCED, 진짜 충돌은 CONFLICT, 모르는 실패는 PENDING(침묵 SYNCED 아님).
    expect(once.map((i) => i.status)).toEqual([
      'SYNCED',
      'SYNCED',
      'CONFLICT',
      'PENDING',
    ]);
    // 순서·원소 보존.
    expect(once.map((i) => i.id)).toEqual(['ok1', 'al1', 'cf1', 'uk1']);
    // 입력 비파괴.
    expect(queue.every((i) => i.status === 'LOCAL')).toBe(true);

    // 실행2 — 2차 재생(1차 결과를 다시 태운다).
    calledIds.length = 0;
    const twice = await replayQueue(once, execute);

    // 헤드라인 멱등 — 터미널(SYNCED·CONFLICT)은 재실행 0, 미해소(PENDING=unknown)만 재시도.
    expect(calledIds).toEqual(['uk1']);
    // 상태 스냅숏 불변.
    expect(statusSnapshot(twice)).toEqual(statusSnapshot(once));
  });
});

describe('🔴 replayQueue — 성질 (PBT-U5-F2 · 블로킹 · fast-check)', () => {
  const fateArb = fc.constantFrom<Fate>('ok', 'already', 'conflict', 'unknown');
  const queueArb = fc.uniqueArray(fc.record({ id: fc.uuid(), fate: fateArb }), {
    selector: (x) => x.id,
    maxLength: 12,
  });

  it('두 번 재생해도 결과 상태가 같고, 원소를 잃거나 만들지 않는다', async () => {
    await fc.assert(
      fc.asyncProperty(queueArb, async (spec) => {
        const fateOf = new Map(spec.map((s) => [s.id, s.fate] as const));
        const queue = spec.map((s) => item(s.id));
        const { execute } = makeExecutor(fateOf);

        const once = await replayQueue(queue, execute);
        const twice = await replayQueue(once, execute);

        // 멱등 — 상태 스냅숏 동일(같은 큐 두 번 재생 = 한 번과 같다).
        expect(statusSnapshot(twice)).toEqual(statusSnapshot(once));
        // 원소 보존 — 다중집합으로 "같은 id 들인가"만 본다(중복·누락 구현을 잡는다).
        expect(once.map((i) => i.id).sort()).toEqual(
          spec.map((s) => s.id).sort()
        );
        expect(once).toHaveLength(spec.length);
      }),
      { numRuns: 300 }
    );
  });

  it('2차 재생은 미해소(unknown) 항목만 재실행한다 — 터미널 재-push 금지(가짜통과 방지 짝)', async () => {
    await fc.assert(
      fc.asyncProperty(queueArb, async (spec) => {
        const fateOf = new Map(spec.map((s) => [s.id, s.fate] as const));
        const queue = spec.map((s) => item(s.id));

        const first = makeExecutor(fateOf);
        const once = await replayQueue(queue, first.execute);

        const second = makeExecutor(fateOf);
        await replayQueue(once, second.execute);

        // 2차에 실행자가 닿은 id 는 전부 unknown fate 여야 한다(SYNCED·CONFLICT 는 재실행 0).
        // 항등/전량 재실행 구현이면 ok·already·conflict 도 다시 밀어 이 단언이 깨진다.
        const unknownIds = new Set(
          spec.filter((s) => s.fate === 'unknown').map((s) => s.id)
        );
        for (const id of second.calledIds) {
          expect(unknownIds.has(id)).toBe(true);
        }
      }),
      { numRuns: 300 }
    );
  });
});

describe('🔴 replayQueue — 재생 중 409 두 갈래 (AC-2 · BR-U5-20 · ★raw 409 뭉치기 금지)', () => {
  async function replayOne(fate: Fate): Promise<SyncStatus> {
    const fateOf = new Map<string, Fate>([['x', fate]]);
    const { execute } = makeExecutor(fateOf);
    const [result] = await replayQueue([item('x')], execute);
    return result.status;
  }

  it('VISIT_ALREADY_RECORDED → SYNCED(수렴) vs VISIT_CONFLICT → CONFLICT(해소필요)', async () => {
    const already = await replayOne('already');
    const conflict = await replayOne('conflict');

    expect(already).toBe('SYNCED');
    expect(conflict).toBe('CONFLICT');
    // 헤드라인 — 두 code 를 한 결과로 뭉개지 않는다(맹점①, 침묵 승자 방지).
    expect(already).not.toBe(conflict);
  });

  it('모르는 실패(비-axios)는 SYNCED 로 삼키지 않고 PENDING 으로 남긴다(재시도 대상)', async () => {
    expect(await replayOne('unknown')).toBe('PENDING');
  });
});
