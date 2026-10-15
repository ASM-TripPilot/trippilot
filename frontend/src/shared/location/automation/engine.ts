import { seoulDate } from '@/shared/lib/seoulDate';

import { selectRegions } from '../geofence';
import { resolveArming, type ArmingReason, type ArmingState } from './arming';
import {
  applyBatchResults,
  buildBatch,
  dropStale,
  enqueue,
  enqueueReport,
  serializeIntervalReport,
  settleHeadReport,
  type ReportDemote,
  toQueueItem,
  type IntervalReport,
} from './autoEventQueue';
import { AUTOMATION_CONFIG } from './config';
import type { NativeAdapters } from './native';
import type { PermissionSnapshot } from './permission';
import type { RawSample } from './routeDistance';
import { downsampleRoute } from './routeDownsample';
import type { AutomationSinkPort } from './sink';
import {
  withStore,
  type AutomationContext,
  type AutomationNotice,
  type AutomationState,
  type AutomationStore,
} from './store';
import {
  initialJudgeState,
  judge,
  type JudgeEmit,
  type JudgeEvent,
  type JudgeState,
} from './visitJudge';

/**
 * TRIP-1338 · U10 오케스트레이션 엔진 — 포그라운드 훅(useLocationAutomation)과 백그라운드 태스크(tasks.ts)가
 * 같은 함수를 부른다. React·page·feature 를 모른다. 네이티브·서버·저장소·시계는 전부 주입(`EngineDeps`).
 *
 * - ARMED 는 저장하지 않고 매번 `resolveArming` 으로 다시 계산한다(§3). 저장하는 것은 "열린 구간"뿐이다.
 * - 강등 = 즉시 해제(OS 해제 먼저) + 열린 구간 END 보고 + 안내 1줄(BR-U10-46). 푸시는 없다.
 * - 서버가 동의 없음(REJECTED_CONSENT · 경로 409)을 돌려주면 큐·원시 표본을 지우고 강등한다(BR-U10-45).
 * - 좌표는 원시 표본 파일과 OS 리전 등록에만 쓴다 — 로그·서버 본문에 싣지 않는다.
 */

export interface EngineDeps {
  store: AutomationStore;
  sink: AutomationSinkPort;
  native: NativeAdapters;
  now: () => number;
  newId: () => string;
}

export type EngineReason =
  ArmingReason | 'no-context' | 'native-register-failed' | 'consent-rejected';

export interface EngineStatus {
  state: ArmingState;
  reason: EngineReason;
  notice: AutomationNotice | null;
  droppedCount: number;
}

export interface ArmingCallInput {
  flagOn: boolean;
  snapshot: PermissionSnapshot;
  onHub: boolean;
}

const today = (deps: EngineDeps) => seoulDate(new Date(deps.now()));
const iso = (deps: EngineDeps) => new Date(deps.now()).toISOString();

const status = (
  state: AutomationState,
  armingState: ArmingState,
  reason: EngineReason
): EngineStatus => ({
  state: armingState,
  reason,
  notice: state.notice,
  droppedCount: state.droppedCount,
});

function endReasonOf(reason: string): NonNullable<IntervalReport['endReason']> {
  if (reason === 'consent-off' || reason === 'consent-rejected')
    return 'CONSENT_REVOKED';
  if (reason === 'outside-trip') return 'TRIP_ENDED';
  if (reason === 'approximate') return 'ACCURACY_REDUCED';
  if (
    reason === 'flag-off' ||
    reason === 'server-disabled' ||
    reason === 'client-stop'
  )
    return 'CLIENT_STOP';
  return 'PERMISSION_DOWNGRADE';
}

/** 보고를 영속 큐 끝에 얹는다(전송은 `flushReports`). 순서가 곧 START → END 순서다. */
function queueReport(
  state: AutomationState,
  tripId: string,
  r: IntervalReport
): AutomationState {
  return {
    ...state,
    pendingReports: enqueueReport(state.pendingReports, { tripId, report: r }),
  };
}

/**
 * 구간 보고 큐를 앞에서부터 한 건씩 보낸다 — 앞이 닿아야 다음(START 가 먼저 성공해야 END).
 * 네트워크 실패면 거기서 멈추고 큐를 둔다(다음 wake·포그라운드·flush 에서 재시도).
 */
