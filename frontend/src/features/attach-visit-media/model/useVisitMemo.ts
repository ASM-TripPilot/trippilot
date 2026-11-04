import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { isOfflineWaiting } from '@/shared/api';
import {
  getGetTripsTripIdRecordsQueryKey,
  putTripsTripIdVisitsVisitCheckIdMemo,
  useGetTripsTripIdRecords,
} from '@/shared/api/index.hooks';
import type { TripRecord } from '@/shared/api/index.schemas';

/**
 * TRIP-1078 · 메모 세션 캐시(결정 2(b)) — PUT 에 성공한 텍스트를 Query 캐시(`['visit-memo', tripId, visitCheckId]`)에
 * 두고 `savedMemo` 로 노출한다. 카드가 다시 마운트되면 이 값으로 입력칸을 시드한다.
 *  - ★ 관찰자 쿼리를 `gcTime: Infinity` 로 건다 — 없으면 화면을 떠난 뒤 GC 가 값을 지운다.
 *  - 비교 기준(세션 → 서버)과 같은 텍스트면 PUT 0회(blur 마다 같은 PUT 방지). 실패는 캐시에 안 남으므로 재시도는 나간다.
 *
 * TRIP-1415 · 앱을 다시 켜도 서버 메모가 보인다 — `GET /trips/{id}/records` 의 `days[].actual[].memo` 를 방문 id 로
 * 찾는다(날짜 묶음으로 거르지 않는다). 표시 = 세션 저장본 → 서버 memo → null(`hasMemo` 는 읽지 않는다).
 *  - records 는 여행당 한 키(`changeLimit` 은 RECORDS_PARAMS 한 곳) · 재시도 1회(잠금 상한을 짧게) · 방문 id 가 없으면 안 부른다.
 *  - `memoReady` = 입력을 받아도 되나(TRIP-1751 — 개정 AC-12). 서버 메모를 **한 번도 못 봤고**(records `data` 없음) 이 세션에
 *    저장한 글(own)도 없으면 false — 진행 중·끝내 실패·오프라인 보류 모두(빈칸에 쓴 글이 PUT upsert 로 서버 메모를 덮는 것을 막는다).
 *    꺼진 조회(방문 id 없음)는 열림. 판정이 `data` 유무라 래치가 필요 없다 — 한 번 받으면 배경 재조회가 실패해도 `data` 가 남아 안 닫힌다.
 *  - 신호 4개(TRIP-1751): `memoLoadFailed`(재시도까지 끝내 실패 — `errorUpdateCount > 0`, 재시도 대기 중엔 아직 0 이라 안내가 번쩍이지 않고,
 *    `isError` 와 달리 데이터 없이 다시 가져오는 동안에도 유지된다) · `memoLoadOffline`(연결 대기로 보류) · `memoLoadRetrying`(실패 뒤 다시 가져오는 중) ·
 *    `retryMemoLoad`. 입력 안내 = 실패|보류, [다시 시도] 버튼 = 실패만(보류 중 refetch 는 대기뿐). 허브 카드용 `useSavedVisitMemos.loadFailed` 는 실패만 본다.
 *
 * TRIP-1117 · useVisitAttachments 에서 떼어 냈다 — i01 허브는 사진 목록 GET 없이(F6) 메모만 쓰므로, 허브와
 * j01 이 이 훅 하나로 같은 캐시 키를 공유한다(키를 두 곳에 적지 않는다).
 */
const visitMemoKey = (tripId: string, visitCheckId: string) => [
  'visit-memo',
  tripId,
  visitCheckId,
];
// 서버에서 읽지 않는다(enabled false) — saveMemo 가 setQueryData 로만 채우는 세션 저장소.
const sessionOnly = {
  queryFn: (): string | null => null,
  enabled: false,
  gcTime: Infinity,
  staleTime: Infinity,
} as const;

// 메모 화면엔 변경 이력이 필요 없다(0 은 계약상 못 보낸다). 키에 params 가 들어가므로 값은 여기 한 곳.
const RECORDS_PARAMS = { changeLimit: 1 };

function useTripRecords(tripId: string, enabled: boolean) {
  return useGetTripsTripIdRecords(tripId, RECORDS_PARAMS, {
    query: { enabled: enabled && tripId !== '', retry: 1 },
  });
}

function serverMemoOf(
  record: TripRecord | undefined,
  visitCheckId: string
): string | null {
  for (const day of record?.days ?? []) {
    const hit = day.actual.find((v) => v.visitCheckId === visitCheckId);
    if (hit) return hit.memo ?? null;
  }
  return null;
}

