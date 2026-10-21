import type { AutomationConfig } from './config';

/**
 * TRIP-1334 · 도착·완료 판정 리듀서 (BR-U10-12·14~19 · business-logic-model §5.1~5.3).
 *
 * iOS 지오펜스는 "체류" 이벤트를 주지 않는다 — 진입 wake 에서 진입 시각만 남기고, 이후 아무 wake
 * (표본 일괄 전달·다른 리전 이벤트·포그라운드 복귀)에서 "진입 후 3분 동안 이탈이 없었나"를 소급 확정한다.
 * 시각은 epoch ms. 순수 함수 — 같은 입력이면 같은 출력(결정론).
 *
 * 슬롯 상태:
 *   IDLE → ENTERED --(dwell 경과 + 근거 표본)--> ARRIVED --이탈--> EXIT_PENDING --(확인 창 경과)--> DONE | LEFT
 *                  --(dwell 경과, 근거 표본 없음)--> HELD (보류: 기록 없음, 이탈하면 IDLE)
 *   LEFT = 10분 미만 체류 후 이탈 — 자동 완료하지 않는다(수동 [방문 완료] 폴백, BR-U10-17).
 *   DONE = 완료·건너뜀·되돌림(서버 값 포함) — 더 내지 않는다.
 *
 * INV-3: emit 에는 시각(occurredAt)만 있고 체류 시간·소요시간을 싣지 않는다.
 */

export type SlotPhase =
  'IDLE' | 'ENTERED' | 'HELD' | 'ARRIVED' | 'EXIT_PENDING' | 'LEFT' | 'DONE';

export interface SlotJudgeState {
  phase: SlotPhase;
  enterAt?: number;
  arrivedAt?: number;
  exitAt?: number;
  /** 판정 창 안에 정확도 ≤ maxAccuracyM 표본이 있었나(BR-U10-12). */
  goodSample: boolean;
  /** 진입 시 리전 중심까지 거리(겹침 판정용, BR-U10-19). 모르면 없음. */
  distanceM?: number;
}

export interface JudgeState {
  /** 계획 순번(보조 규칙 BR-U10-18 의 "직전 슬롯"). */
  order: readonly string[];
  slots: Readonly<Record<string, SlotJudgeState>>;
  /** 가장 최근 정확 표본 시각(TRIP-1517). 없으면(옛 저장본 포함) 근거 없음. */
  lastGoodSampleAt?: number;
}

export type JudgeEvent =
  | { type: 'enter'; slotKey: string; at: number; distanceM?: number }
  | { type: 'exit'; slotKey: string; at: number }
  | { type: 'sample'; at: number; accuracyM: number }
  | { type: 'wake'; at: number }
  /** 서버(또는 사용자 수동) 상태 반영 — 서버 값이 이긴다(§5.2). */
  | {
      type: 'external';
      slotKey: string;
      status: 'arrived' | 'completed' | 'skipped' | 'suppressed';
      at: number;
    };

export type CompletionSource = 'AUTO_GEOFENCE_EXIT' | 'AUTO_NEXT_ARRIVAL';

export type JudgeEmit =
  | { kind: 'ARRIVE'; slotKey: string; occurredAt: number }
  | {
      kind: 'COMPLETE';
      slotKey: string;
      occurredAt: number;
      completionSource: CompletionSource;
    };

type JudgeConfig = Pick<
  AutomationConfig,
  | 'maxAccuracyM'
  | 'arriveDwellMs'
  | 'minStayForCompleteMs'
  | 'exitConfirmMs'
  | 'preEnterSampleMs'
>;

const IDLE: SlotJudgeState = { phase: 'IDLE', goodSample: false };

export function initialJudgeState(order: readonly string[]): JudgeState {
  const slots: Record<string, SlotJudgeState> = {};
  for (const key of order) slots[key] = IDLE;
  return { order: [...order], slots };
}

export function judge(
  state: JudgeState,
  event: JudgeEvent,
  now: number,
  config: JudgeConfig
): { state: JudgeState; emit: JudgeEmit[] } {
  const slots: Record<string, SlotJudgeState> = { ...state.slots };
  const emit: JudgeEmit[] = [];

  const at = event.type === 'wake' ? now : event.at;

  // 표본은 확정보다 먼저 반영한다 — 창 끝의 표본도 근거가 된다.
  let lastGoodSampleAt = state.lastGoodSampleAt;
  if (event.type === 'sample' && event.accuracyM <= config.maxAccuracyM) {
    lastGoodSampleAt = Math.max(lastGoodSampleAt ?? event.at, event.at);
    for (const key of Object.keys(slots)) {
      const s = slots[key];
      // 진입 직전 preEnterSampleMs 안의 표본도 인정한다 — 표본·진입 처리 순서가 갈려도 결과가 같게(TRIP-1517).
      const since =
        s.enterAt != null ? s.enterAt - config.preEnterSampleMs : s.arrivedAt;
      if (since == null || since > event.at) continue;
      if (
        s.phase === 'ENTERED' ||
        s.phase === 'ARRIVED' ||
        s.phase === 'EXIT_PENDING'
      ) {
        slots[key] = { ...s, goodSample: true };
      } else if (s.phase === 'HELD') {
        // 근거가 늦게 배달됐을 뿐이면 보류를 푼다 — 포그라운드 wake 가 표본보다 먼저 와 보류로 굳힌 경우(TRIP-1517 5-b).
        slots[key] = { ...s, phase: 'ENTERED', goodSample: true };
      }
    }
  }

  settle(state.order, slots, at, config, emit);

  if (event.type === 'enter' || event.type === 'exit') {
    const s = slots[event.slotKey];
    if (s) slots[event.slotKey] = applyMove(s, event, lastGoodSampleAt, config);
  } else if (event.type === 'external') {
    const s = slots[event.slotKey];
    if (s && s.phase !== 'DONE') {
      slots[event.slotKey] =
        event.status === 'arrived'
          ? s.phase === 'ARRIVED' || s.phase === 'EXIT_PENDING'
            ? s
            : { phase: 'ARRIVED', arrivedAt: event.at, goodSample: false }
          : { ...s, phase: 'DONE' };
    }
  }

  return {
    state: { order: state.order, slots, lastGoodSampleAt },
    emit,
  };
}

