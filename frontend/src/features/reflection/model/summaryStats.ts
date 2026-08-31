import type { TripSummaryStats } from '@/shared/api/generated/schemas';

/**
 * TRIP-572 · summaryStats — 요약 stats 를 표시 3셀로 변환(INV-U5-07 0채움 · 거리 대시).
 *
 * 무엇을 보장하나:
 *  - AC-4(INV-U5-07): 입력 결측(undefined·null)이어도 방문·사진은 0 으로 채운다(빈 칸 금지 —
 *    기본 카드가 이 값만으로 그려짐).
 *  - AC-2(BR-U5-39·error 프레임 실측): 이동 거리는 `hasLocationData:false` 면 "—"(0km 이 아니다 —
 *    "측정 못 함"과 "0km"를 섞지 않는다). true 면 `${km}km`.
 *  - **소요시간 필드 없음**(INV-3) — 거리만. 571 daily `statsCard.ts`(필드명 다름)는 안 건드리고
 *    j04 전용 신규 함수(shape 가 달라 공용화하면 두 화면이 결합 + 테스트된 모듈을 건드림, ponytail lite).
 *
 * ★ 571 statsCard 처럼 입력을 옵셔널로 받는다 — 서버 계약상 stats 는 required 지만, 클라 폴백은
 *   **응답 자체 결측**(네트워크 실패)까지 방어한다. `??` 는 null/undefined 만 대체 — 실제 0/12 는
 *   그대로 통과("빈 것"과 "0인 것"을 안 섞음).
 */

export interface SummaryStatCells {
  totalVisits: number;
  distanceText: string;
  totalPhotos: number;
}

export function summaryStats(
  stats?: TripSummaryStats | null
): SummaryStatCells {
  return {
    totalVisits: stats?.totalVisits ?? 0,
    distanceText: stats?.hasLocationData ? `${stats.totalDistanceKm}km` : '—',
    totalPhotos: stats?.totalPhotos ?? 0,
  };
}
