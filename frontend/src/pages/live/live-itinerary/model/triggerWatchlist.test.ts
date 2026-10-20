/**
 * @jest-environment node
 */
import type { Trigger, TriggerWatch } from '@/shared/api/index.schemas';

import { triggerWatchlist } from './triggerWatchlist';

/**
 * TRIP-562 · AC-1 — 발화 트리거 목록 → 감시 3항목 사영(projection).
 * TRIP-749 · AC-5 — 옛 i09 감시 목록 화면은 삭제되고, 이 사영이 i03 위험 상세 시트의 **배지 3개**
 * 데이터가 된다. 카테고리명을 Figma i03 배지대로 `날씨 · 이동 · 영업` 으로 바꿨다(계약 플립 — 옛
 * `이동 지연`·`영업·휴무`). 순서·활성 판정·MANUAL 제외·배너 규칙은 그대로다.
 *
 * 개념 **사영(projection)**: 같은 `GET /triggers` 데이터를 "다른 모양으로 접는다". 지도 알약은
 * 발화 목록의 첫 트리거를 쓰고, 감시 배지는 kind 3종별로 접는다. 감시 행은 **활성 여부와 무관히
 * 상시 존재하는 카테고리**라 이름이 카테고리명이다 — 알약의 활성 트리거 라벨('비 예보')과는 다른 표면.
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
  { kind: 'DELAY', label: '이동', status: 'normal', reason: null },
  { kind: 'CLOSURE', label: '영업', status: 'normal', reason: null },
];

describe('🔴 triggerWatchlist (감시 배지 사영)', () => {
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
      label: '이동',
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

  it('P6 카테고리명은 Figma i03 배지 그대로 날씨·이동·영업 순이다 (TRIP-749 AC-5 · 티켓 완료 조건)', () => {
    expect(triggerWatchlist([]).rows.map((row) => row.label)).toEqual([
      '날씨',
      '이동',
      '영업',
    ]);
  });
});

/**
 * 상황 감지 FE-B · frontend-components §3.5 — 감시 행 3상태(응답 `watch`).
 *
 * 위에서부터 처음 맞는 줄: 그 kind 의 ACTIVE 가 있으면 `활성`(감시 상태보다 앞선다) → `watch` 필드 없음(옛 서버)이면
 * 기존 `정상` → OFF 면 **행을 숨긴다** → UNKNOWN 이면 `확인 불가`(unknown) → CHECKED 면 `정상`.
 * 거짓 '정상'을 그리지 않는 것이 목적이다(INV-SA-2 · G-SA-1). kind ↔ 묶음: WEATHER=weather · DELAY=delay · CLOSURE=closure.
 */
const watchOf = (
  weather: 'CHECKED' | 'UNKNOWN' | 'OFF',
  closure: 'CHECKED' | 'UNKNOWN' | 'OFF',
  delay: 'CHECKED' | 'UNKNOWN' | 'OFF' = 'OFF'
): TriggerWatch => ({
  weather: { status: weather },
  closure: { status: closure },
  delay: { status: delay },
});

describe('🔴 triggerWatchlist · 감시 3상태 (상황 감지 FE-B §3.5)', () => {
  it('W1 OFF 묶음의 행은 숨는다 — delay 는 늘 OFF 라 이동 행이 없다', () => {
    const { rows } = triggerWatchlist([], watchOf('CHECKED', 'CHECKED'));

    expect(rows.map((row) => row.kind)).toEqual(['WEATHER', 'CLOSURE']);
  });

  it('W2 UNKNOWN 이면 확인 불가(unknown), CHECKED 면 정상(normal)이다 — 사유는 없다', () => {
    const { rows } = triggerWatchlist([], watchOf('UNKNOWN', 'CHECKED'));

    expect(rows).toEqual([
      { kind: 'WEATHER', label: '날씨', status: 'unknown', reason: null },
      { kind: 'CLOSURE', label: '영업', status: 'normal', reason: null },
    ]);
  });

  it('W3 그 kind 의 ACTIVE 가 있으면 감시 상태보다 앞선다 — OFF·UNKNOWN 이어도 활성 행으로 보인다', () => {
    const delay = mk({ kind: 'DELAY', reason: '도로 정체' });
    const weather = mk({ kind: 'WEATHER', reason: '비 예보 70%' });

    const { rows } = triggerWatchlist(
      [delay, weather],
      watchOf('UNKNOWN', 'OFF', 'OFF')
    );

    expect(rows).toEqual([
      {
        kind: 'WEATHER',
        label: '날씨',
        status: 'active',
        reason: '비 예보 70%',
      },
      { kind: 'DELAY', label: '이동', status: 'active', reason: '도로 정체' },
    ]);
  });

  it('W4 전부 OFF(스윕 꺼짐)이고 발화도 없으면 행이 하나도 없다', () => {
    expect(triggerWatchlist([], watchOf('OFF', 'OFF')).rows).toEqual([]);
  });

  it('W5 watch 필드가 없으면(옛 서버) 기존 동작 그대로 — 3행 고정 순서, 발화 없으면 정상', () => {
    expect(triggerWatchlist([], undefined).rows).toEqual(NORMAL_ROWS);
  });

  it('W5b watch 는 왔는데 그 묶음이 빠졌으면 확인 불가다 — 정상은 옛 서버(watch 자체 없음)뿐이다(거짓 정상 금지)', () => {
    const partial = {
      closure: { status: 'OFF' },
      delay: { status: 'OFF' },
    } as unknown as TriggerWatch;

    expect(triggerWatchlist([], partial).rows).toEqual([
      { kind: 'WEATHER', label: '날씨', status: 'unknown', reason: null },
    ]);
  });

  it('W6 MANUAL 은 감시 상태와 무관하게 행을 못 만든다(CHECKED 날씨는 정상 그대로)', () => {
    const { rows } = triggerWatchlist(
      [mk({ kind: 'MANUAL' })],
      watchOf('CHECKED', 'OFF')
    );

    expect(rows).toEqual([
      { kind: 'WEATHER', label: '날씨', status: 'normal', reason: null },
    ]);
  });
});
