import { useQueryClient } from '@tanstack/react-query';

import { isNotFound } from '@/shared/api/isNotFound';
import { resolveVisitConflict } from '@/shared/api/visitConflict';
import {
  getGetTripsTripIdVisitsDaysDayQueryKey,
  patchTripsTripIdVisitsVisitCheckId,
} from '@/shared/api/generated/trips/trips';
import type {
  AdjustTimesRequest,
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-613 · AC-1·AC-5·AC-6 · BR-U5-04·07·22 · INV-4 — 방문 시각 편집(`PATCH /visits/{id}`)의
 * 낙관 갱신 + 서버 교체 + 409 낙관 락 충돌 처리(롤백 + 재조회). record `useVisitCheck` 선례를 미러한다.
 *
 * ⚠️ `features/execution/model/useVisitCheck`(poi 집계)와 이름만 같고 shape 가 다르다 — 여기는
 * per-record 편집이라 이름을 `useAdjustVisitTimes` 로 갈랐다. 409 code 판별은 `@/shared/api/visitConflict`
 * (shared 승격분)만 쓰고 axios 를 직접 import 하지 않는다(G5, shared 캡슐이 유일 경로).
 *
 * ★ 새 HTTP 함수를 만들지 않는다 — 생성 클라이언트의 `patchTripsTripIdVisitsVisitCheckId` 를 raw 로
 * 재사용한다(G5). 호출자는 **바뀐 필드만** 넘기고(present=변경·absent=유지, AdjustTimesRequest 시맨틱),
 * 훅이 캐시 레코드의 `updatedAt` 을 `expectedUpdatedAt` 으로 실어 보낸다(BR-U5-22).
 *
 * ★ 낙관은 레코드 단위다 — 편집분만 그 레코드에 얹고, 200 이면 서버 VisitCheck 로 통째 교체,
 * 409 VISIT_CONFLICT 면 그 레코드만 원복(통짜 스냅숏 복원 아님 — 다른 레코드 무간섭) + 그 날 캐시
 * 재조회(invalidate) + 안내. 404·네트워크는 롤백만(무효화 안 함, 재조회가 롤백을 덮으면 관측 불가).
 */

export const VISIT_CONFLICT_NOTICE = '다른 기기에서 먼저 수정됐어요';

export type AdjustVisitTimesOutcome =
  | { kind: 'adjusted' }
  | { kind: 'conflict'; message: string }
  | { kind: 'failed'; reason: 'not-found' | 'network' };

/** 바뀐 필드만 추린다(undefined=유지 — AdjustTimesRequest 의 "안 보내면 유지" 시맨틱). */
function changedFields(input: {
  arrivedAt?: string;
  completedAt?: string;
}): Pick<AdjustTimesRequest, 'arrivedAt' | 'completedAt'> {
  const patch: Pick<AdjustTimesRequest, 'arrivedAt' | 'completedAt'> = {};
  if (input.arrivedAt !== undefined) patch.arrivedAt = input.arrivedAt;
  if (input.completedAt !== undefined) patch.completedAt = input.completedAt;
  return patch;
}

/**
 * 캐시 setQueryData 의 관찰자 재렌더가 outcome 을 알리기 **전에** 커밋되도록 한 틱 양보한다
 * (record `useVisitCheck.settleRollback` 선례). 응답 await 뒤의 setQueryData 는 react-query 배치
 * 통지가 다음 매크로태스크로 밀리므로 — 교체(성공)든 롤백(실패)이든 — 양보해야 호출자가 outcome 을
 * await 하고 캐시를 읽는 경로에서 최신 값을 본다.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export function useAdjustVisitTimes(deps: { tripId: string; day: string }): {
  adjust: (input: {
    visitCheckId: string;
    arrivedAt?: string;
    completedAt?: string;
  }) => Promise<AdjustVisitTimesOutcome>;
} {
  const queryClient = useQueryClient();
  const key = getGetTripsTripIdVisitsDaysDayQueryKey(deps.tripId, deps.day);

  /** 그 날 방문 기록 캐시를 갱신자 함수로 고친다(현재 캐시 기준 — 통짜 스냅숏 복원 금지). */
  function patchCache(update: (visits: VisitCheck[]) => VisitCheck[]): void {
    queryClient.setQueryData<VisitCheckList>(key, (current) => ({
      visits: update(current?.visits ?? []),
    }));
  }

  async function adjust(input: {
    visitCheckId: string;
    arrivedAt?: string;
    completedAt?: string;
  }): Promise<AdjustVisitTimesOutcome> {
    const { visitCheckId } = input;
    const patch = changedFields(input);

    // 편집 대상 레코드를 캐시에서 읽어 롤백 원본과 expectedUpdatedAt 근거(updatedAt)를 얻는다.
    const before = (
      queryClient.getQueryData<VisitCheckList>(key)?.visits ?? []
    ).find((v) => v.visitCheckId === visitCheckId);

    // 낙관 — 바뀐 필드만 그 레코드에 얹는다(레코드 단위, 다른 레코드 불변).
    patchCache((visits) =>
      visits.map((v) =>
        v.visitCheckId === visitCheckId ? { ...v, ...patch } : v
      )
    );

    const body: AdjustTimesRequest = {
      ...patch,
      expectedUpdatedAt: before?.updatedAt,
    };

    try {
      const updated = await patchTripsTripIdVisitsVisitCheckId(
        deps.tripId,
        visitCheckId,
        body
      );
      // 200 → 낙관 레코드를 서버 VisitCheck 로 통째 교체(권위 updatedAt·파생 상태 반영).
      patchCache((visits) =>
        visits.map((v) => (v.visitCheckId === visitCheckId ? updated : v))
      );
      await settle();
      return { kind: 'adjusted' };
    } catch (error) {
      // ★ 레코드 단위 롤백 — 그 레코드만 원본으로 원복(다른 레코드 무간섭).
      if (before !== undefined) {
        patchCache((visits) =>
          visits.map((v) => (v.visitCheckId === visitCheckId ? before : v))
        );
      }
      await settle();

      if (resolveVisitConflict(error).kind === 'conflict') {
        // 409 VISIT_CONFLICT — 그 날 캐시 재조회로 서버 신버전에 수렴(INV-4, 침묵 금지).
        void queryClient.invalidateQueries({ queryKey: key });
        return { kind: 'conflict', message: VISIT_CONFLICT_NOTICE };
      }
      if (isNotFound(error)) return { kind: 'failed', reason: 'not-found' };
      return { kind: 'failed', reason: 'network' };
    }
  }

  return { adjust };
}
