/**
 * @jest-environment node
 */
import fc from 'fast-check';

import type {
  ReplanSession,
  ReplanSessionStatus,
  Trigger,
  TriggerDetail,
  TriggerDetailState,
} from '@/shared/api/index.schemas';

import {
  entryRoute,
  type EntryLookup,
  type EntryRoute,
  type EntryRouteInput,
} from './entryRoute';

/**
 * 상황 감지 FE-B · frontend-components §3.2 · BR-SA-23 · PBT-SA-21 — 트리거 진입 판정(순수).
 *
 * 판정표(위에서부터 처음 맞는 행. `stale` 은 APPLIED 가 아니면 상태와 무관하게 '없음'으로 읽는다):
 *  1 상세 404                                   → 404 얼굴
 *  2 조회 실패 · 3초 초과                         → i04, URL 그대로(기존 동작)
 *  3 준비된 대안 APPLIED                          → 허브 + '이미 반영한 대안이에요'
 *  4 없음·CANCELED·stale ∧ (ACTIVE ∨ current 있음) → i04 시드(사유·지시·제외, 날짜·범위)
 *  5 없음·CANCELED·stale ∧ ¬ACTIVE ∧ current 없음  → 허브 + '지금은 해당하지 않는 알림이에요'
 *  6 DRAFT                                       → i06(미리 준비한 대안)
 *  7 COLLECTING·SOLVING                          → i05
 *  8 NO_SOLUTION·FAILED                          → i06 대안 없음·실패 얼굴
 * 두 조회 중 하나라도 아직이고 3초 전이면 기다린다.
 *
 * i04 시드(행 4)는 요청에 실릴 지금 알림의 심각도로 정한다(사용자 결정 2026-10-20) — 위험일 때만 차고, 주의·모름은 빈
 * 시드다. 원 트리거가 지금 떠 있으면 상세가, 해제 뒤 다시 선 알림이면 떠 있는 목록이 그 심각도를 준다. severity 가
 * 없으면(옛 서버) 위험이다(계약 · domain-entities §2 · hubOpportunity 관례).
 *
 * node-safe 잠금(`@jest-environment node`). 3동작: 준비(두 조회 결과·시간 초과) → 실행(entryRoute) → 단언(갈 곳).
 */

const TODAY = '2026-10-19';
const TOMORROW = '2026-10-20';

const detail = (over: Partial<TriggerDetail> = {}): TriggerDetail =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: TODAY,
    slotKey: null,
    reason: '오후에 비 소식이 있어요',
    scope: 'PARTIAL_SLOTS',
    detectedAt: '2026-10-19T00:15:00Z',
    severity: 'RISK',
    state: 'ACTIVE',
    currentTriggerId: 'trg-1',
    ...over,
  }) as TriggerDetail;

const session = (
  status: ReplanSessionStatus,
  over: Partial<ReplanSession> = {}
): ReplanSession =>
  ({
    sessionId: 'sys-1',
    tripId: 't1',
    itineraryId: 'it1',
    triggerId: 'trg-1',
    scope: 'FULL_DAY',
    targetDate: TODAY,
    fromInstant: '2026-10-19T00:15:00Z',
    originKind: 'STAY_ANCHOR',
    originEstimated: true,
    reasons: ['WEATHER'],
    directives: ['AVOID_OUTDOOR'],
    excludedPoiIds: ['poi-out'],
    status,
    createdAt: '2026-10-19T00:16:00Z',
    initiatedBy: 'SYSTEM',
    stale: false,
    ...over,
  }) as ReplanSession;

const found = <T>(value: T): EntryLookup<T> => ({ kind: 'found', value });
const NONE: EntryLookup<ReplanSession> = { kind: 'notFound' };
const EMPTY_SEED = { reasons: [], directives: [], excludedPoiIds: [] };

/** 떠 있는 목록의 트리거 한 줄(목록엔 state·currentTriggerId 가 없다). */
const listed = (triggerId: string, severity: Trigger['severity']): Trigger => {
  const {
    state: _state,
    currentTriggerId: _current,
    ...trigger
  } = detail({ triggerId, severity });
  return trigger;
};
/** 계약 밖 상태 — 앱보다 새 서버가 enum 을 늘린 경우(OTA 가 없어 옛 앱이 받는다). */
const UNKNOWN_STATUS = 'PAUSED' as ReplanSessionStatus;

