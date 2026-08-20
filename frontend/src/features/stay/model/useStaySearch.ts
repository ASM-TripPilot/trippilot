import { useGetStaysSearch } from '@/shared/api/generated/stays/stays';
import type { GetStaysSearchParams } from '@/shared/api/generated/schemas';

/**
 * 생성 훅(`useGetStaysSearch`)을 도메인 이름으로 재수출한다(TRIP-179 D6, 얇은 재수출).
 * 보장하는 것은 "훅을 부르면 /stays/search가 호출되고 응답(items·degraded·
 * filterZeroReasons)이 그대로 돌아온다"까지다. 화면이 생성물 경로를 직접 보지 않게 하고,
 * 계약을 더할 자리를 미리 만든다 — 지금은 소비 화면이 없어 오류 정규화·기본 파라미터를
 * 추측하지 않는다(선행 투자 회피, 필요가 드러나는 칸에서 더한다).
 *
 * 2번째 인자 `options.enabled` 는 additive(TRIP-450 d05 통합 검색) — 통합 검색은 지역을 못
 * 특정하면 숙소 쿼리를 꺼야 헛호출(잘못된 region= 요청)을 막는다. 도메인 레벨 `{ enabled }` 를
 * 생성 훅이 요구하는 `{ query: { enabled } }` 로 매핑해 넘긴다. 미지정이면 기존 호출
 * (`useStaySearch()`·`useStaySearch(params)`)과 바이트 단위로 같다(무회귀).
 */
export function useStaySearch(
  params?: GetStaysSearchParams,
  options?: { enabled?: boolean }
) {
  return useGetStaysSearch(
    params,
    options === undefined ? undefined : { query: { enabled: options.enabled } }
  );
}
