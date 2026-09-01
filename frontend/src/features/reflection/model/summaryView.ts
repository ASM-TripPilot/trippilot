import type {
  DayHighlight,
  TripSummaryEnvelope,
  TripSummaryStats,
  TripSummaryStatsDistanceSource,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-572 · j04 여행 요약 — 화면 분기·공유 게이트·방문 평탄화의 **판정 단일 출처**(순수 함수).
 * 화면이 자체 폴백/분기를 만들지 못하게 여기로 격리한다(571 reflectionFallback 선례 계승).
 *
 * 무엇을 보장하나:
 *  - AC-5(BR-U5-48): `shareEnabled` 는 오직 `ready` 로만 판정 — `summary` 유무가 흔들 수 없다.
 *  - AC-2(BR-U5-39): 지도↔목록 분기는 `hasLocationData` 하나에만 걸린다.
 *  - toOrderedVisitList: places 를 일자 넘어 전역 번호 1..N 으로 평탄화하되 입력 순서를 보존한다.
 *  - AC-3(BR-U5-43): distanceSource 라벨(근사/경로)은 고정 매핑이다(1차는 늘 VISIT_LINE="근사").
 *  - daySubtitle: places 만으로 파생 — Figma 테마 문구("바다와 골목")를 발명하지 않는다(BR-U5-31).
 */

export interface OrderedVisit {
  order: number;
  dayLabel: string;
  place: string;
}

/** 공유 진입점 활성 판정 — 종료·요약 전(`ready:false`)엔 항상 비활성(summary 유무 무관). */
export function shareEnabled(envelope: TripSummaryEnvelope): boolean {
  return envelope.ready === true;
}

/** 지도↔방문목록 분기 — 좌표를 하나도 못 찾았으면(`hasLocationData:false`) 목록으로 정직 degrade. */
export function resolveSummaryView(
  stats: TripSummaryStats
): 'MAP' | 'VISIT_LIST' {
  return stats.hasLocationData ? 'MAP' : 'VISIT_LIST';
}

/** highlights 의 places 를 일자 경계를 넘어 전역 번호 1..N 으로 평탄화한다(error 프레임 실측). */
export function toOrderedVisitList(highlights: DayHighlight[]): OrderedVisit[] {
  const out: OrderedVisit[] = [];
  for (const day of highlights) {
    for (const place of day.places ?? []) {
      out.push({
        order: out.length + 1,
        dayLabel: `Day${day.dayOrder}`,
        place,
      });
    }
  }
  return out;
}

/** 이동 거리 출처 라벨 — 사용자가 근사치를 실측으로 오해하지 않게(BR-U5-43). */
export function distanceSourceLabel(
  source: TripSummaryStatsDistanceSource
): string {
  return source === 'ROUTE' ? '경로' : '근사';
}

/** 날짜 카드 부제 — places 만으로 파생(≥2 는 첫→마지막, 1 은 그 이름, 0 은 빈 문자열). */
export function daySubtitle(places: string[]): string {
  if (places.length === 0) return '';
  if (places.length === 1) return places[0];
  return `${places[0]}→${places[places.length - 1]}`;
}
