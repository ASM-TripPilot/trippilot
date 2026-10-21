import type {
  ReplanSession,
  Trigger,
  TriggerDetail,
} from '@/shared/api/index.schemas';

import { TRIGGER_REASON_KEY } from '../config/replanChoices';

/**
 * 상황 감지 FE-B · frontend-components §3.2 · BR-SA-23 — 트리거 진입(triggerId 있는 Plan-B 진입)의 갈 곳 판정(순수).
 *
 * 재료는 두 조회(트리거 상세 · 그 트리거 날짜의 준비된 대안)와 3초 초과 여부뿐이다. 앱은 판정·임계를 모른다 — 서버가 준
 * 상태·`stale`·`currentTriggerId` 만 표에 대 본다. 위에서부터 처음 맞는 행:
 *
 *  1 상세 404                                     → `notFound` (없는 알림 · 다른 계정 은닉)
 *  2 조회 실패 · 3초 초과                           → `fallback` (i04 — URL 그대로, 기존 동작. 날짜는 서버가 강제한다 BR-SA-20)
 *  3 준비된 대안 APPLIED                            → `hub` applied
 *  4 없음·CANCELED·stale ∧ (ACTIVE ∨ current 있음)   → `request` (i04 시드)
 *  5 없음·CANCELED·stale ∧ ¬ACTIVE ∧ current 없음    → `hub` inactive
 *  6 DRAFT                                         → `draft` (i06 · 미리 준비한 대안)
 *  7 COLLECTING · SOLVING                          → `solving` (i05)
 *  8 NO_SOLUTION · FAILED                          → `draft` (i06 대안 없음·실패 얼굴 — 얼굴은 i06 이 세션 상태로 고른다)
 *
 * `stale` 은 APPLIED 가 아니면 상태와 무관하게 '없음'으로 읽는다(NO_SOLUTION·FAILED 포함). 계약 밖 상태(앱보다 새 서버가
 * 늘린 값)도 '없음'이다 — i06 은 모르는 상태에 그릴 얼굴이 없어 빈 화면이 된다(INV-4). 두 조회 중 하나라도 아직이고
 * 3초 전이면 `wait` — 대안·허브로 가는 결정은 두 조회가 다 준비됐을 때만 나온다(PBT-SA-21).
 *
 * i04 시드(행 4)는 **요청에 실릴 지금 알림의 심각도**로 정한다(사용자 결정 2026-10-20) — 위험일 때만 준비 세션 입력 또는
 * kind 사유를 켜고, 주의·모름은 빈 시드다(옛 위험 선계산의 사유·제외도 싣지 않는다). 사용자가 누른 알림이 해제 뒤 다시 선
 * 경우 요청에는 새 알림(`currentTriggerId`)이 실리는데 상세엔 그 심각도가 없다 — 떠 있는 목록(허브와 같은 쿼리)에서 읽는다.
 * 목록은 기다리지 않는다(판정 시점에 없으면 모름 — 결정 시점·3초 상한은 그대로).
 */

/** 한 조회의 결과 — 아직 · 404 · 그 밖의 실패(네트워크·5xx) · 받음. */
export type EntryLookup<T> =
  | { kind: 'pending' }
  | { kind: 'notFound' }
  | { kind: 'failed' }
  | { kind: 'found'; value: T };

export interface EntryRouteInput {
  trigger: EntryLookup<TriggerDetail>;
  /** 404 = 그 날짜에 준비된 대안 없음. */
  prepared: EntryLookup<ReplanSession>;
  /** 떠 있는 알림 목록(`GET /triggers`) — 아직·실패면 undefined(심각도를 모른다 → 시드를 켜지 않는다). */
  activeTriggers: readonly Trigger[] | undefined;
  timedOut: boolean;
  /** 'YYYY-MM-DD' — 오늘이면 i04 에 날짜를 싣지 않는다. */
  today: string;
}

/** i04 가 처음 켜 둘 입력(§3.3). */
export interface EntrySeed {
  reasons: string[];
  directives: string[];
  excludedPoiIds: string[];
}

export type EntryRoute =
  | { kind: 'wait' }
  | { kind: 'notFound' }
  | { kind: 'fallback' }
  | { kind: 'hub'; notice: 'applied' | 'inactive' }
  | {
      kind: 'request';
      triggerId: string;
      /** 오늘이 아닌 트리거 날짜 — i04 가 FULL_DAY 한 칩으로 연다. */
      targetDate?: string;
      /** 오늘 트리거의 범위(URL 원문과 같은 뜻 — i04 가 아는 값만 반영한다). */
      scope?: string;
      seed: EntrySeed;
    }
  | { kind: 'draft'; sessionId: string }
  | { kind: 'solving'; sessionId: string };