async function flushReports(
  deps: EngineDeps,
  input: AutomationState
): Promise<{
  state: AutomationState;
  demote: ReportDemote | null;
  rejected: string[];
}> {
  let queue = input.pendingReports;
  let demote: ReportDemote | null = null;
  const rejected: string[] = [];
  while (queue.length > 0) {
    let outcome;
    try {
      outcome = await deps.sink.reportInterval(
        queue[0].tripId,
        serializeIntervalReport(queue[0].report)
      );
    } catch {
      break;
    }
    const settled = settleHeadReport(queue, outcome);
    queue = settled.queue;
    if (settled.demote) {
      // 동의 없음이 킬 스위치보다 앞선다 — 로컬 데이터를 지워야 하는 쪽이다.
      demote = demote === 'consent-rejected' ? demote : settled.demote;
      if (settled.rejectedIntervalId) rejected.push(settled.rejectedIntervalId);
    }
  }
  return { state: { ...input, pendingReports: queue }, demote, rejected };
}

/**
 * START 가 서버에서 거절됐다(킬 스위치·동의 없음) — 서버엔 구간도 법정 로그도 없으니 기기도 무장을 풀고 수동으로 내린다.
 * 거절된 구간은 열린 구간에서 뺀다(그 END 는 서버가 CONFLICT 로 돌려줄 것이므로 보내지 않는다).
 */
async function demoteOnRejectedStart(
  deps: EngineDeps,
  input: AutomationState,
  demote: ReportDemote,
  rejected: readonly string[]
): Promise<AutomationState> {
  let state: AutomationState = {
    ...input,
    intervals: input.intervals.filter((i) => !rejected.includes(i.intervalId)),
    serverEnabled: demote === 'server-disabled' ? false : input.serverEnabled,
  };
  if (demote === 'consent-rejected') state = wipeLocal(deps, state);
  return degrade(deps, state, demote, true);
}

function ensureJudge(
  state: AutomationState,
  ctx: AutomationContext
): AutomationState {
  if (state.judge?.date === ctx.date) return state;
  let js: JudgeState = initialJudgeState(ctx.slots.map((s) => s.slotKey));
  for (const v of ctx.visits) {
    js = judge(
      js,
      { type: 'external', slotKey: v.slotKey, status: v.status, at: v.at },
      v.at,
      AUTOMATION_CONFIG
    ).state;
  }
  return { ...state, judge: { date: ctx.date, state: js } };
}

function regionsFor(state: AutomationState, ctx: AutomationContext) {
  const slots = state.judge?.state.slots ?? {};
  const visits = Object.entries(slots).map(([slotKey, s]) => ({
    slotKey,
    arrivedAt: s.phase === 'ARRIVED' || s.phase === 'EXIT_PENDING' ? 'x' : null,
    // LEFT(짧은 체류 후 이탈)·DONE 은 더 감시하지 않는다.
    completedAt: s.phase === 'DONE' || s.phase === 'LEFT' ? 'x' : null,
    skippedAt: null,
  }));
  const suppressed = ctx.visits
    .filter((v) => v.status === 'suppressed')
    .map((v) => v.slotKey);
  return selectRegions(
    ctx.slots,
    visits,
    suppressed,
    ctx.date,
    AUTOMATION_CONFIG.maxRegions
  );
}