function route(over: Partial<EntryRouteInput> = {}): EntryRoute {
  return entryRoute({
    trigger: found(detail()),
    prepared: NONE,
    activeTriggers: [listed('trg-1', 'RISK')],
    timedOut: false,
    today: TODAY,
    ...over,
  });
}

describe('🔴 entryRoute · 판정표 대표 행 (§3.2)', () => {
  it('R1 상세 404 → 404 얼굴(3초가 지났어도 먼저다)', () => {
    expect(route({ trigger: { kind: 'notFound' } })).toEqual({
      kind: 'notFound',
    });
    expect(route({ trigger: { kind: 'notFound' }, timedOut: true })).toEqual({
      kind: 'notFound',
    });
  });

  it.each([
    ['상세 실패', { trigger: { kind: 'failed' } }],
    ['준비된 대안 조회 실패', { prepared: { kind: 'failed' } }],
    [
      '상세를 기다리다 3초 초과',
      { trigger: { kind: 'pending' }, timedOut: true },
    ],
    [
      '준비된 대안을 기다리다 3초 초과',
      { prepared: { kind: 'pending' }, timedOut: true },
    ],
  ] as [string, Partial<EntryRouteInput>][])(
    'R2 %s → i04 URL 그대로(막다른 길 없음)',
    (_name, over) => {
      expect(route(over)).toEqual({ kind: 'fallback' });
    }
  );

  it('R2b 3초 전에 아직 하나라도 안 왔으면 기다린다', () => {
    expect(
      route({ trigger: { kind: 'pending' }, prepared: { kind: 'pending' } })
    ).toEqual({ kind: 'wait' });
    expect(route({ prepared: { kind: 'pending' } })).toEqual({ kind: 'wait' });
  });

  it('R3 APPLIED → 허브 + 이미 반영 안내 — stale 이어도 APPLIED 가 먼저다', () => {
    expect(route({ prepared: found(session('APPLIED')) })).toEqual({
      kind: 'hub',
      notice: 'applied',
    });
    expect(
      route({ prepared: found(session('APPLIED', { stale: true })) })
    ).toEqual({ kind: 'hub', notice: 'applied' });
  });

  it('R4 대안 없음 ∧ 트리거 ACTIVE → i04 — 그 트리거 · kind 사유 시드 · 오늘이면 트리거 범위', () => {
    expect(route()).toEqual({
      kind: 'request',
      triggerId: 'trg-1',
      scope: 'PARTIAL_SLOTS',
      seed: { reasons: ['WEATHER'], directives: [], excludedPoiIds: [] },
    });
  });

  it('R5 대안 없음 ∧ ACTIVE 아님 ∧ current 없음 → 허브 + 해당하지 않는 알림 안내', () => {
    expect(
      route({
        trigger: found(detail({ state: 'EXPIRED', currentTriggerId: null })),
      })
    ).toEqual({ kind: 'hub', notice: 'inactive' });
  });

  it('R6 DRAFT → i06(그 세션)', () => {
    expect(route({ prepared: found(session('DRAFT')) })).toEqual({
      kind: 'draft',
      sessionId: 'sys-1',
    });
  });

  it.each(['COLLECTING', 'SOLVING'] as const)(
    'R7 %s → i05(그 세션)',
    (status) => {
      expect(route({ prepared: found(session(status)) })).toEqual({
        kind: 'solving',
        sessionId: 'sys-1',
      });
    }
  );

  it.each(['NO_SOLUTION', 'FAILED'] as const)(
    'R8 %s → i06 대안 없음·실패 얼굴(그 세션)',
    (status) => {
      expect(route({ prepared: found(session(status)) })).toEqual({
        kind: 'draft',
        sessionId: 'sys-1',
      });
    }
  );

  it("R9 계약 밖 세션 상태(새 서버의 새 값)는 '없음'으로 읽는다 — i06 은 모르는 상태를 그리지 못해 빈 화면이 된다(INV-4)", () => {
    const unknown = session(UNKNOWN_STATUS);

    expect(route({ prepared: found(unknown) })).toEqual({
      kind: 'request',
      triggerId: 'trg-1',
      scope: 'PARTIAL_SLOTS',
      seed: {
        reasons: ['WEATHER'],
        directives: ['AVOID_OUTDOOR'],
        excludedPoiIds: ['poi-out'],
      },
    });
    expect(
      route({
        trigger: found(detail({ state: 'EXPIRED', currentTriggerId: null })),
        prepared: found(unknown),
      })
    ).toEqual({ kind: 'hub', notice: 'inactive' });
  });
});