const EMPTY_SEED: EntrySeed = {
  reasons: [],
  directives: [],
  excludedPoiIds: [],
};

/** 준비된 대안으로 갈 수 있는 상태(행 6·7·8). 그 밖 — CANCELED·계약 밖 상태 — 는 '없음'(행 4·5)이다. */
const READY_STATUSES: ReadonlySet<string> = new Set([
  'DRAFT',
  'COLLECTING',
  'SOLVING',
  'NO_SOLUTION',
  'FAILED',
]);

/**
 * 요청에 실릴 지금 알림이 위험인가 — 원 트리거가 지금 떠 있으면(ACTIVE) 그 상세가 곧 지금 알림이고(목록과 같은 행, 더
 * 새 값), 해제 뒤 다시 선 알림이면 떠 있는 목록에서 그 id 를 찾는다. severity 가 없으면(옛 서버·옛 행) 위험이다 — 계약
 * (`Trigger.severity` "없으면 위험으로 읽는다")·domain-entities §2(열 기본 RISK)·허브 기회 카드(`hubOpportunity`)와 같다.
 * 목록을 모르거나 거기 없으면 모른다(false). 계약 밖 값도 위험으로 치지 않는다.
 */
function currentIsRisk(
  trigger: TriggerDetail,
  currentId: string,
  activeTriggers: readonly Trigger[] | undefined
): boolean {
  const current =
    trigger.state === 'ACTIVE'
      ? trigger
      : activeTriggers?.find((item) => item.triggerId === currentId);
  return current !== undefined && (current.severity ?? 'RISK') === 'RISK';
}

/** 지금 알림이 위험일 때만 — 준비 세션 입력(있으면 — CANCELED·stale 포함) → 아니면 kind 사유. 주의·모름은 빈 시드다. */
function seedOf(
  trigger: TriggerDetail,
  session: ReplanSession | null,
  risk: boolean
): EntrySeed {
  if (!risk) return EMPTY_SEED;
  if (session !== null) {
    return {
      reasons: session.reasons ?? [],
      directives: session.directives ?? [],
      excludedPoiIds: session.excludedPoiIds ?? [],
    };
  }
  return trigger.kind === 'MANUAL'
    ? EMPTY_SEED
    : { ...EMPTY_SEED, reasons: [TRIGGER_REASON_KEY[trigger.kind]] };
}

function requestRoute(
  trigger: TriggerDetail,
  session: ReplanSession | null,
  activeTriggers: readonly Trigger[] | undefined,
  today: string
): EntryRoute {
  const triggerId =
    trigger.state === 'ACTIVE'
      ? trigger.triggerId
      : (trigger.currentTriggerId ?? trigger.triggerId);
  const seed = seedOf(
    trigger,
    session,
    currentIsRisk(trigger, triggerId, activeTriggers)
  );
  if (trigger.affectedDate !== today) {
    return {
      kind: 'request',
      triggerId,
      targetDate: trigger.affectedDate,
      seed,
    };
  }
  return trigger.scope === 'FULL_DAY' || trigger.scope === 'PARTIAL_SLOTS'
    ? { kind: 'request', triggerId, scope: trigger.scope, seed }
    : { kind: 'request', triggerId, seed };
}

export function entryRoute({
  trigger,
  prepared,
  activeTriggers,
  timedOut,
  today,
}: EntryRouteInput): EntryRoute {
  if (trigger.kind === 'notFound') return { kind: 'notFound' };
  if (trigger.kind === 'failed' || prepared.kind === 'failed' || timedOut) {
    return { kind: 'fallback' };
  }
  if (trigger.kind === 'pending' || prepared.kind === 'pending') {
    return { kind: 'wait' };
  }

  const session = prepared.kind === 'found' ? prepared.value : null;
  if (session?.status === 'APPLIED') return { kind: 'hub', notice: 'applied' };
  if (
    session === null ||
    session.stale === true ||
    !READY_STATUSES.has(session.status)
  ) {
    const detail = trigger.value;
    return detail.state === 'ACTIVE' || detail.currentTriggerId
      ? requestRoute(detail, session, activeTriggers, today)
      : { kind: 'hub', notice: 'inactive' };
  }
  if (session.status === 'DRAFT') {
    return { kind: 'draft', sessionId: session.sessionId };
  }
  if (session.status === 'COLLECTING' || session.status === 'SOLVING') {
    return { kind: 'solving', sessionId: session.sessionId };
  }
  // 행 8 — READY 중 남은 NO_SOLUTION·FAILED(얼굴은 i06 이 세션 상태로 고른다).
  return { kind: 'draft', sessionId: session.sessionId };
}
