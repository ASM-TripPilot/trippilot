import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import { getAutomationSink } from '@/shared/location';

export type RevertOutcome = 'ok' | 'media' | 'not-auto' | 'failed';

/**
 * TRIP-1340 · 자동 기록 되돌리기(§12.2 초안 `POST /trips/{tripId}/visits/{visitCheckId}/revert-auto`) — i01·j01 공용
 * 한 곳(G-U10-15: 두 useVisitCheck 중복은 이번 칸에서 합치지 않는다 — 되돌리기만 여기 하나로 둔다).
 * 지금은 가짜 싱크가 답한다. 성공하면 그 여행 방문 캐시를 무효화해 카드가 서버 값으로 따라온다.
 * 같은 틱 연타는 ref 잠금으로 막는다.
 */
export function useRevertAutoVisit(tripId: string): {
  revert: (visitCheckId: string) => Promise<RevertOutcome>;
  pending: boolean;
} {
  const queryClient = useQueryClient();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);

  const revert = useCallback(
    async (visitCheckId: string): Promise<RevertOutcome> => {
      if (lock.current) return 'failed';
      lock.current = true;
      setPending(true);
      try {
        const res = await getAutomationSink().revertAuto(tripId, visitCheckId);
        if (!res.ok)
          return res.code === 'VISIT_HAS_MEDIA' ? 'media' : 'not-auto';
        const prefix = `/trips/${tripId}/visits`;
        await queryClient.invalidateQueries({
          predicate: (q) => String(q.queryKey[0] ?? '').startsWith(prefix),
        });
        return 'ok';
      } catch {
        return 'failed';
      } finally {
        lock.current = false;
        setPending(false);
      }
    },
    [queryClient, tripId]
  );

  return { revert, pending };
}
