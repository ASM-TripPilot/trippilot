import { isNotFound } from '@/shared/api';

/**
 * TRIP-1757 · 보조 조회가 "보일 실패"인가 — 데이터가 아직 없고, 404 아닌 이유로 실패했다.
 * TanStack Query v5 는 데이터 없이 실패한 쿼리를 다시 가져오는 동안 `error` 를 비우고 `status` 를 pending 으로 되돌린다.
 * 그래서 `isError` 만 보면 [다시 시도]를 누르는 순간 안내가 꺼진다 — 누적 실패 횟수 `errorUpdateCount` 로 잇는다.
 * 형제 `LiveItineraryPage.failedUnlessNotFound`(TRIP-1753)와 같은 식의 페이지-로컬 사본이다(공용 승격은 하지 않았다).
 * ponytail: 404 뒤 재조회 중엔 error 가 비어 안내가 잠깐 설 수 있다 — 형제와 같은 한계.
 */
export function failedUnlessNotFound(query: {
  data: unknown;
  isError: boolean;
  error: unknown;
  errorUpdateCount: number;
}): boolean {
  if (query.data !== undefined) return false;
  return query.isError ? !isNotFound(query.error) : query.errorUpdateCount > 0;
}
