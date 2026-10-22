import { useGetStaysCurated } from '@/shared/api/index.hooks';
import type { CuratedStay } from '@/shared/api/index.schemas';

/**
 * 인기 숙소 목록(TRIP-1579 · `GET /stays/curated`, 인증 필요). 카탈로그 코드(regionCode)를 그대로 넘긴다 —
 * 카탈로그 이름('부산광역시')을 city 로 넘기면 빈 목록이다. 둘 다 오면 regionCode 만 보낸다(둘 다 = 400).
 *
 * `hidden` = 카드 줄을 숨길지. 조건 없음·게스트(요청 0)·로딩·실패·빈 목록이 전부 true — 줄이 비어 보이거나
 * 죽은 카드가 남지 않게 한 값으로 접는다(전체 보기 버튼은 이 값과 무관하게 소비처가 정한다).
 * 꺼진 쿼리도 캐시 값은 돌려주므로 게스트는 여기서 한 번 더 접는다(savedStays 선례).
 */
/**
 * TRIP-1603 — 운영 서버(main)는 `?city=` 만 받는다(`?regionCode=` 는 400 → 줄이 숨는다). 짧은 도시 이름을 아는 시도 코드(2자리 접두)는
 * city 로 묻는다 — 운영 시드(R__seed_curated_stay)의 도시 이름과 글자까지 같다. 개발 서버는 둘 다 받아 결과가 같다.
 * 운영에 regionCode(#1524)가 올라가면 이 표는 지워도 된다.
 */
const CITY_BY_SIDO: Readonly<Record<string, string>> = {
  '11': '서울',
  '26': '부산',
  '50': '제주',
  '28': '인천',
  '27': '대구',
};

export function useCuratedStays(args: {
  regionCode?: string;
  city?: string;
  isAuthed: boolean;
}): { items: CuratedStay[]; hidden: boolean } {
  const knownCity = args.regionCode
    ? CITY_BY_SIDO[args.regionCode.slice(0, 2)]
    : undefined;
  const params = knownCity
    ? { city: knownCity }
    : args.regionCode
      ? { regionCode: args.regionCode }
      : args.city
        ? { city: args.city }
        : undefined;
  const enabled = args.isAuthed && params !== undefined;
  const query = useGetStaysCurated(params, { query: { enabled } });
  const items = enabled && query.isSuccess ? query.data.items : [];
  return { items, hidden: items.length === 0 };
}
