import { useGetTripsTripIdSummary } from '@/shared/api/generated/reflection/reflection';
import type {
  TripSummary,
  TripSummaryEnvelope,
  TripSummarySource,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-572 · useTripSummary — j04 요약 조회를 잇는 얇은 래퍼(재사용 1훅만, 새 HTTP 0).
 *
 * 무엇을 보장하나: `useGetTripsTripIdSummary`(생성 훅)를 감싸 `TripSummaryEnvelope` 를 그대로 낸다.
 * 아직 요약이 없으면 서버가 404 가 아니라 `ready:false` 를 주므로(openapi), envelope 자체를 페이지에
 * 넘겨 `shareEnabled`/`resolveSummaryView` 가 판정하게 한다(이 훅은 판정하지 않는다).
 *
 * `source`(AI|RULE|BASIC)는 **보존만** 하고 화면 분기에 안 쓴다(AI 미개통, BR-U5-33 — 571
 * useDailyReflection 동형). 표시 조립(summaryStats·toOrderedVisitList·daySubtitle)은 페이지 몫.
 *
 * ★ 재사용만 — orval 생성 훅을 감쌀 뿐 raw HTTP(customInstance·axios)를 새로 만들지 않는다(G5).
 */

export interface UseTripSummaryResult {
  /** ready·summary 봉투 — 공유 게이트·지도 분기의 근거(도착 전 undefined). */
  envelope: TripSummaryEnvelope | undefined;
  /** 요약 본문(없으면 undefined — ready:false 이거나 도착 전). */
  summary: TripSummary | undefined;
  /** source 보존(화면 분기 미사용, AI 미개통). */
  source: TripSummarySource | undefined;
  isPending: boolean;
  isError: boolean;
  /** 조회 재시도. */
  refetch: () => void;
}

export function useTripSummary(tripId: string): UseTripSummaryResult {
  const query = useGetTripsTripIdSummary(tripId);
  const envelope = query.data;
  const summary = envelope?.summary ?? undefined;

  return {
    envelope,
    summary,
    source: summary?.source,
    isPending: query.isPending,
    isError: query.isError,
    refetch: () => {
      void query.refetch();
    },
  };
}