describe('🔴 entryRoute · i04 시드·날짜·트리거 (§3.3 · 행 4)', () => {
  it('S1 stale·CANCELED 세션이 있으면 그 세션 입력(사유·지시·제외)이 시드다', () => {
    for (const prepared of [
      session('DRAFT', { stale: true }),
      session('CANCELED'),
      session('NO_SOLUTION', { stale: true }),
    ]) {
      expect(route({ prepared: found(prepared) })).toEqual({
        kind: 'request',
        triggerId: 'trg-1',
        scope: 'PARTIAL_SLOTS',
        seed: {
          reasons: ['WEATHER'],
          directives: ['AVOID_OUTDOOR'],
          excludedPoiIds: ['poi-out'],
        },
      });
    }
  });

  it('S2 주의(CAUTION)는 세션이 있어도 빈 시드다(흐림에 날씨 사유를 넣으면 일정을 과하게 바꾼다)', () => {
    const caution = detail({
      severity: 'CAUTION',
      kind: 'WEATHER',
      variant: 'CLOUD',
    });
    expect(route({ trigger: found(caution) })).toMatchObject({
      kind: 'request',
      seed: { reasons: [], directives: [], excludedPoiIds: [] },
    });
    expect(
      route({ trigger: found(caution), prepared: found(session('CANCELED')) })
    ).toMatchObject({
      kind: 'request',
      seed: { reasons: [], directives: [], excludedPoiIds: [] },
    });
  });

  it.each([
    ['CLOSURE', ['TEMP_CLOSED']],
    ['DELAY', ['SLOW_MOVE']],
    ['MANUAL', []],
  ] as const)('S3 세션이 없으면 kind 사유 — %s → %j', (kind, reasons) => {
    expect(route({ trigger: found(detail({ kind })) })).toMatchObject({
      kind: 'request',
      seed: { reasons, directives: [], excludedPoiIds: [] },
    });
  });

  it('S4 원 트리거가 ACTIVE 가 아니고 current 가 있으면 current 로 i04 를 연다', () => {
    expect(
      route({
        trigger: found(detail({ state: 'EXPIRED', currentTriggerId: 'trg-2' })),
      })
    ).toMatchObject({ kind: 'request', triggerId: 'trg-2' });
  });

  it('S5 미래일 트리거는 targetDate = affectedDate 이고 범위는 싣지 않는다(i04 가 FULL_DAY 로 고정)', () => {
    expect(
      route({
        trigger: found(
          detail({ affectedDate: TOMORROW, scope: 'PARTIAL_SLOTS' })
        ),
      })
    ).toEqual({
      kind: 'request',
      triggerId: 'trg-1',
      targetDate: TOMORROW,
      seed: { reasons: ['WEATHER'], directives: [], excludedPoiIds: [] },
    });
  });

  it('S6 오늘 트리거의 범위가 NONE·null 이면 범위를 싣지 않는다(i04 기본값)', () => {
    for (const scope of ['NONE', null] as const) {
      const result = route({ trigger: found(detail({ scope })) });
      expect(result).toMatchObject({ kind: 'request' });
      expect(result).not.toHaveProperty('scope');
    }
  });
});

/**
 * 사용자 결정(2026-10-20) — 시드는 **요청에 실릴 지금 알림**의 심각도로 정한다. 사용자가 누른 알림이 해제 뒤 다시 섰으면
 * 요청에는 새 알림(`currentTriggerId`)이 실리고, 그 심각도는 상세가 아니라 떠 있는 목록에 있다.
 */