async function arm(
  deps: EngineDeps,
  input: AutomationState,
  ctx: AutomationContext
): Promise<{ state: AutomationState; ok: boolean; reason?: EngineReason }> {
  let state = ensureJudge(input, ctx);
  const open = (kind: 'GEOFENCE_ARMED' | 'ROUTE_RECORDING') =>
    state.intervals.some((i) => i.kind === kind);
  const startInterval = (kind: 'GEOFENCE_ARMED' | 'ROUTE_RECORDING') => {
    const i = {
      intervalId: deps.newId(),
      kind,
      startedAt: iso(deps),
    };
    state = queueReport(
      { ...state, intervals: [...state.intervals, i] },
      ctx.tripId,
      { ...i, phase: 'START', at: i.startedAt }
    );
  };
  // START 보고가 OS 등록보다 먼저다 — 서버가 거절(킬 스위치·동의 없음)하면 아무것도 무장하지 않는다.
  const settle = async () => {
    const f = await flushReports(deps, state);
    state = f.state;
    if (!f.demote) return null;
    state = await demoteOnRejectedStart(deps, state, f.demote, f.rejected);
    return f.demote;
  };

  if (!open('GEOFENCE_ARMED')) {
    startInterval('GEOFENCE_ARMED');
    const demoted = await settle();
    if (demoted) return { state, ok: false, reason: demoted };
  }
  const geo = await deps.native.armGeofences(regionsFor(state, ctx));
  if (!geo.armed) {
    const reason = geo.reason ?? 'native-register-failed';
    state = await degrade(deps, state, reason, true);
    return { state, ok: false, reason: 'native-register-failed' };
  }
  const route = await deps.native.startRouteRecording();
  if (route.recording && !open('ROUTE_RECORDING')) {
    startInterval('ROUTE_RECORDING');
    const demoted = await settle();
    if (demoted) return { state, ok: false, reason: demoted };
  }
  const asked = state.explainerAskedTrips.includes(ctx.tripId)
    ? state.explainerAskedTrips
    : [...state.explainerAskedTrips, ctx.tripId];
  return {
    state: { ...state, explainerAskedTrips: asked, notice: null },
    ok: true,
  };
}

/** OS 해제 먼저, 그다음 열린 구간 END 보고(P-BG-U10-6). 무장 중이었거나 force 면 안내 1줄을 남긴다. */
async function degrade(
  deps: EngineDeps,
  state: AutomationState,
  reason: string,
  force = false
): Promise<AutomationState> {
  const wasArmed = state.intervals.length > 0;
  if (wasArmed || force) {
    await deps.native.disarmGeofences();
    await deps.native.stopRouteRecording();
  }
  const tripId = state.ctx?.tripId;
  if (tripId) {
    for (const i of state.intervals) {
      state = queueReport(state, tripId, {
        intervalId: i.intervalId,
        kind: i.kind,
        phase: 'END',
        at: iso(deps),
        endReason: endReasonOf(reason),
      });
    }
    state = (await flushReports(deps, state)).state;
  }
  return {
    ...state,
    intervals: [],
    notice: wasArmed || force ? { kind: 'degraded', reason } : state.notice,
  };
}

function wipeLocal(deps: EngineDeps, state: AutomationState): AutomationState {
  for (const d of state.rawDates) deps.store.removeRaw(d);
  return { ...state, queue: [], rawDates: [] };
}

async function flushInner(
  deps: EngineDeps,
  input: AutomationState
): Promise<{
  state: AutomationState;
  dropped: number;
  consentRejected: boolean;
}> {
  const { queue, dropped } = dropStale(input.queue, today(deps));
  const reported = await flushReports(deps, input);
  let state: AutomationState = {
    ...reported.state,
    queue,
    droppedCount: input.droppedCount + dropped,
  };
  if (reported.demote) {
    // 재시도 끝에 늦게 거절된 START — 이미 무장한 기기를 내린다.
    const consent = reported.demote === 'consent-rejected';
    state = await demoteOnRejectedStart(
      deps,
      state,
      reported.demote,
      reported.rejected
    );
    return { state, dropped, consentRejected: consent };
  }
  const tripId = state.ctx?.tripId;
  if (!tripId || state.queue.length === 0)
    return { state, dropped, consentRejected: false };
  try {
    const res = await deps.sink.sendAutoEvents(tripId, buildBatch(state.queue));
    const applied = applyBatchResults(state.queue, res.results);
    state = {
      ...state,
      queue: applied.queue,
      serverEnabled: res.automationEnabled,
    };
    if (applied.consentRejected) {
      state = wipeLocal(deps, state);
      state = await degrade(deps, state, 'consent-rejected');
      return { state, dropped, consentRejected: true };
    }
    if (!res.automationEnabled)
      state = await degrade(deps, state, 'server-disabled');
  } catch {
    // 네트워크 실패 — 큐 유지, 다음 wake/포그라운드에서 재시도(§6).
  }
  return { state, dropped, consentRejected: false };
}

