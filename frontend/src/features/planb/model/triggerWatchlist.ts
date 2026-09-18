import type { Trigger } from '@/shared/api/generated/schemas';

/**
 * TRIP-562 · triggerWatchlist — 발화 트리거 목록 → i09 감시 3항목 사영(projection).
 *
 * 개념 **사영(projection)**: 같은 `GET /triggers` 데이터를 "다른 모양으로 접는다". i08 칩은 발화
 * 목록을 그대로 쓰고(활성 트리거 제목), i09 감시 표면은 kind 3종별로 접는다 — 감시 행은 **활성 여부와
 * 무관히 상시 존재하는 카테고리**라 이름이 Figma 카테고리명(날씨·이동 지연·영업·휴무)이다.
 *
 *  - MANUAL 은 제외한다(사용자가 만드는 편집 요청이라 감시 표면에 안 뜬다, BR-U4-01) — 배너도 못
 *    몰고 어느 행도 active 로 못 만든다.
 *  - 배너 = 첫 non-MANUAL 트리거(`displayTriggers[0]`, `LiveItineraryPage.chipTrigger` 동형), 없으면
 *    null(INV-U4-01).
 *  - 행은 정확히 3개·고정 순서(WEATHER·DELAY·CLOSURE). 그 kind 가 발화 목록에 있으면 `active` +
 *    그 발화 사유(`reason`), 없으면 `normal`·null.
 *
 * node-safe: RN 런타임을 import 하지 않는다(`import type` 만) — 구조가드가 node 환경에서 스캔.
 */

export interface TriggerWatchlistRow {
  kind: 'WEATHER' | 'DELAY' | 'CLOSURE';
  /** Figma 카테고리명(상시 카테고리) — i08 칩의 활성 트리거 제목과 다른 표면. */
  label: string;
  status: 'active' | 'normal';
  /** 활성 kind 의 발화 사유(normal 이면 null). */
  reason: string | null;
}

/** 감시 표면 카테고리명(명명 상수 — 사영이 `row.label` 에 실어 나른다). */
const WATCH_CATEGORY_LABEL: Record<TriggerWatchlistRow['kind'], string> = {
  WEATHER: '날씨',
  DELAY: '이동 지연',
  CLOSURE: '영업·휴무',
};

/** 감시 3항목 고정 순서(입력 순서 무관). */
const WATCH_ORDER: TriggerWatchlistRow['kind'][] = [
  'WEATHER',
  'DELAY',
  'CLOSURE',
];

export function triggerWatchlist(triggers: Trigger[]): {
  activeBanner: Trigger | null;
  rows: TriggerWatchlistRow[];
} {
  const displayTriggers = triggers.filter(
    (trigger) => trigger.kind !== 'MANUAL'
  );
  const activeBanner = displayTriggers[0] ?? null;

  const rows = WATCH_ORDER.map((kind): TriggerWatchlistRow => {
    const fired = displayTriggers.find((trigger) => trigger.kind === kind);
    return {
      kind,
      label: WATCH_CATEGORY_LABEL[kind],
      status: fired ? 'active' : 'normal',
      reason: fired ? fired.reason : null,
    };
  });

  return { activeBanner, rows };
}
