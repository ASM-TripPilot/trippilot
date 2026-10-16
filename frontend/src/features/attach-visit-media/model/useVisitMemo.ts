import { useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

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
 *  - `memoReady` = 입력을 받아도 되나. 세션 저장본 없이 첫 조회가 **진행 중**일 때만 false(빈칸에 쓴 글이 서버 메모를
 *    upsert 로 덮는 것을 막는다). 실패·오프라인 보류(paused)·꺼진 조회는 열림. 한 번 열리면 다시 닫히지 않는다(래치 —
 *    배경 재조회·온라인 복귀가 초안을 날리지 않게).
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
  const records = useTripRecords(tripId, visitCheckId !== '');
  const sessionMemo = memoQuery.data ?? null;

  // isLoading = 데이터가 아직 없고(pending) 요청이 나가 있다(fetching). paused·idle 은 여기 안 걸린다.
  const openNow = sessionMemo !== null || !records.isLoading;
  // 래치는 방문마다 — 허브는 한 훅으로 시트 대상 방문을 바꿔 가며 쓴다(빈 id 일 때 열린 것이 다음 방문을 열면 안 된다).
  const [latchedFor, setLatchedFor] = useState<string | null>(null);
  if (openNow && latchedFor !== visitCheckId) setLatchedFor(visitCheckId);

  // TRIP-1426 — true = PUT 이 나가 성공, false = 건너뜀(공백·같은 값). 실패는 reject 그대로(호출자가 안내).
  async function saveMemo(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (trimmed === '') return false;
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
    memoReady: openNow || latchedFor === visitCheckId,
  };
}

/**
 * TRIP-1203 · 방문 여러 개의 메모를 한 번에 구독한다(id → 세션 저장본 ?? 서버 memo, 없으면 null) — i01 허브의 완료 카드 수는
 * 렌더마다 달라 반복문 안에서 useVisitMemo 를 부를 수 없다. `useQueries` = 쿼리 배열을 훅 한 번으로 구독.
 */
export function useSavedVisitMemos({
  tripId,
  visitCheckIds,
}: {
  tripId: string;
  visitCheckIds: readonly string[];
}): Record<string, string | null> {
  const results = useQueries({
    queries: visitCheckIds.map((visitCheckId) => ({
      queryKey: visitMemoKey(tripId, visitCheckId),
      ...sessionOnly,
    })),
  });
  const records = useTripRecords(tripId, visitCheckIds.length > 0);
  return Object.fromEntries(
    visitCheckIds.map((id, index) => [
      id,
      results[index]?.data ?? serverMemoOf(records.data, id),
    ])
  );
}
