import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';

import {
  getGetTripsTripIdVisitsDaysDayQueryKey,
  postTripsTripIdVisits,
  postTripsTripIdVisitsVisitCheckIdComplete,
} from '@/shared/api/generated/trips/trips';
import type {
  ArriveRequestSource,
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-396 · AC-3 · AC-4 — 방문 체크 훅(도착·완료)의 낙관적 갱신 + 슬롯키 단위 롤백.
 *
 * 낙관적 갱신 = 서버 응답을 기다리지 않고 그 날 방문 기록 캐시를 먼저 고쳐 화면이 즉시 바뀌게 하고,
 * 실패하면 되돌린다. 리포 선례 `features/explore/model/savedPlaces.ts`(onMutate/onError)를 따르되,
 * ★ 롤백을 **슬롯키(레코드) 단위**로 한다 — savedStays W-2(통짜 스냅숏 복원이 동시 토글을 지움)를
 * 재발시키지 않는다. onError 는 `previous` 스냅숏을 복원하지 않고 **그 레코드만** 현재 캐시에서
 * 제거/원복한다.
 *
 * 성공 시 그 날 방문 기록을 무효화(재조회)하고, 실패 시엔 무효화하지 않는다 — 재요청이 롤백을
 * 덮으면 "되돌렸나"를 관측할 수 없다(savedPlaces 규율).
 *
 * ★ liveTimeStructure 가드(features/execution/**): `new Date` 류 금지. 낙관 레코드의 arrivedAt/
 * completedAt 은 서버 응답 도착 시 재조회로 대체되는 임시값이라, 시계 대신 `day` 기반 문자열을 쓴다.
 */

export type VisitCheckOutcome =
  | { kind: 'arrived' }
  | { kind: 'completed' }
  | { kind: 'failed'; reason: 'not-found' | 'conflict' | 'network' };

function classifyFailure(error: unknown): 'not-found' | 'conflict' | 'network' {
  if (isAxiosError(error)) {
    if (error.response?.status === 404) return 'not-found';
    if (error.response?.status === 409) return 'conflict';
  }
  return 'network';
}

export function useVisitCheck(deps: { tripId: string; day: string }) {
  const queryClient = useQueryClient();
  const key = getGetTripsTripIdVisitsDaysDayQueryKey(deps.tripId, deps.day);
  // 낙관 레코드의 시각 자리표시자 — 서버 재조회로 대체되는 임시값(정확한 시각이 아님).
  // `new Date` 를 못 쓰는 execution 가드 하에서 non-null 시각 자리를 채우는 최소값.
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
      await postTripsTripIdVisits(deps.tripId, {
        slotKey: input.slotKey ?? null,
        poiId: input.poiId,
        source: input.source,
      });
      void queryClient.invalidateQueries({ queryKey: key });
      return { kind: 'arrived' };
    } catch (error) {
      // ★ 슬롯키 단위 롤백 — 이 레코드만 제거(현재 캐시에서 filter). 통짜 previous 복원이면
      // 동시에 진행 중이던 다른 도착 낙관까지 지워진다(W-2).
      patchCache((visits) =>
        visits.filter((v) => v.visitCheckId !== optimisticId)
      );
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
      // ★ 슬롯키 단위 롤백 — 그 레코드만 미완료로 원복(다른 레코드 불변).
      patchCache((visits) =>
        visits.map((v) =>
          v.visitCheckId === visitCheckId ? { ...v, completedAt: null } : v
        )
      );
      return { kind: 'failed', reason: classifyFailure(error) };
    }
  }

  return { arrive, complete };
}