describe('🔴 entryRoute · 시드는 지금 알림의 심각도로 — 위험만 켜고 주의·모름은 빈 시드', () => {
  const REISSUED = detail({ state: 'EXPIRED', currentTriggerId: 'trg-2' });
  /** 옛 위험 선계산 — 해제 전 위험 알림으로 미리 짠 세션(대체돼 닫혔다). 뺄 장소를 들고 있다. */
  const OLD_RISK_SESSION = session('CANCELED', {
    reasons: ['WEATHER'],
    directives: ['AVOID_OUTDOOR'],
    excludedPoiIds: ['poi-out'],
  });

  it('V1 다시 선 알림이 목록에서 주의면 원 트리거가 위험이었어도 빈 시드다 — 옛 위험 선계산의 사유·뺄 장소를 싣지 않는다', () => {
    expect(
      route({
        trigger: found(REISSUED),
        prepared: found(OLD_RISK_SESSION),
        activeTriggers: [listed('trg-2', 'CAUTION')],
      })
    ).toEqual({
      kind: 'request',
      triggerId: 'trg-2',
      scope: 'PARTIAL_SLOTS',
      seed: EMPTY_SEED,
    });
  });

  it('V2 다시 선 알림이 목록에서 위험이면 준비 세션 입력이 시드다', () => {
    expect(
      route({
        trigger: found(REISSUED),
        prepared: found(OLD_RISK_SESSION),
        activeTriggers: [listed('trg-1', 'CAUTION'), listed('trg-2', 'RISK')],
      })
    ).toEqual({
      kind: 'request',
      triggerId: 'trg-2',
      scope: 'PARTIAL_SLOTS',
      seed: {
        reasons: ['WEATHER'],
        directives: ['AVOID_OUTDOOR'],
        excludedPoiIds: ['poi-out'],
      },
    });
  });

  it.each([
    ['목록 미도착(조회 중·실패)', undefined],
    ['목록에 그 알림이 없음', [listed('trg-1', 'RISK')]],
    ['빈 목록', []],
  ] as [string, Trigger[] | undefined][])(
    'V3 다시 선 알림의 심각도를 모르면(%s) 빈 시드다 — 트리거는 그대로 지금 알림',
    (_name, activeTriggers) => {
      expect(
        route({
          trigger: found(REISSUED),
          prepared: found(OLD_RISK_SESSION),
          activeTriggers,
        })
      ).toMatchObject({
        kind: 'request',
        triggerId: 'trg-2',
        seed: EMPTY_SEED,
      });
    }
  );

  it('V4 severity 가 없으면(옛 서버) 위험으로 읽는다 — 원 트리거(상세)든 다시 선 알림(목록)이든', () => {
    expect(
      route({ trigger: found(detail({ severity: undefined })) })
    ).toMatchObject({ seed: { reasons: ['WEATHER'] } });
    expect(
      route({
        trigger: found(REISSUED),
        activeTriggers: [listed('trg-2', undefined)],
      })
    ).toMatchObject({ triggerId: 'trg-2', seed: { reasons: ['WEATHER'] } });
  });

  it('V5 원 트리거가 지금 떠 있으면(ACTIVE) 상세의 심각도로 정한다 — 목록이 아직이어도, 목록 캐시가 다른 말을 해도', () => {
    // 목록 미도착 — 상세가 곧 지금 알림이라 기다릴 필요가 없다.
    expect(route({ activeTriggers: undefined })).toMatchObject({
      seed: { reasons: ['WEATHER'] },
    });
    // 제자리 갱신(위험 → 주의)을 못 따라온 목록 캐시 — 방금 받은 상세가 이긴다.
    expect(
      route({
        trigger: found(detail({ severity: 'CAUTION' })),
        activeTriggers: [listed('trg-1', 'RISK')],
      })
    ).toMatchObject({ seed: EMPTY_SEED });
    expect(
      route({
        trigger: found(detail({ severity: 'RISK' })),
        activeTriggers: [listed('trg-1', 'CAUTION')],
      })
    ).toMatchObject({ seed: { reasons: ['WEATHER'] } });
  });

  it('V6 계약 밖 심각도 값은 위험으로 치지 않는다(모르면 켜지 않는다)', () => {
    expect(
      route({
        trigger: found(
          detail({ severity: 'SEVERE' as unknown as Trigger['severity'] })
        ),
      })
    ).toMatchObject({ seed: EMPTY_SEED });
  });
});

