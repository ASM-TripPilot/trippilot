import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

/**
 * TRIP-1072 · 즉석 방문 이름 세션 캐시 — 피커가 고른 장소 이름(poiId → nameKo, 여행별)을 j01 이 읽는다.
 * VisitCheck 엔 이름이 없고 `GET /places/{poiId}` 도 없어서다. 서버 응답이라 Zustand 가 아니라 Query 캐시에
 * 둔다(README 상태 규칙). 관찰자가 없어도 이 세션 동안 남게 gcTime·staleTime 을 Infinity 로 건다 — 앱을
 * 다시 켜면 사라진다(재진입 이름 유지는 BE 몫).
 */

type SpontaneousNames = Readonly<Record<string, string>>;

const EMPTY: SpontaneousNames = {};
const FOREVER = { gcTime: Infinity, staleTime: Infinity };

const namesKey = (tripId: string) =>
  ['record', 'spontaneous-names', tripId] as const;

/** 그 여행의 이름 맵에 한 곳을 합쳐 넣는다(덮어쓰기 아님). */
export function rememberSpontaneousName(
  queryClient: QueryClient,
  tripId: string,
  poiId: string,
  nameKo: string
): void {
  const key = namesKey(tripId);
  // 관찰자 없이 만들어지는 쿼리도 gcTime Infinity 를 갖게 기본값을 먼저 건다.
  queryClient.setQueryDefaults(key, FOREVER);
  queryClient.setQueryData<SpontaneousNames>(key, (current) => ({
    ...current,
    [poiId]: nameKo,
  }));
}

/** 그 여행의 즉석 방문 이름 맵 — 첫 렌더부터 `{}`, 네트워크 0. */
export function useSpontaneousNames(tripId: string): SpontaneousNames {
  const queryClient = useQueryClient();
  const key = namesKey(tripId);
  const { data } = useQuery({
    queryKey: key,
    // 서버가 없다 — 재조회가 불려도 지금 캐시를 그대로 돌려줘 이름을 지우지 않는다.
    queryFn: () => queryClient.getQueryData<SpontaneousNames>(key) ?? EMPTY,
    initialData: EMPTY,
    ...FOREVER,
  });
  return data;
}
