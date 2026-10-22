import { useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { isAlreadyRegistered } from '@/shared/api';
import { isNotFound } from '@/shared/api';
import {
  getGetTripsTripIdVisitsDaysDayQueryKey,
  postTripsTripIdVisits,
  postTripsTripIdVisitsVisitCheckIdComplete,
  postTripsTripIdVisitsVisitCheckIdSkip,
} from '@/shared/api/index.hooks';
import type {
  ArriveRequestSource,
  VisitCheck,
  VisitCheckList,
} from '@/shared/api/index.schemas';

import { OPTIMISTIC_VISIT_ID_PREFIX } from './visitStatus';

/**
 * TRIP-565 · AC-1·AC-2·AC-5·skip — record 소관 방문 체크 훅의 낙관적 갱신 + 레코드 단위 롤백.
 *
 * 허브(`pages/live/live-itinerary`)도 이 훅을 쓴다(TRIP-1357 · 결정 L) — 예전 허브 전용 사본(도착 뒤 재조회)은
 * 지웠다. 허브의 arrive 뒤 동작이 "재조회 1회"에서 "응답으로 낙관 레코드 교체·재조회 0"으로 바뀐다.
 * 패턴: 낙관 갱신(서버 응답 전에 캐시를 먼저 고치고 실패 시 되돌림) + **레코드 단위 롤백**(통짜 스냅숏 복원이
 * 아니라 그 레코드만 원복 — 동시 두 도착이 서로를 안 지운다, savedStays W-2 회귀 방지) + 판별 유니온 결과.
 *
 * ★ 새 HTTP 함수를 만들지 않는다 — 생성 클라이언트의 4함수만 재사용한다(G5). 409/404 분류는
 * axios 를 직접 import 하지 않고 `@/shared/api` 의 판정 헬퍼(isAlreadyRegistered·isNotFound)로 한다.
 *
 * ★ 재조회 없음(TRIP-1348): arrive·complete·skip 모두 성공 시 **서버가 돌려준 레코드로 그 레코드만
 * 교체**한다(무효화·재조회 0). 즉석 방문(AC-5)은 목록을 게이트 없이 관측하는데, 재조회가 낙관 삽입을
 * 덮으면 즉석 2건이 사라지고(옛 arrive 무효화 비대칭), complete·skip 도 응답이 권위 있는 레코드(VisitCheck)라
 * 통째 재조회할 이유가 없다. 실패 경로는 셋 다 무효화하지 않는다(재요청이 롤백을 덮으면 "되돌렸나"를 관측 못 함).
 *
 * TRIP-1021 · 연타 가드 — 같은 슬롯(키 없으면 poi)의 도착 요청이 진행 중이면 두 번째 호출은 요청 없이
 * `conflict` 로 끝난다. 두 번 나가면 같은 낙관 id 두 개가 한 응답으로 함께 교체돼 같은 카드가 둘 선다.
 */

export type VisitCheckOutcome =
  | { kind: 'arrived' }
  | { kind: 'completed' }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: 'not-found' | 'conflict' | 'network' };

