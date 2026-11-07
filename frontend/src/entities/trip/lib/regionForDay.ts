import type { TripDestination } from '@/shared/api/index.schemas';

/**
 * TRIP-1043 · 같이 짜기 진행 줄 앞에 붙일 "그날 여행지"(N일차, 1부터).
 *
 * 여행지를 seq 순서로 박수(nights)만큼 펼쳐 그날 칸의 지역을 고르고, 박수 합을 넘는 날(귀국일 포함)은
 * seq 가 가장 큰 여행지다 — g02 `nightlyBaseCards`(features/trip, 밤 단위, TRIP-1010 D7)와 같은 규칙을
 * 날 단위로 옮긴 것이다(형제 feature 라 import 불가). 여행지가 없으면 null(화면이 접두를 생략).
 * TRIP-1233 — h13 장소 추가의 후보 지역도 이 규칙을 쓴다(pages 슬라이스에서 entities 로 이사, 사본 금지).
 */
export function regionForDay(
  destinations: readonly TripDestination[],
  dayNumber: number
): string | null {
  return destinationForDay(destinations, dayNumber)?.region ?? null;
}

/** 같은 규칙으로 그날의 여행지 전체를 돌려준다 — 장소 조회가 이름과 코드를 함께 쓴다(TRIP-1809). */
export function destinationForDay(
  destinations: readonly TripDestination[],
  dayNumber: number
): TripDestination | null {
  if (destinations.length === 0) return null;
  const sorted = [...destinations].sort((a, b) => a.seq - b.seq);
  let remaining = dayNumber;
  for (const destination of sorted) {
    if (remaining <= destination.nights) return destination;
    remaining -= destination.nights;
  }
  return sorted[sorted.length - 1];
}

type DestinationRegion = Pick<TripDestination, 'region' | 'regionCode'>;

// `GET /places` 가 받는 코드 모양(시도 2자리·시군구 5자리) — 그 밖은 서버가 400 이다.
const REGION_CODE = /^\d{2}(\d{3})?$/;

/**
 * 여행지 → `GET /places` 지역 조건(TRIP-1809, 동명 지역 분리). **이름은 늘 함께 보낸다** — 새 서버는 코드가 이겨 한 곳만
 * 집고, 옛 서버는 모르는 코드를 무시하고 지금처럼 이름으로 조회한다(코드만 보내면 옛 서버에서 전국이 나간다).
 * 코드가 없거나 모양이 틀리면 이름만 보낸다 — 400 으로 목록을 잃지 않는다(INV-4).
 */
export function placeRegionQuery({ region, regionCode }: DestinationRegion): {
  region: string;
  regionCode?: string;
} {
  return regionCode && REGION_CODE.test(regionCode)
    ? { region, regionCode }
    : { region };
}

/**
 * 여행지들 → d04 주소 파라미터(같은 순서의 두 배열, `placeRegionQueries` 가 자리로 짝짓는다). 코드 없는 여행지가
 * 하나라도 있으면 짝이 어긋나므로 코드를 통째로 빼고 이름만 싣는다.
 */
export function placeRegionParams(destinations: readonly DestinationRegion[]): {
  region?: string[];
  regionCode?: string[];
} {
  if (destinations.length === 0) return {};
  const queries = destinations.map(placeRegionQuery);
  if (queries.some((query) => !query.regionCode)) {
    return { region: [...new Set(queries.map((query) => query.region))] };
  }
  const unique = [
    ...new Map(queries.map((query) => [query.regionCode, query])).values(),
  ];
  return {
    region: unique.map((query) => query.region),
    regionCode: unique.map((query) => query.regionCode as string),
  };
}

/** 주소 파라미터 하나 → 값 목록. expo-router 는 객체 href 의 배열을 쉼표로 합치므로(`region=중구,중구`) 나눈다 — 카탈로그 이름에 쉼표는 없다. */
function paramList(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((one) => one.split(','))
    .filter(Boolean);
}

/** d04 주소 파라미터 → 지역별 조회 조건. 이름과 코드는 자리로 짝짓고, 수가 다르면 엉뚱한 지역을 묻지 않게 코드를 버린다. */
export function placeRegionQueries(
  region: string | string[] | undefined,
  regionCode: string | string[] | undefined
): ReturnType<typeof placeRegionQuery>[] {
  const names = paramList(region);
  const codes = paramList(regionCode);
  return names.map((name, index) =>
    placeRegionQuery({
      region: name,
      regionCode: codes.length === names.length ? codes[index] : null,
    })
  );
}
