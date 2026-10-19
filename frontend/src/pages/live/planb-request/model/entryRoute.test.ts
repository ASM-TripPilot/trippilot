/**
 * @jest-environment node
 */
import fc from 'fast-check';

import type {
  ReplanSession,
  ReplanSessionStatus,
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
/** 계약 밖 상태 — 앱보다 새 서버가 enum 을 늘린 경우(OTA 가 없어 옛 앱이 받는다). */
const UNKNOWN_STATUS = 'PAUSED' as ReplanSessionStatus;

function route(over: Partial<EntryRouteInput> = {}): EntryRoute {
  return entryRoute({
    trigger: found(detail()),
    prepared: NONE,
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
 * PBT-SA-21 — 판정표 전수(준비 상태 × 트리거 상태 × 시간 초과)에서 결과가 표의 행과 1:1, 대안으로 가는 결정은
 * 두 조회가 다 준비됐을 때만. 오라클(`expectedRow`)은 구현의 if 사슬을 옮기지 않는다 — BR-SA-23 표처럼 행마다
 * **온전한 조건**(DRAFT ∧ ¬stale 처럼)을 따로 적고 "정확히 한 행만 맞는다"를 먼저 단언한다. 구현이 행 순서를 바꾸면
 * (예: stale 보다 DRAFT 를 먼저 보면) 순서와 무관한 이 조건과 어긋나 잡힌다. 계약 밖 상태도 섞는다('없음'으로 읽는다).
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
  it('결과가 표의 행과 1:1 이고, 대안·허브로 가는 결정은 두 조회가 다 준비됐을 때만이다', () => {
    fc.assert(
      fc.property(
        lookupArb(detailArb),
        lookupArb(sessionArb),
        fc.boolean(),
        (trigger, prepared, timedOut) => {
          const input: EntryRouteInput = {
            trigger,
            prepared,
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
        }
      ),
      {
        // 표의 행마다 한 번은 반드시 지나가게 박는다(README §PBT — 적중을 확률에 맡기지 않는다).
        examples: [
          [{ kind: 'notFound' }, { kind: 'pending' }, true],
          [{ kind: 'failed' }, { kind: 'pending' }, false],
          [found(detail()), { kind: 'pending' }, true],
          [found(detail()), found(session('APPLIED', { stale: true })), false],
          [
            found(detail({ state: 'EXPIRED', currentTriggerId: 'trg-2' })),
            found(session('CANCELED')),
            false,
          ],
          [
            found(detail({ state: 'CONSUMED', currentTriggerId: null })),
            NONE,
            false,
          ],
          [found(detail()), found(session('DRAFT')), false],
          [found(detail()), found(session('SOLVING')), false],
          [found(detail()), found(session('FAILED')), false],
          [
            found(detail()),
            found(session('NO_SOLUTION', { stale: true })),
            false,
          ],
          // stale × 갈 수 있는 상태 — 행 순서(stale 을 먼저 '없음'으로)가 어긋나면 여기서 갈린다.
          [found(detail()), found(session('DRAFT', { stale: true })), false],
          [found(detail()), found(session('SOLVING', { stale: true })), false],
          [found(detail()), found(session(UNKNOWN_STATUS)), false],
          [found(detail()), { kind: 'pending' }, false],
        ],
      }
    );
  });
});