/**
 * PBT-SA-21 — 판정표 전수(준비 상태 × 트리거 상태 × 시간 초과)에서 결과가 표의 행과 1:1, 대안으로 가는 결정은
 * 두 조회가 다 준비됐을 때만. 오라클(`expectedRow`)은 구현의 if 사슬을 옮기지 않는다 — BR-SA-23 표처럼 행마다
 * **온전한 조건**(DRAFT ∧ ¬stale 처럼)을 따로 적고 "정확히 한 행만 맞는다"를 먼저 단언한다. 구현이 행 순서를 바꾸면
 * (예: stale 보다 DRAFT 를 먼저 보면) 순서와 무관한 이 조건과 어긋나 잡힌다. 계약 밖 상태도 섞는다('없음'으로 읽는다).
 * 떠 있는 목록(미도착·없음·주의·위험·severity 없음)도 섞는다 — 목록은 갈 곳을 바꾸지 않고(행은 두 조회와 시간만으로
 * 정해진다), 행 4 의 시드만 정한다: 지금 알림이 위험으로 확인될 때만 차고, 아니면 빈 시드다(`expectedSeed`).
 */
const STATES: TriggerDetailState[] = [
  'ACTIVE',
  'SUPPRESSED',
  'CONSUMED',
  'EXPIRED',
];
const STATUSES: ReplanSessionStatus[] = [
  'COLLECTING',
  'SOLVING',
  'DRAFT',
  'APPLIED',
  'CANCELED',
  'FAILED',
  'NO_SOLUTION',
  UNKNOWN_STATUS,
];

const detailArb = fc
  .record({
    state: fc.constantFrom(...STATES),
    currentTriggerId: fc.constantFrom<string | null | undefined>(
      null,
      undefined,
      'trg-1',
      'trg-2'
    ),
    severity: fc.constantFrom<'RISK' | 'CAUTION' | undefined>(
      'RISK',
      'CAUTION',
      undefined
    ),
    kind: fc.constantFrom('WEATHER', 'CLOSURE', 'DELAY', 'MANUAL'),
    affectedDate: fc.constantFrom(TODAY, TOMORROW),
  })
  .map((over) => detail(over as Partial<TriggerDetail>));

const sessionArb = fc
  .record({
    status: fc.constantFrom(...STATUSES),
    stale: fc.constantFrom<boolean | undefined>(true, false, undefined),
  })
  .map(({ status, stale }) => session(status, { stale }));

/** 떠 있는 목록 — 미도착(undefined)·빈 목록·원 알림/다시 선 알림/남의 알림 × 위험·주의·severity 없음. */
const activeArb: fc.Arbitrary<Trigger[] | undefined> = fc.option(
  fc
    .uniqueArray(
      fc.record({
        id: fc.constantFrom('trg-1', 'trg-2', 'trg-9'),
        severity: fc.constantFrom<Trigger['severity']>(
          'RISK',
          'CAUTION',
          undefined
        ),
      }),
      { maxLength: 3, selector: (item) => item.id }
    )
    .map((items) => items.map(({ id, severity }) => listed(id, severity))),
  { nil: undefined }
);

/** kind 사유 시드(세션이 없을 때) — `TRIGGER_REASON_KEY` 를 옮기지 않고 리터럴로 적는다. */
const KIND_REASONS: Record<string, string[]> = {
  WEATHER: ['WEATHER'],
  CLOSURE: ['TEMP_CLOSED'],
  DELAY: ['SLOW_MOVE'],
  MANUAL: [],
};

/**
 * 행 4 의 시드. 지금 알림 = 원 트리거가 ACTIVE 면 그것(상세), 아니면 current(목록에서 찾는다). 그 심각도가 위험(없음 =
 * 위험)으로 확인될 때만 준비 세션 입력(있으면) 또는 kind 사유, 그 밖(주의·목록 미도착·목록에 없음)은 빈 시드다.
 */
