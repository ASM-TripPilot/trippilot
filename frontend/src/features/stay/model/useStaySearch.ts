import { useGetStaysSearch } from '@/shared/api/generated/stays/stays';
import type { GetStaysSearchParams } from '@/shared/api/generated/schemas';

/**
 * 생성 훅(`useGetStaysSearch`)을 도메인 이름으로 재수출한다(TRIP-179 D6, 얇은 재수출).
 * 보장하는 것은 "훅을 부르면 /stays/search가 호출되고 응답(items·degraded·
 * filterZeroReasons)이 그대로 돌아온다"까지다. 화면이 생성물 경로를 직접 보지 않게 하고,
 * 계약을 더할 자리를 미리 만든다 — 지금은 소비 화면이 없어 오류 정규화·기본 파라미터를
 * 추측하지 않는다(선행 투자 회피, 필요가 드러나는 칸에서 더한다).
 */
export function useStaySearch(params?: GetStaysSearchParams) {
  return useGetStaysSearch(params);
}