function applyMove(
  s: SlotJudgeState,
  event: Extract<JudgeEvent, { type: 'enter' | 'exit' }>,
  lastGoodSampleAt: number | undefined,
  config: JudgeConfig
): SlotJudgeState {
  if (event.type === 'enter') {
    if (s.phase === 'IDLE') {
      return {
        phase: 'ENTERED',
        enterAt: event.at,
        // 진입 직전 창 안에 정확 표본이 이미 처리됐으면 그것이 근거다(없으면 옛 저장본 포함 false).
        goodSample:
          lastGoodSampleAt != null &&
          lastGoodSampleAt >= event.at - config.preEnterSampleMs,
        distanceM: event.distanceM,
      };
    }
    // 확인 창 안 재진입 → 이탈 취소(settle 이 창 경과분을 이미 확정했다).
    if (s.phase === 'EXIT_PENDING') {
      return { ...s, phase: 'ARRIVED', exitAt: undefined };
    }
    return s;
  }
  // exit
  if (s.phase === 'ENTERED' || s.phase === 'HELD') return IDLE; // 지나가기 · 보류 해제
  if (s.phase === 'ARRIVED')
    return { ...s, phase: 'EXIT_PENDING', exitAt: event.at };
  return s;
}

function settle(
  order: readonly string[],
  slots: Record<string, SlotJudgeState>,
  at: number,
  config: JudgeConfig,
  emit: JudgeEmit[]
): void {
  // (1) 이탈 확정 — 다음 슬롯 도착보다 먼저(이탈을 잡았으면 보조 규칙이 필요 없다).
  for (const key of order) {
    const s = slots[key];
    if (s.phase !== 'EXIT_PENDING' || s.exitAt == null || s.arrivedAt == null)
      continue;
    if (at - s.exitAt < config.exitConfirmMs) continue;
    if (s.goodSample && s.exitAt - s.arrivedAt >= config.minStayForCompleteMs) {
      slots[key] = { ...s, phase: 'DONE' };
      emit.push({
        kind: 'COMPLETE',
        slotKey: key,
        occurredAt: s.exitAt,
        completionSource: 'AUTO_GEOFENCE_EXIT',
      });
    } else {
      slots[key] = { ...s, phase: 'LEFT' };
    }
  }

  // (2) 도착 확정 — 진입 후 dwell 동안 이탈이 없었다.
  const candidates: string[] = [];
  for (const key of order) {
    const s = slots[key];
    if (s.phase !== 'ENTERED' || s.enterAt == null) continue;
    if (at - s.enterAt < config.arriveDwellMs) continue;
    if (s.goodSample) candidates.push(key);
    else slots[key] = { ...s, phase: 'HELD' }; // 근거 표본 없음 → 보류(BR-U10-12)
  }
  if (candidates.length === 0) return;

  // 겹치는 리전: 같은 창의 후보 중 중심이 가장 가까운 하나(동률이면 계획 순번 앞)만(BR-U10-19).
  let winner = candidates[0];
  for (const key of candidates) {
    const d = slots[key].distanceM ?? Infinity;
    if (d < (slots[winner].distanceM ?? Infinity)) winner = key;
  }
  for (const key of candidates) if (key !== winner) slots[key] = IDLE;

  const w = slots[winner];
  const enterAt = w.enterAt as number;
  slots[winner] = { ...w, phase: 'ARRIVED', arrivedAt: enterAt };
  emit.push({ kind: 'ARRIVE', slotKey: winner, occurredAt: enterAt });

  // 보조 규칙: 직전 순번 슬롯이 도착 후 10분↑ 미완료면 다음 진입 시각으로 완료(BR-U10-18).
  // 이탈을 이미 잡은 슬롯(LEFT·EXIT_PENDING)에는 쓰지 않는다 — 이탈 시각을 알면서 체류를 늘리는 셈이다.
  const idx = order.indexOf(winner);
  if (idx > 0) {
    const prevKey = order[idx - 1];
    const prev = slots[prevKey];
    if (
      prev.phase === 'ARRIVED' &&
      prev.arrivedAt != null &&
      enterAt - prev.arrivedAt >= config.minStayForCompleteMs
    ) {
      slots[prevKey] = { ...prev, phase: 'DONE' };
      emit.push({
        kind: 'COMPLETE',
        slotKey: prevKey,
        occurredAt: enterAt,
        completionSource: 'AUTO_NEXT_ARRIVAL',
      });
    }
  }
}