export function useVisitMemo({
  tripId,
  visitCheckId,
}: {
  tripId: string;
  visitCheckId: string;
}) {
  const queryClient = useQueryClient();
  const memoKey = visitMemoKey(tripId, visitCheckId);
  const memoQuery = useQuery<string | null>({
    queryKey: memoKey,
    ...sessionOnly,
  });
  const enabled = tripId !== '' && visitCheckId !== '';
  const records = useTripRecords(tripId, enabled);
  const sessionMemo = memoQuery.data ?? null;

  // 서버 메모를 못 봤고 내 저장본도 없는 상태 — 입력을 막는 단 하나의 조건.
  const unseen = enabled && sessionMemo === null && records.data === undefined;
  const memoLoadFailed = unseen && records.errorUpdateCount > 0;

  // TRIP-1426 — true = PUT 이 나가 성공, false = 건너뜀(공백·같은 값). 실패는 reject 그대로(호출자가 안내).
  // TRIP-1492 — `seed` = 입력칸에 심은 글. 내 저장이 없는 동안 심은 값 그대로면 "손대지 않음"이라 건너뛴다(재조회로
  // 바뀐 다른 기기 글을 옛 글로 덮지 않는다). 서버 메모를 한 번도 못 봤고 내 저장본도 없으면(진행 중·실패·오프라인 보류) 빈칸 upsert 로
  // 덮을 수 있어 PUT 없이 실패로 끝낸다(TRIP-1751 — UI 잠금과 별개의 이중 안전망)(호출자가 실패 안내 — INV-4). 실패 상태가 아니면 다음 시도를 위해 다시 조회를 건다.
  async function saveMemo(
    text: string,
    seed?: string | null
  ): Promise<boolean> {
    const trimmed = text.trim();
    if (trimmed === '') return false;
    const own = queryClient.getQueryData<string | null>(memoKey) ?? null;
    if (own === null && seed !== undefined && trimmed === (seed ?? '').trim())
      return false;
    const recordsState = queryClient.getQueryState(
      getGetTripsTripIdRecordsQueryKey(tripId, RECORDS_PARAMS)
    );
    if (own === null && recordsState?.data === undefined) {
      if (!recordsState?.errorUpdateCount) void records.refetch();
      throw new Error('서버 메모를 아직 확인하지 못했어요');
    }
    // 렌더 값이 아니라 캐시에서 읽는다 — 한 act 안 연속 호출도 직전 저장을 본다.
    const current =
      queryClient.getQueryData<string | null>(memoKey) ??
      serverMemoOf(
        queryClient.getQueryData<TripRecord>(
          getGetTripsTripIdRecordsQueryKey(tripId, RECORDS_PARAMS)
        ),
        visitCheckId
      );
    if (current === trimmed) return false;
    await putTripsTripIdVisitsVisitCheckIdMemo(tripId, visitCheckId, {
      text: trimmed,
    });
    queryClient.setQueryData(memoKey, trimmed);
    return true;
  }

  return {
    saveMemo,
    savedMemo: sessionMemo ?? serverMemoOf(records.data, visitCheckId),
    memoReady: !unseen,
    memoLoadFailed,
    memoLoadOffline: unseen && !memoLoadFailed && isOfflineWaiting(records),
    memoLoadRetrying: memoLoadFailed && records.isFetching,
    retryMemoLoad: () => {
      void records.refetch();
    },
  };
}

/**
 * TRIP-1203 · 방문 여러 개의 메모를 한 번에 구독한다(id → 세션 저장본 ?? 서버 memo, 없으면 null) — i01 허브의 완료 카드 수는
 * 렌더마다 달라 반복문 안에서 useVisitMemo 를 부를 수 없다. `useQueries` = 쿼리 배열을 훅 한 번으로 구독.
 * TRIP-1751 — 반환은 `{ memos, loadFailed }`(`loadFailed` = 서버 메모 조회가 끝내 실패 — 허브 카드 표식용).
 */
export function useSavedVisitMemos({
  tripId,
  visitCheckIds,
}: {
  tripId: string;
  visitCheckIds: readonly string[];
}): { memos: Record<string, string | null>; loadFailed: boolean } {
  const results = useQueries({
    queries: visitCheckIds.map((visitCheckId) => ({
      queryKey: visitMemoKey(tripId, visitCheckId),
      ...sessionOnly,
    })),
  });
  const records = useTripRecords(tripId, visitCheckIds.length > 0);
  return {
    memos: Object.fromEntries(
      visitCheckIds.map((id, index) => [
        id,
        results[index]?.data ?? serverMemoOf(records.data, id),
      ])
    ),
    // 카드용 — 서버 메모를 끝내 못 받았을 때만(보류·진행 중은 아님). 카드는 memo 가 있으면 이 값을 안 본다.
    loadFailed:
      visitCheckIds.length > 0 &&
      records.data === undefined &&
      records.errorUpdateCount > 0,
  };
}