function applyEmits(
  deps: EngineDeps,
  state: AutomationState,
  ctx: AutomationContext,
  emits: JudgeEmit[]
): AutomationState {
  let queue = state.queue;
  for (const e of emits) {
    const poiId = ctx.slots.find((s) => s.slotKey === e.slotKey)?.poiId;
    if (!poiId) continue;
    queue = enqueue(queue, toQueueItem(e, { poiId, eventId: deps.newId() }));
  }
  return { ...state, queue };
}

function runJudge(
  state: AutomationState,
  events: JudgeEvent[],
  now: number
): { state: AutomationState; emits: JudgeEmit[] } {
  if (!state.judge) return { state, emits: [] };
  let js = state.judge.state;
  const emits: JudgeEmit[] = [];
  for (const ev of events) {
    const out = judge(
      js,
      ev,
      ev.type === 'wake' ? now : ev.at,
      AUTOMATION_CONFIG
    );
    js = out.state;
    emits.push(...out.emit);
  }
  return {
    state: { ...state, judge: { date: state.judge.date, state: js } },
    emits,
  };
}

const isArmed = (s: AutomationState) =>
  s.intervals.some((i) => i.kind === 'GEOFENCE_ARMED');

// ── 공개 API ─────────────────────────────────────────────────────

export function setContext(
  deps: EngineDeps,
  ctx: AutomationContext
): Promise<void> {
  return withStore(async () => {
    const { state } = deps.store.load();
    deps.store.save({ ...state, ctx });
  });
}

export function evaluate(
  deps: EngineDeps,
  input: ArmingCallInput
): Promise<EngineStatus> {
  return withStore(async () => {
    const { state: loaded } = deps.store.load();
    if (!input.flagOn) return status(loaded, 'MANUAL', 'flag-off');
    const ctx = loaded.ctx;
    if (!ctx) return status(loaded, 'MANUAL', 'no-context');

    const day = today(deps);
    const arming = resolveArming({
      flagOn: input.flagOn,
      serverEnabled: loaded.serverEnabled,
      ...input.snapshot,
      consentOn: ctx.consentOn,
      inTripWindow: ctx.startDate <= day && day <= ctx.endDate,
      onHub: input.onHub,
      explainerAsked: loaded.explainerAskedTrips.includes(ctx.tripId),
    });

    let state = loaded;
    let reason: EngineReason = arming.reason;
    let armingState = arming.state;
    if (arming.state === 'ARMED') {
      const out = await arm(deps, state, ctx);
      state = out.state;
      if (!out.ok) {
        armingState = 'MANUAL';
        reason = out.reason ?? 'native-register-failed';
      }
    } else if (state.intervals.length > 0) {
      state = await degrade(deps, state, arming.reason);
    }
    // 위치 동의 철회 즉시 원시 표본·미전송 결과를 지운다(BR-U10-42).
    if (!ctx.consentOn) state = wipeLocal(deps, state);
    deps.store.save(state);
    return status(state, armingState, reason);
  });
}

export function handleGeofence(
  deps: EngineDeps,
  ev: { slotKey: string; type: 'enter' | 'exit'; distanceM?: number }
): Promise<void> {
  return withStore(async () => {
    const { state: loaded } = deps.store.load();
    const ctx = loaded.ctx;
    if (!ctx || !isArmed(loaded)) return;
    const now = deps.now();
    const judged = runJudge(
      ensureJudge(loaded, ctx),
      [{ ...ev, at: now }],
      now
    );
    let state = applyEmits(deps, judged.state, ctx, judged.emits);
    if (judged.emits.length > 0)
      await deps.native.armGeofences(regionsFor(state, ctx));
    state = (await flushInner(deps, state)).state;
    deps.store.save(state);
  });
}

