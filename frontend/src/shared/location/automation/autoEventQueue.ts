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
    | 'TRIP_ENDED'
    | 'USER_PAUSE';
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

// ── 구간 보고 큐 (TRIP-1409) ──────────────────────────────────────
// 자동 결과 큐와 같은 모양 — 순수 함수, 저장은 store, 전송은 engine. 단 순서가 의미다:
// START 가 서버에 닿기 전에 END 를 보내면 409 CONFLICT(시작 없는 끝)로 그 구간이 법정 로그에서 사라진다.

export interface PendingReport {
  tripId: string;
  report: IntervalReport;
}

/** 서버가 구간 보고를 거절한 사유. 네트워크·5xx 는 거절이 아니라 throw 다(= 재시도). */
export type ReportRejection =
  'AUTOMATION_DISABLED' | 'LOCATION_CONSENT_REQUIRED' | 'CONFLICT' | 'REJECTED';

export type ReportOutcome = { ok: true } | { ok: false; code: ReportRejection };

export type ReportDemote = 'server-disabled' | 'consent-rejected';

/** 같은 (intervalId, phase) 는 한 번만 싣는다 — 서버도 멱등이지만 큐가 불어나지 않게. */
export function enqueueReport(
  queue: readonly PendingReport[],
  item: PendingReport
): PendingReport[] {
  const dup = queue.some(
    (q) =>
      q.report.intervalId === item.report.intervalId &&
      q.report.phase === item.report.phase
  );
  return dup ? [...queue] : [...queue, item];
}

/**
 * 맨 앞 보고의 결과를 반영한다. 앞이 성공해야 다음으로 간다(호출자가 한 건씩 부른다).
 * - 성공·CONFLICT·REJECTED: 재시도해도 소용없으므로 뺀다.
 * - START 의 AUTOMATION_DISABLED·LOCATION_CONSENT_REQUIRED: 서버에 구간이 없다 → 그 구간 보고를 전부 빼고 강등 신호.
 */
export function settleHeadReport(
  queue: readonly PendingReport[],
  outcome: ReportOutcome
): {
  queue: PendingReport[];
  demote: ReportDemote | null;
  rejectedIntervalId: string | null;
} {
  const [head, ...rest] = queue;
  if (!head) return { queue: [], demote: null, rejectedIntervalId: null };
  if (!outcome.ok && head.report.phase === 'START') {
    const demote: ReportDemote | null =
      outcome.code === 'AUTOMATION_DISABLED'
        ? 'server-disabled'
        : outcome.code === 'LOCATION_CONSENT_REQUIRED'
          ? 'consent-rejected'
          : null;
    if (demote) {
      const id = head.report.intervalId;
      return {
        queue: rest.filter((q) => q.report.intervalId !== id),
        demote,
        rejectedIntervalId: id,
      };
    }
  }
  return { queue: rest, demote: null, rejectedIntervalId: null };
}
