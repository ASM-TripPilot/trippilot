import {
  MutationCache,
  QueryCache,
  QueryClient,
  type Mutation,
  type Query,
} from '@tanstack/react-query';

import { retryUnlessNotFound } from '@/shared/api';

// 복귀(앱이 백그라운드에서 앞으로 돌아옴) 때 다시 받지 않는 키 — 첫 조각(queryKey[0])으로 일치시킨다(TRIP-1714).
// 이유: 이 기기의 변경은 낙관 갱신·직접 무효화로 이미 정확하고(하트·본인 편집), 나머지는 배치 수집 카탈로그라
// 5탭이 한꺼번에 낡은 키를 다시 받는 팬아웃만 남는다. 다른 기기에서 바뀐 값은 재시작·직접 무효화 전까지 낡을 수 있다(수용).
// 여기 없는 키(`/trips`·일정·생성 감시 폴링·스택 화면·단건 `/places/{id}`)는 종전 기본(복귀 때 낡았으면 재조회)이다.
// 정확 일치라 `/places` 가 `/places/p1`, `/me` 가 `/me/settings` 를 끄지 않는다.
const NO_FOCUS_REFETCH = new Set<unknown>([
  '/me',
  '/me/profile',
  '/me/style',
  '/me/records',
  '/saved-places',
  '/saved-stays',
  '/stays/search',
  '/regions',
  '/places',
  '/places/multi',
]);

/** 재시도까지 끝난 최종 실패를 받는 자리(TRIP-1744) — 주지 않으면 콜백이 달리지 않는다. 보고처(Sentry)는 호출부가 정한다. */
export interface QueryFailureHandlers {
  onQueryError?: (error: unknown, query: Query<unknown, unknown>) => void;
  onMutationError?: (
    error: unknown,
    variables: unknown,
    onMutateResult: unknown,
    mutation: Mutation<unknown, unknown, unknown>
  ) => void;
}

// 서버 상태(TanStack Query)의 앱 전역 캐시 저장소를 만든다 — 부작용이 없어 앱(AppProviders)과 팬아웃 하네스가
// 같은 기본 옵션을 쓴다. retry 는 404 만 다시 묻지 않게 연다(TRIP-986 #063) — 404("없다")는 다시 물어도
// 답이 같고, 같은 캐시 키의 관찰자들은 요청 하나를 공유해 그 요청을 시작한 관찰자의 retry 가
// 적용되므로 페이지 단독 옵션만으로는 막히지 않는다. 복귀 재조회는 위 거부 목록이 키별로 정한다(TRIP-1714).
// 그 밖의 값은 그 값을 실제로 쓰는 소비 화면이 붙는 칸에서 근거와 함께 정한다(TRIP-179 D5).
export function createAppQueryClient(
  handlers: QueryFailureHandlers = {}
): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: handlers.onQueryError }),
    mutationCache: new MutationCache({ onError: handlers.onMutationError }),
    defaultOptions: {
      queries: {
        retry: retryUnlessNotFound,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: (query) =>
          !NO_FOCUS_REFETCH.has(query.queryKey[0]),
      },
    },
  });
}
