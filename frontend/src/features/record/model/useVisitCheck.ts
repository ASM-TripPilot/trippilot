import { useQueryClient } from '@tanstack/react-query';

import { isAlreadyRegistered } from '@/shared/api/isAlreadyRegistered';
import { isNotFound } from '@/shared/api/isNotFound';
import {
  getGetTripsTripIdVisitsDaysDayQueryKey,
  postTripsTripIdVisits,
  postTripsTripIdVisitsVisitCheckIdComplete,
  postTripsTripIdVisitsVisitCheckIdSkip,
} from '@/shared/api/generated/trips/trips';
import type {
  ArriveRequestSource,
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-565 · AC-1·AC-2·AC-5·skip — record 소관 방문 체크 훅의 낙관적 갱신 + 레코드 단위 롤백.
 *
 * ⚠️ `features/execution/model/useVisitCheck` 를 **import 하지 않는다**(01b Q2) — shape 가 다르고
 * (per-record 4상태 vs poi 집계), execution 테스트를 blast radius 로 끌어들이지 않으려는 것.
 * 패턴만 미러한다: 낙관 갱신(서버 응답 전에 캐시를 먼저 고치고 실패 시 되돌림) + **레코드 단위
 * 롤백**(통짜 스냅숏 복원이 아니라 그 레코드만 원복 — 동시 두 도착이 서로를 안 지운다, savedStays
 * W-2 회귀 방지) + 판별 유니온 결과.
 *
 * ★ 새 HTTP 함수를 만들지 않는다 — 생성 클라이언트의 4함수만 재사용한다(G5). 409/404 분류는
 * axios 를 직접 import 하지 않고 `@/shared/api` 의 판정 헬퍼(isAlreadyRegistered·isNotFound)로 한다.
 *
 * ★ 무효화 비대칭(테스트가 강제한다): complete·skip 은 성공 시 그 날 캐시를 무효화(재조회)하지만,
 * arrive 는 무효화하지 않고 **서버가 돌려준 레코드로 낙관 레코드를 교체**한다. 즉석 방문(AC-5)은
 * 목록을 게이트 없이 관측하는데, 무효화하면 재조회가 낙관 삽입을 덮어 즉석 2건이 사라진다 —
 * arrive 는 이미 권위 있는 생성 레코드(실 id·spontaneous 배지)를 응답으로 받으므로 그걸 심는다.
 * 실패 경로는 셋 다 무효화하지 않는다(재요청이 롤백을 덮으면 "되돌렸나"를 관측 못 함).
 */

export type VisitCheckOutcome =
  | { kind: 'arrived' }
  | { kind: 'completed' }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: 'not-found' | 'conflict' | 'network' };

function classifyFailure(error: unknown): 'not-found' | 'conflict' | 'network' {
  if (isNotFound(error)) return 'not-found';
  if (isAlreadyRegistered(error)) return 'conflict';
  return 'network';
}

/**
 * 롤백 setQueryData 의 관찰자 재렌더가 실패 outcome 을 알리기 **전에** 커밋되도록 한 틱 양보한다.
 * 낙관 갱신은 `complete()` 진입 시 동기로 반영돼 그 자리에서 커밋되지만, 롤백은 요청 await 뒤라
 * react-query 의 배치 통지가 다음 매크로태스크로 밀린다 — 되돌린 화면이 먼저 보이고 나서 실패를
 * 알리는 것이 낙관 UX 의 정합이다(호출자가 outcome 을 await 하고 화면 상태를 읽는 경로에서 유의미).
 */
const settleRollback = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export function useVisitCheck(deps: { tripId: string; day: string }) {
  const queryClient = useQueryClient();
  const key = getGetTripsTripIdVisitsDaysDayQueryKey(deps.tripId, deps.day);
  // 낙관 레코드의 시각 자리표시자 — 서버 재조회/응답으로 대체되는 임시값(정확한 시각이 아님).
  const optimisticAt = `${deps.day}T00:00:00`;

  /** 그 날 방문 기록 캐시를 갱신자 함수로 고친다(현재 캐시 기준 — 통짜 스냅숏 복원 금지). */
  function patchCache(update: (visits: VisitCheck[]) => VisitCheck[]): void {
    queryClient.setQueryData<VisitCheckList>(key, (current) => ({
      visits: update(current?.visits ?? []),
    }));
  }

  async function arrive(input: {
    slotKey?: string | null;
    poiId: string;
    source: ArriveRequestSource;
  }): Promise<VisitCheckOutcome> {
    const optimisticId = `optimistic:${input.poiId}`;
    const optimistic: VisitCheck = {
      visitCheckId: optimisticId,
      slotKey: input.slotKey ?? null,
      poiId: input.poiId,
      arrivedAt: optimisticAt,
      completedAt: null,
      skippedAt: null,
      source: input.source,
      spontaneous: input.slotKey == null,
    };
    // 낙관 삽입 — 현재 캐시에 append(다른 진행 중 낙관을 지우지 않는다).
    patchCache((visits) => [...visits, optimistic]);

    try {
      const created = await postTripsTripIdVisits(deps.tripId, {
        slotKey: input.slotKey ?? null,
        poiId: input.poiId,
        source: input.source,
      });
      // 무효화 대신 서버 응답으로 낙관 레코드를 교체(위 ★ 무효화 비대칭).
      patchCache((visits) =>
        visits.map((v) => (v.visitCheckId === optimisticId ? created : v))
      );
      return { kind: 'arrived' };
    } catch (error) {
      // ★ 레코드 단위 롤백 — 이 레코드만 제거. 통짜 previous 복원이면 동시 진행 중이던 다른
      // 도착 낙관까지 지워진다(W-2).
      patchCache((visits) =>
        visits.filter((v) => v.visitCheckId !== optimisticId)
      );
      await settleRollback();
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  async function complete(visitCheckId: string): Promise<VisitCheckOutcome> {
    // 낙관 완료 — 그 레코드만 completedAt 을 채운다.
    patchCache((visits) =>
      visits.map((v) =>
        v.visitCheckId === visitCheckId
          ? { ...v, completedAt: optimisticAt }
          : v
      )
    );

    try {
      await postTripsTripIdVisitsVisitCheckIdComplete(
        deps.tripId,
        visitCheckId
      );
      void queryClient.invalidateQueries({ queryKey: key });
      return { kind: 'completed' };
    } catch (error) {
      // ★ 레코드 단위 롤백 — 그 레코드만 미완료로 원복(다른 레코드 불변).
      patchCache((visits) =>
        visits.map((v) =>
          v.visitCheckId === visitCheckId ? { ...v, completedAt: null } : v
        )
      );
      await settleRollback();
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  async function skip(visitCheckId: string): Promise<VisitCheckOutcome> {
    // 낙관 건너뜀 — 그 레코드만 skippedAt 을 채운다.
    patchCache((visits) =>
      visits.map((v) =>
        v.visitCheckId === visitCheckId ? { ...v, skippedAt: optimisticAt } : v
      )
    );

    try {
      await postTripsTripIdVisitsVisitCheckIdSkip(deps.tripId, visitCheckId);
      void queryClient.invalidateQueries({ queryKey: key });
      return { kind: 'skipped' };
    } catch (error) {
      patchCache((visits) =>
        visits.map((v) =>
          v.visitCheckId === visitCheckId ? { ...v, skippedAt: null } : v
        )
      );
      await settleRollback();
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  return { arrive, complete, skip };
}
