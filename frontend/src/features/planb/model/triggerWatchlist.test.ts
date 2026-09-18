/**
 * @jest-environment node
 */
import type { Trigger } from '@/shared/api/generated/schemas';

import { triggerWatchlist } from './triggerWatchlist';

/**
 * TRIP-562 · AC-1 — 발화 트리거 목록 → i09 감시 3항목 사영(projection).
 *
 * 개념 **사영(projection)**: 같은 `GET /triggers` 데이터를 "다른 모양으로 접는다". i08 칩은
 * 발화 목록을 그대로 쓰고, i09 감시 표면은 kind 3종별로 접는다. 감시 행은 **활성 여부와 무관히
 * 상시 존재하는 카테고리**라 이름이 Figma 카테고리명(날씨·이동 지연·영업·휴무)이다 — i08 칩의 활성
 * 트리거 제목('비 예보')과는 다른 표면(★1, 오케 교정 2026-08-29).
 *
 * 무엇을 보장하나:
 *  - 🔴 MANUAL 은 제외한다 — 배너도 못 몰고 어느 행도 active 로 못 만든다(BR-U4-01, ★8).
 *  - 🔴 배너 = 첫 non-MANUAL 트리거(`displayTriggers[0]`), 없으면 null(INV-U4-01).
 *  - 🔴 행은 **정확히 3개 · 고정 순서**(WEATHER·DELAY·CLOSURE), 각 행이 카테고리명(`label`)을 싣고,
 *    그 kind 가 발화 목록에 있으면 `status:'active'` + 그 발화 사유(`reason`), 없으면 normal·null.
 *
 * node-safe 잠금: `@jest-environment node` — 순수 함수가 RN 을 실수로 import 하면 node 에서 크래시.
 * 3동작 뼈대: 준비=발화 목록 → 실행=triggerWatchlist(...) → 단언=activeBanner·rows.
 */

/** 트리거 하나 — kind·scope·reason 만 케이스가 바꾼다(나머지는 계약 최소 필드). */
const mk = (over: Partial<Trigger> = {}): Trigger =>
  ({
    triggerId: 't1',
    kind: 'WEATHER',
    affectedDate: '2026-08-20',
    slotKey: null,
    reason: '비 예보 70%',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-08-20T09:00:00Z',
    ...over,
  }) as Trigger;

/** 기준선 = 발화 0. 카테고리명·고정 순서 3행 전부 normal·reason null. */
const NORMAL_ROWS = [
  { kind: 'WEATHER', label: '날씨', status: 'normal', reason: null },
  { kind: 'DELAY', label: '이동 지연', status: 'normal', reason: null },
  { kind: 'CLOSURE', label: '영업·휴무', status: 'normal', reason: null },
];

describe('🔴 triggerWatchlist (i09 사영)', () => {
  it('P1 빈 목록 → 배너 없음 + 3행 고정순서(카테고리명) 전부 정상', () => {
    expect(triggerWatchlist([])).toEqual({
      activeBanner: null,
      rows: NORMAL_ROWS,
    });
  });

  it('P2 WEATHER 발화 → 날씨 행 active + 발화 사유(reason) + 그 트리거가 배너', () => {
    const w = mk({ kind: 'WEATHER', reason: '비 예보 70%' });
    const result = triggerWatchlist([w]);

    expect(result.activeBanner).toBe(w);
    expect(result.rows[0]).toEqual({
      kind: 'WEATHER',
      label: '날씨',
      status: 'active',
      reason: '비 예보 70%',
    });
    expect(result.rows[1]).toEqual(NORMAL_ROWS[1]); // DELAY 정상
    expect(result.rows[2]).toEqual(NORMAL_ROWS[2]); // CLOSURE 정상
  });

  it('P3 MANUAL 만 실려도 → 배너 없음 + 전부 정상(MANUAL 제외, ★8)', () => {
    // MANUAL 은 사용자가 만드는 편집 요청이라 감시 표면에 안 뜬다(BR-U4-01). 배너도 행도 못 몬다.
    expect(triggerWatchlist([mk({ kind: 'MANUAL' })])).toEqual({
      activeBanner: null,
      rows: NORMAL_ROWS,
    });
  });

  it('P4 배너 = 첫 non-MANUAL(MANUAL 을 건너뛴다) + 그 행 사유를 싣는다', () => {
    const delay = mk({ kind: 'DELAY', reason: '도로 정체' });
    const result = triggerWatchlist([mk({ kind: 'MANUAL' }), delay]);

    expect(result.activeBanner).toBe(delay);
    expect(result.rows[1]).toEqual({
      kind: 'DELAY',
      label: '이동 지연',
      status: 'active',
      reason: '도로 정체',
    });
    expect(result.rows[0].status).toBe('normal');
    expect(result.rows[2].status).toBe('normal');
  });

  it('P5 입력 순서 무관 → 행은 항상 WEATHER·DELAY·CLOSURE 순, 배너는 첫 non-MANUAL', () => {
    const closure = mk({ kind: 'CLOSURE' });
    const weather = mk({ kind: 'WEATHER' });
    const result = triggerWatchlist([closure, weather]);

    expect(result.rows.map((row) => row.kind)).toEqual([
      'WEATHER',
      'DELAY',
      'CLOSURE',
    ]);
    expect(result.rows[0].status).toBe('active'); // WEATHER
    expect(result.rows[1].status).toBe('normal'); // DELAY
    expect(result.rows[2].status).toBe('active'); // CLOSURE
    expect(result.activeBanner).toBe(closure); // 입력 첫 non-MANUAL
  });
});