export function handleLocations(
  deps: EngineDeps,
  samples: readonly RawSample[]
): Promise<void> {
  return withStore(async () => {
    const { state: loaded } = deps.store.load();
    const ctx = loaded.ctx;
    if (!ctx || !isArmed(loaded) || samples.length === 0) return;

    let state = loaded;
    const byDate = new Map<string, RawSample[]>();
    for (const s of samples) {
      const d = seoulDate(new Date(s.t));
      byDate.set(d, [...(byDate.get(d) ?? []), s]);
    }
    const rawDates = new Set(state.rawDates);
    for (const [d, list] of byDate) {
      deps.store.writeRaw(d, [...deps.store.readRaw(d), ...list]);
      rawDates.add(d);
    }
    state = { ...state, rawDates: [...rawDates].sort() };

    const now = deps.now();
    const events: JudgeEvent[] = [
      ...[...samples]
        .sort((a, b) => a.t - b.t)
        .map((s): JudgeEvent => ({
          type: 'sample',
          at: s.t,
          accuracyM: s.acc,
        })),
      { type: 'wake', at: now },
    ];
    const judged = runJudge(ensureJudge(state, ctx), events, now);
    state = applyEmits(deps, judged.state, ctx, judged.emits);
    if (judged.emits.length > 0)
      await deps.native.armGeofences(regionsFor(state, ctx));
    state = (await flushInner(deps, state)).state;
    deps.store.save(state);
  });
}

export function flushQueue(
  deps: EngineDeps
): Promise<{ dropped: number; consentRejected: boolean }> {
  return withStore(async () => {
    const { state } = deps.store.load();
    const out = await flushInner(deps, state);
    deps.store.save(out.state);
    return { dropped: out.dropped, consentRejected: out.consentRejected };
  });
}

/** 여행지 날짜가 지난 원시 표본을 다운샘플해 올린다(포그라운드 전용 — P-PERF-U10-1). */
export function uploadPendingRoutes(deps: EngineDeps): Promise<void> {
  return withStore(async () => {
    let { state } = deps.store.load();
    const ctx = state.ctx;
    if (!ctx) return;
    const day = today(deps);
    const keep: string[] = [];
    for (const date of state.rawDates) {
      if (date >= day) {
        keep.push(date);
        continue;
      }
      const body = downsampleRoute(deps.store.readRaw(date), AUTOMATION_CONFIG);
      if (body.segments.length === 0) {
        deps.store.removeRaw(date); // 올릴 것이 없다 — 그날은 근사(VISIT_LINE)
        continue;
      }
      try {
        const res = await deps.sink.uploadRoute(ctx.tripId, date, body);
        if (res.ok) {
          deps.store.removeRaw(date);
        } else if (res.code === 'CONSENT_REQUIRED') {
          state = wipeLocal(deps, { ...state, rawDates: [] });
          for (const d of [...keep, date]) deps.store.removeRaw(d);
          state = await degrade(deps, state, 'consent-rejected');
          deps.store.save({ ...state, rawDates: [] });
          return;
        } else {
          deps.store.removeRaw(date); // 서버가 구간 밖이라 거절 — 재시도 무의미
        }
      } catch {
        // 업로드 실패 — 여행 종료 + 1일까지 재시도, 그 뒤 삭제 + 1줄(BR-U10-35)
        const expired = date > ctx.endDate || day > addDays(ctx.endDate, 1);
        if (expired) {
          deps.store.removeRaw(date);
          state = { ...state, notice: { kind: 'route-expired', reason: date } };
        } else {
          keep.push(date);
        }
      }
    }
    deps.store.save({ ...state, rawDates: keep });
  });
}

export function markExplainerAsked(
  deps: EngineDeps,
  tripId: string
): Promise<void> {
  return withStore(async () => {
    const { state } = deps.store.load();
    if (state.explainerAskedTrips.includes(tripId)) return;
    deps.store.save({
      ...state,
      explainerAskedTrips: [...state.explainerAskedTrips, tripId],
    });
  });
}

export function clearNotice(deps: EngineDeps): Promise<void> {
  return withStore(async () => {
    const { state } = deps.store.load();
    deps.store.save({ ...state, notice: null, droppedCount: 0 });
  });
}

/** 위치 동의 철회·로그아웃·계정 삭제 — OS 해제 → END 보고 → 저장소 폴더째 삭제(LC-U10-7). */
export function wipeAutomation(
  deps: EngineDeps,
  endReason: 'CONSENT_REVOKED' | 'CLIENT_STOP'
): Promise<void> {
  return withStore(async () => {
    const { state } = deps.store.load();
    await degrade(
      deps,
      state,
      endReason === 'CONSENT_REVOKED' ? 'consent-off' : 'client-stop',
      true
    );
    deps.store.wipe();
  });
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