function expectedSeed(
  detailValue: TriggerDetail,
  sessionValue: ReplanSession | null,
  activeTriggers: Trigger[] | undefined
) {
  const known =
    detailValue.state === 'ACTIVE'
      ? { severity: detailValue.severity }
      : activeTriggers?.find(
          (item) => item.triggerId === detailValue.currentTriggerId
        );
  const risk =
    known !== undefined &&
    (known.severity === undefined || known.severity === 'RISK');
  if (!risk) return EMPTY_SEED;
  if (sessionValue !== null) {
    return {
      reasons: sessionValue.reasons ?? [],
      directives: sessionValue.directives ?? [],
      excludedPoiIds: sessionValue.excludedPoiIds ?? [],
    };
  }
  return { ...EMPTY_SEED, reasons: KIND_REASONS[detailValue.kind] };
}

function lookupArb<T>(value: fc.Arbitrary<T>): fc.Arbitrary<EntryLookup<T>> {
  return fc.oneof(
    fc.constant<EntryLookup<T>>({ kind: 'pending' }),
    fc.constant<EntryLookup<T>>({ kind: 'notFound' }),
    fc.constant<EntryLookup<T>>({ kind: 'failed' }),
    value.map((v): EntryLookup<T> => ({ kind: 'found', value: v }))
  );
}

/**
 * 표의 몇 번째 행인가(0 = 기다림). 행마다 온전한 조건(서로 배타)을 적고, 맞는 행이 정확히 하나인지부터 본다.
 * '쓸 수 있는 준비 대안' = 아는 진행·결과 상태(DRAFT·COLLECTING·SOLVING·NO_SOLUTION·FAILED) ∧ ¬stale. APPLIED 는 stale
 * 이어도 APPLIED 다. 그 밖(대안 없음·CANCELED·stale·계약 밖 상태)은 '없음'이다.
 */
function expectedRow(input: EntryRouteInput): number {
  const { trigger, prepared, timedOut } = input;
  const bothFound =
    trigger.kind === 'found' &&
    (prepared.kind === 'found' || prepared.kind === 'notFound');
  const s = prepared.kind === 'found' ? prepared.value : null;
  const status = s?.status;
  const fresh = s !== null && s.stale !== true;
  const applied = status === 'APPLIED';
  const usable =
    fresh &&
    (status === 'DRAFT' ||
      status === 'COLLECTING' ||
      status === 'SOLVING' ||
      status === 'NO_SOLUTION' ||
      status === 'FAILED');
  const none = !applied && !usable;
  const triggerLive =
    trigger.kind === 'found' &&
    (trigger.value.state === 'ACTIVE' || !!trigger.value.currentTriggerId);
  const failedOrLate =
    trigger.kind !== 'notFound' &&
    (trigger.kind === 'failed' || prepared.kind === 'failed' || timedOut);
  const decided = bothFound && !timedOut;

  const rows: [number, boolean][] = [
    [1, trigger.kind === 'notFound'],
    [2, failedOrLate],
    [
      0,
      !failedOrLate &&
        trigger.kind !== 'notFound' &&
        (trigger.kind === 'pending' || prepared.kind === 'pending'),
    ],
    [3, decided && applied],
    [4, decided && none && triggerLive],
    [5, decided && none && !triggerLive],
    [6, decided && usable && status === 'DRAFT'],
    [7, decided && usable && (status === 'COLLECTING' || status === 'SOLVING')],
    [8, decided && usable && (status === 'NO_SOLUTION' || status === 'FAILED')],
  ];
  const matched = rows.filter(([, holds]) => holds).map(([row]) => row);
  expect(matched).toHaveLength(1);
  return matched[0];
}

const ROW_KIND: Record<number, EntryRoute['kind']> = {
  0: 'wait',
  1: 'notFound',
  2: 'fallback',
  3: 'hub',
  4: 'request',
  5: 'hub',
  6: 'draft',
  7: 'solving',
  8: 'draft',
};

