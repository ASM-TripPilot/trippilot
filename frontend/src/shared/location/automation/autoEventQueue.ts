import { seoulDate } from '@/shared/lib/seoulDate';

import type { CompletionSource, JudgeEmit } from './visitJudge';

/**
 * TRIP-1335 · 자동 결과 큐 (BR-U10-20·22 · business-logic-model §6 · API 초안 §12.1·§12.4).
 *
 * 순수 함수만 — 저장은 어댑터(localStore), 전송은 싱크(sink) 몫.
 * - 같은 eventId 는 한 번만 싣는다(재전송 멱등은 서버, 적재 중복 방지는 기기).
 * - 여행지(TRAVEL_ZONE=KST) 날짜가 바뀌면 남은 항목을 버리고 버린 수를 돌려준다 — 화면 1줄(침묵 실패 금지).
 * - 범위 판정(OUT_OF_WINDOW)은 서버 몫이다(BR-U10-21).
 *
 * ⚠️ 서버 계약 미등재 — 아래 본문 모양은 FD §12 초안이다. BE 개통 시 orval 타입으로 바꾼다.
 */

export interface AutoQueueItem {
  eventId: string;
  kind: 'ARRIVE' | 'COMPLETE';
  slotKey: string;
  poiId: string;
  occurredAt: string;
  completionSource?: CompletionSource;
  /** 여행지 기준 날짜 — 기기 내부용(서버로 보내지 않는다). */
  localDate: string;
}

/** §12.1 AutoVisitEvent — 좌표 필드가 없다(INV-U10-2). */
export interface AutoVisitEventBody {
  eventId: string;
  kind: 'ARRIVE' | 'COMPLETE';
  slotKey: string;
  poiId: string;
  occurredAt: string;
  completionSource?: CompletionSource;
}

export interface AutoVisitEventBatch {
  events: AutoVisitEventBody[];
}

export type BatchOutcome =
  | 'APPLIED'
  | 'ALREADY_RECORDED'
  | 'CONFLICT'
  | 'SUPPRESSED'
  | 'REJECTED_CONSENT'
  | 'OUT_OF_WINDOW';

export interface BatchItemResult {
  eventId: string;
  outcome: BatchOutcome;
}

/** 배치 1요청 항목 상한(§12.1 · SEC-U10-07). */
export const MAX_BATCH_EVENTS = 50;

export function toQueueItem(
  emit: JudgeEmit,
  meta: { poiId: string; eventId: string }
): AutoQueueItem {
  const at = new Date(emit.occurredAt);
  const base: AutoQueueItem = {
    eventId: meta.eventId,
    kind: emit.kind,
    slotKey: emit.slotKey,
    poiId: meta.poiId,
    occurredAt: at.toISOString(),
    localDate: seoulDate(at),
  };
  return emit.kind === 'COMPLETE'
    ? { ...base, completionSource: emit.completionSource }
    : base;
}

export function enqueue(
  queue: readonly AutoQueueItem[],
  item: AutoQueueItem
): AutoQueueItem[] {
  if (queue.some((q) => q.eventId === item.eventId)) return [...queue];
  return [...queue, item];
}

export function dropStale(
  queue: readonly AutoQueueItem[],
  tripLocalDate: string
): { queue: AutoQueueItem[]; dropped: number } {
  const kept = queue.filter((i) => i.localDate === tripLocalDate);
  return { queue: kept, dropped: queue.length - kept.length };
}

/** 큐 앞에서부터 상한까지, §12.1 키만 골라 싣는다(화이트리스트 — 잉여 필드가 새지 않는다). */
export function buildBatch(
  queue: readonly AutoQueueItem[],
  max: number = MAX_BATCH_EVENTS
): AutoVisitEventBatch {
  return {
    events: queue.slice(0, max).map((i) => {
      const body: AutoVisitEventBody = {
        eventId: i.eventId,
        kind: i.kind,
        slotKey: i.slotKey,
        poiId: i.poiId,
        occurredAt: i.occurredAt,
      };
      if (i.kind === 'COMPLETE' && i.completionSource) {
        body.completionSource = i.completionSource;
      }
      return body;
    }),
  };
}

/**
 * 항목별 결과 반영. 결과가 온 항목은 어떤 outcome 이든 큐에서 뺀다(서버 우선 — 409 류도 버림).
 * REJECTED_CONSENT 가 하나라도 있으면 큐 전체를 지우고 강등 신호를 낸다(BR-U10-45).
 */
export function applyBatchResults(
  queue: readonly AutoQueueItem[],
  results: readonly BatchItemResult[]
): { queue: AutoQueueItem[]; consentRejected: boolean } {
  if (results.some((r) => r.outcome === 'REJECTED_CONSENT')) {
    return { queue: [], consentRejected: true };
  }
  const answered = new Set(results.map((r) => r.eventId));
  return {
    queue: queue.filter((i) => !answered.has(i.eventId)),
    consentRejected: false,
  };
}

/** §12.4 자동화 구간 보고 — 좌표 없음. */
export interface IntervalReport {
  intervalId: string;
  kind: 'GEOFENCE_ARMED' | 'ROUTE_RECORDING';
  phase: 'START' | 'END';
  at: string;
  endReason?:
    | 'CLIENT_STOP'
    | 'PERMISSION_DOWNGRADE'
    | 'ACCURACY_REDUCED'
    | 'CONSENT_REVOKED'
    | 'TRIP_ENDED';
  pointCount?: number;
  regionCount?: number;
}

export function serializeIntervalReport(
  report: IntervalReport
): IntervalReport {
  const body: IntervalReport = {
    intervalId: report.intervalId,
    kind: report.kind,
    phase: report.phase,
    at: report.at,
  };
  if (report.endReason) body.endReason = report.endReason;
  if (report.pointCount != null) body.pointCount = report.pointCount;
  if (report.regionCount != null) body.regionCount = report.regionCount;
  return body;
}
