import type {
  Trigger,
  TriggerWatch,
  WatchStateStatus,
} from '@/shared/api/index.schemas';

import {
  WATCH_CATEGORY_LABEL,
  type WatchStatus,
} from '@/features/planb/index.view';

/**
 * TRIP-562 · triggerWatchlist — 발화 트리거 목록 → 감시 3항목 사영(projection).
 * TRIP-749 — 옛 i09 감시 목록 화면은 삭제됐고, 이 사영이 i03 위험 상세 시트의 배지 3개가 된다.
 *
 * 개념 **사영(projection)**: 같은 `GET /triggers` 데이터를 "다른 모양으로 접는다". 지도 알약은 발화
 * 목록의 첫 트리거를 쓰고, 감시 배지는 kind 3종별로 접는다 — 감시 행은 **활성 여부와 무관히 상시
 * 존재하는 카테고리**라 이름이 Figma 카테고리명(날씨·이동·영업, `config/watchLabels`)이다.
 *
 *  - MANUAL 은 제외한다(사용자가 만드는 편집 요청이라 감시 표면에 안 뜬다, BR-U4-01) — 배너도 못
 *    몰고 어느 행도 active 로 못 만든다.
 *  - 배너 = 첫 non-MANUAL 트리거(`displayTriggers[0]`, `LiveItineraryPage.chipTrigger` 동형), 없으면
 *    null(INV-U4-01).
 *  - 행 순서는 고정(WEATHER·DELAY·CLOSURE). 그 kind 가 발화 목록에 있으면 `active` + 그 발화 사유(`reason`).
 *  - 상황 감지 FE-B(frontend-components §3.5) — 발화가 없으면 응답 `watch`(출처 묶음별 감시 상태)를 읽는다:
 *    필드 없음(옛 서버) → 기존 `normal` · OFF → **행을 숨긴다** · UNKNOWN → `unknown`(확인 불가) · CHECKED → `normal`.
 *    발화한 사실은 감시 상태가 가리지 않는다(delay 는 늘 OFF 지만 DELAY 가 발화하면 활성 행이다). 거짓 '정상' 금지(INV-SA-2).
 *
 * node-safe: RN 런타임을 import 하지 않는다(`import type` 만) — 구조가드가 node 환경에서 스캔.
 */

export interface TriggerWatchlistRow {
  kind: 'WEATHER' | 'DELAY' | 'CLOSURE';
  /** Figma 카테고리명(상시 카테고리) — i08 칩의 활성 트리거 제목과 다른 표면. */
  label: string;
  status: WatchStatus;
  /** 활성 kind 의 발화 사유(그 밖이면 null). */
  reason: string | null;
}

/** 감시 3항목 고정 순서(입력 순서 무관). */
const WATCH_ORDER: TriggerWatchlistRow['kind'][] = [
  'WEATHER',
  'DELAY',
  'CLOSURE',
];

/** kind → 응답 `watch` 의 출처 묶음(BR-SA-13 ③). */
const WATCH_GROUP: Record<TriggerWatchlistRow['kind'], keyof TriggerWatch> = {
  WEATHER: 'weather',
  DELAY: 'delay',
  CLOSURE: 'closure',
};

/** 발화가 없는 행의 상태 — OFF 는 null(행 없음). 모르는 상태값은 확인 불가로 읽는다(거짓 '정상' 금지). */
function idleStatus(status: WatchStateStatus | undefined): WatchStatus | null {
  if (status === undefined || status === 'CHECKED') return 'normal';
  if (status === 'OFF') return null;
  return 'unknown';
}

export function triggerWatchlist(
  triggers: Trigger[],
  watch?: TriggerWatch
): {
  activeBanner: Trigger | null;
  rows: TriggerWatchlistRow[];
} {
  const displayTriggers = triggers.filter(
    (trigger) => trigger.kind !== 'MANUAL'
  );
  const activeBanner = displayTriggers[0] ?? null;

  const rows = WATCH_ORDER.flatMap((kind): TriggerWatchlistRow[] => {
    const label = WATCH_CATEGORY_LABEL[kind];
    const fired = displayTriggers.find((trigger) => trigger.kind === kind);
    if (fired) return [{ kind, label, status: 'active', reason: fired.reason }];
    const status = idleStatus(watch?.[WATCH_GROUP[kind]]?.status);
    return status === null ? [] : [{ kind, label, status, reason: null }];
  });

  return { activeBanner, rows };
}