describe('PBT-SA-21 · 진입 판정 전수', () => {
  it('결과가 표의 행과 1:1 이고, 대안·허브로 가는 결정은 두 조회가 다 준비됐을 때만이다 — 시드는 지금 알림이 위험일 때만 찬다', () => {
    fc.assert(
      fc.property(
        lookupArb(detailArb),
        lookupArb(sessionArb),
        fc.boolean(),
        activeArb,
        (trigger, prepared, timedOut, activeTriggers) => {
          const input: EntryRouteInput = {
            trigger,
            prepared,
            activeTriggers,
            timedOut,
            today: TODAY,
          };
          const row = expectedRow(input);
          const result = entryRoute(input);

          expect(result.kind).toBe(ROW_KIND[row]);
          if (row === 3)
            expect(result).toEqual({ kind: 'hub', notice: 'applied' });
          if (row === 5)
            expect(result).toEqual({ kind: 'hub', notice: 'inactive' });
          if (
            result.kind === 'draft' ||
            result.kind === 'solving' ||
            result.kind === 'hub' ||
            result.kind === 'request'
          ) {
            expect(trigger.kind).toBe('found');
            expect(['found', 'notFound']).toContain(prepared.kind);
            expect(timedOut).toBe(false);
          }
          if (result.kind === 'draft' || result.kind === 'solving') {
            expect(prepared.kind === 'found' && prepared.value.sessionId).toBe(
              result.sessionId
            );
          }
          if (result.kind === 'request' && trigger.kind === 'found') {
            expect(result.seed).toEqual(
              expectedSeed(
                trigger.value,
                prepared.kind === 'found' ? prepared.value : null,
                activeTriggers
              )
            );
          }
        }
      ),
      {
        // 표의 행마다 한 번은 반드시 지나가게 박는다(README §PBT — 적중을 확률에 맡기지 않는다).
        examples: [
          [{ kind: 'notFound' }, { kind: 'pending' }, true, undefined],
          [{ kind: 'failed' }, { kind: 'pending' }, false, undefined],
          [found(detail()), { kind: 'pending' }, true, undefined],
          [
            found(detail()),
            found(session('APPLIED', { stale: true })),
            false,
            undefined,
          ],
          [
            found(detail({ state: 'EXPIRED', currentTriggerId: 'trg-2' })),
            found(session('CANCELED')),
            false,
            [listed('trg-2', 'RISK')],
          ],
          [
            found(detail({ state: 'CONSUMED', currentTriggerId: null })),
            NONE,
            false,
            undefined,
          ],
          [found(detail()), found(session('DRAFT')), false, undefined],
          [found(detail()), found(session('SOLVING')), false, undefined],
          [found(detail()), found(session('FAILED')), false, undefined],
          [
            found(detail()),
            found(session('NO_SOLUTION', { stale: true })),
            false,
            undefined,
          ],
          // stale × 갈 수 있는 상태 — 행 순서(stale 을 먼저 '없음'으로)가 어긋나면 여기서 갈린다.
          [
            found(detail()),
            found(session('DRAFT', { stale: true })),
            false,
            undefined,
          ],
          [
            found(detail()),
            found(session('SOLVING', { stale: true })),
            false,
            undefined,
          ],
          [found(detail()), found(session(UNKNOWN_STATUS)), false, undefined],
          [found(detail()), { kind: 'pending' }, false, undefined],
          // 행 4 시드 갈래 — 다시 선 알림이 주의(옛 위험 선계산은 버린다)·severity 없음(위험)·목록에 없음(모름).
          [
            found(detail({ state: 'EXPIRED', currentTriggerId: 'trg-2' })),
            found(session('CANCELED')),
            false,
            [listed('trg-2', 'CAUTION')],
          ],
          [
            found(detail({ state: 'EXPIRED', currentTriggerId: 'trg-2' })),
            NONE,
            false,
            [listed('trg-2', undefined)],
          ],
          [
            found(detail({ state: 'SUPPRESSED', currentTriggerId: 'trg-2' })),
            found(session('CANCELED')),
            false,
            [listed('trg-1', 'RISK')],
          ],
          // 원 트리거가 지금 알림이면 상세가 정한다 — 목록이 반대로 말해도.
          [
            found(detail({ severity: 'CAUTION' })),
            NONE,
            false,
            [listed('trg-1', 'RISK')],
          ],
        ],
      }
    );
  });
});
