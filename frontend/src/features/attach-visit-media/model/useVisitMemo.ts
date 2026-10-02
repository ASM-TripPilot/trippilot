import { useQuery, useQueryClient } from '@tanstack/react-query';

import { putTripsTripIdVisitsVisitCheckIdMemo } from '@/shared/api/index.hooks';

/**
 * TRIP-1078 · 메모 세션 캐시(결정 2(b)) — 메모를 읽는 GET 이 없어서, PUT 에 성공한 텍스트를 Query 캐시
 * (`['visit-memo', tripId, visitCheckId]`)에 두고 `savedMemo` 로 노출한다. 카드가 다시 마운트되면 이 값으로
 * 입력칸을 시드한다. 앱을 다시 켜면 빈다(BE 조회 계약 전까지의 한계).
 *  - ★ 관찰자 쿼리를 `gcTime: Infinity` 로 건다 — 없으면 화면을 떠난 뒤 GC 가 값을 지운다.
 *  - 마지막 성공값과 같은 텍스트면 PUT 0회(blur 마다 같은 PUT 방지). 실패는 캐시에 안 남으므로 재시도는 나간다.
 *
 * TRIP-1117 · useVisitAttachments 에서 떼어 냈다 — i01 허브는 사진 목록 GET 없이(F6) 메모만 쓰므로, 허브와
 * j01 이 이 훅 하나로 같은 캐시 키를 공유한다(키를 두 곳에 적지 않는다).
 */
export function useVisitMemo({
  tripId,
  visitCheckId,
}: {
  tripId: string;
  visitCheckId: string;
}) {
  const queryClient = useQueryClient();
  const memoKey = ['visit-memo', tripId, visitCheckId];
  // 서버에서 읽지 않는다(enabled false) — saveMemo 가 setQueryData 로만 채우는 세션 저장소.
  const memoQuery = useQuery<string | null>({
    queryKey: memoKey,
    queryFn: () => null,
    enabled: false,
    gcTime: Infinity,
    staleTime: Infinity,
  });

  async function saveMemo(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === '') return;
    if (queryClient.getQueryData<string | null>(memoKey) === trimmed) return;
    await putTripsTripIdVisitsVisitCheckIdMemo(tripId, visitCheckId, {
      text: trimmed,
    });
    queryClient.setQueryData(memoKey, trimmed);
  }

  return { saveMemo, savedMemo: memoQuery.data ?? null };
}
