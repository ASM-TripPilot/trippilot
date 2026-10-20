import { useGetPlacesPoiId } from '@/shared/api/index.hooks';

/**
 * 상황 감지 FE-B · frontend-components §3.6 — i06 미포함 안내(`‘{장소}’은 이번 안에 넣지 못했어요.`)의 장소 이름 seam.
 *
 * 넣으려던 POI 는 초안에 없으니(그래서 안내한다) 초안·일정에서 이름을 찾을 수 없다 — 등록 POI 단건 조회(`GET /places/{poiId}`)로
 * 읽는다. 라우트로는 `includePoiId` 하나만 잇는다(정본 §3.6 — i05·i06 라우트가 한 줄씩 읽는다).
 *
 * 돌려주는 값: undefined = 아직(또는 물을 POI 없음 → 요청 0) · string = 이름 · null = 실패(이름 없이 안내 — INV-4).
 * 재시도하지 않는다 — 안내 한 줄이 늦게 뜨는 것보다 실패를 바로 이름 없는 문장으로 접는 편이 낫다.
 */
export function useIncludedPlaceName(
  poiId: string | null
): string | null | undefined {
  const place = useGetPlacesPoiId(poiId ?? '', {
    query: { enabled: poiId !== null, retry: false },
  });
  if (poiId === null) return undefined;
  if (place.data !== undefined) return place.data.nameKo;
  return place.isError ? null : undefined;
}