/** TRIP-1561 — 완료→도착 사슬의 결과. `ignored` = 요청 0(연타·낙관 id)이라 안내도 없다. */
export type ArriveAfterCompleteOutcome =
  | { kind: 'arrived' }
  | { kind: 'ignored' }
  | {
      kind: 'failed';
      step: 'complete' | 'arrive';
      reason: 'not-found' | 'conflict' | 'network';
    };

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
  const arriving = useRef(new Set<string>());
  // TRIP-1561 — 완료→도착 사슬 잠금(사슬 호출끼리만). 성공·실패 모두 finally 에서 푼다.
  const chaining = useRef(false);

  /** 그 날 방문 기록 캐시를 갱신자 함수로 고친다(현재 캐시 기준 — 통짜 스냅숏 복원 금지). */
  function patchCache(update: (visits: VisitCheck[]) => VisitCheck[]): void {
    queryClient.setQueryData<VisitCheckList>(key, (current) => ({
      visits: update(current?.visits ?? []),
    }));
  }

  /** 서버 응답 레코드로 그 레코드 하나만 교체한다 — 다른 레코드(진행 중 낙관 포함)는 건드리지 않는다. */
  function replaceRecord(visitCheckId: string, record: VisitCheck): void {
    patchCache((visits) =>
      visits.map((v) => (v.visitCheckId === visitCheckId ? record : v))
    );
  }

  async function arrive(input: {
    slotKey?: string | null;
    poiId: string;
    source: ArriveRequestSource;
  }): Promise<VisitCheckOutcome> {
    const inFlightKey = input.slotKey ?? input.poiId;
    if (arriving.current.has(inFlightKey)) {
      return { kind: 'failed', reason: 'conflict' };
    }
    arriving.current.add(inFlightKey);
    const optimisticId = `${OPTIMISTIC_VISIT_ID_PREFIX}${input.poiId}`;
    const optimistic: VisitCheck = {
      visitCheckId: optimisticId,
      slotKey: input.slotKey ?? null,
      poiId: input.poiId,
      arrivedAt: optimisticAt,
      completedAt: null,
      skippedAt: null,
      source: input.source,
      spontaneous: input.slotKey == null,
      // 서버가 아직 이 레코드의 버전을 모른다 — 성공 시 응답 레코드(실 updatedAt)로 통째 교체된다.
      updatedAt: optimisticAt,
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
    } finally {
      arriving.current.delete(inFlightKey);
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
      const done = await postTripsTripIdVisitsVisitCheckIdComplete(
        deps.tripId,
        visitCheckId
      );
      // 재조회 대신 응답 레코드로 그 레코드만 교체(TRIP-1348) — 도착(arrive)과 같은 방식.
      replaceRecord(visitCheckId, done);
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
      const skipped = await postTripsTripIdVisitsVisitCheckIdSkip(
        deps.tripId,
        visitCheckId
      );
      replaceRecord(visitCheckId, skipped);
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

  /**
   * TRIP-1561 — 앞 장소 완료 → **응답이 성공한 뒤에만** 다음 장소 도착(서버는 순서를 안 지킨다 — 책임은 클라).
   * 완료 실패면 도착을 안 보낸다(409 는 서버 진실과 화면이 갈릴 수 있어 그날 기록을 1회 재조회한다).
   * 도착 실패면 완료는 **남긴다**(서버가 이미 확정했고 되돌리는 API 가 없다 — arrive 가 도착 낙관만 걷는다).
   * 사슬이 도는 동안 두 번째 호출은 요청 없이 `ignored`. 평문 async 라 호출자가 언마운트돼도 끝까지 간다.
   */
  async function completeThenArrive(input: {
    completeVisitCheckId: string;
    arrive: {
      slotKey?: string | null;
      poiId: string;
      source: ArriveRequestSource;
    };
  }): Promise<ArriveAfterCompleteOutcome> {
    // 낙관 id 는 서버가 모르는 레코드라 완료 요청이 404 가 난다 — 요청 0 으로 끝낸다(AC-8).
    if (
      chaining.current ||
      input.completeVisitCheckId.startsWith(OPTIMISTIC_VISIT_ID_PREFIX)
    ) {
      return { kind: 'ignored' };
    }
    chaining.current = true;
    try {
      const completed = await complete(input.completeVisitCheckId);
      if (completed.kind === 'failed') {
        if (completed.reason === 'conflict') {
          await queryClient.invalidateQueries({ queryKey: key });
        }
        return { kind: 'failed', step: 'complete', reason: completed.reason };
      }
      const arrived = await arrive(input.arrive);
      if (arrived.kind === 'failed') {
        return { kind: 'failed', step: 'arrive', reason: arrived.reason };
      }
      return { kind: 'arrived' };
    } finally {
      chaining.current = false;
    }
  }

  return { arrive, complete, skip, completeThenArrive };
}
