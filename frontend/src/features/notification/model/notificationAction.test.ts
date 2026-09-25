import fc from 'fast-check';

import {
  NotificationActionType,
  type Notification,
} from '@/shared/api/generated/schemas';

import { notificationAction } from './notificationAction';

/**
 * TRIP-946 · l01 — `notificationAction(actionType, actionPayload) → route | null` 라우팅 사영.
 * 서버가 말한 액션 종류(actionType)로만 목적지를 정한다. 알림 종류(kind)는 경로를 바꾸지 않는다.
 *
 * 무엇을 보장하나:
 *  - 4갈래(TRIP_ITINERARY·TRIP_SUMMARY·PLANB_REPLAN·REFLECTION_DAILY)는 필수 필드가 다 있으면 정해진 경로로 간다.
 *    Plan-B 는 일정 화면이 아니라 재계획 진입(`/planb?triggerId=`)이다(BR-U6-08). 회고 날짜 키는 `dayDate` 다(BR-U6-12).
 *  - STAY_DETAIL·액션 없음(null)·모르는 값·필수 필드 결측은 전부 null — 반쪽 경로로 보내지 않는다(INV-4).
 *  - 경로 조각은 `encodeURIComponent` 로 감싼다 — 값에 `/`·`?` 가 섞여도 경로 모양이 변하지 않는다.
 *  - PBT(CI 차단 게이트): 임의 입력에서 결과는 null 이거나 4경로 형태 중 하나, 그리고 필수 필드가 다 있을 때만 non-null.
 *
 * 계약 밖 와이어 값(서버 실물은 `Map<String,String>`)은 `wire()` 로 캐스트해 넣는다 — 생성 타입이 막는 모양을
 * 일부러 넣어 보는 것이다.
 */

type ActionType = Notification['actionType'];
type Payload = Notification['actionPayload'];

/** 계약 밖 payload(옛 키·여분 키·임의 사전)를 생성 타입 자리에 넣는다. */
const wire = (payload: Record<string, string> | null | undefined): Payload =>
  payload as unknown as Payload;

/** 5값 밖 actionType 문자열을 넣는다. */
const unknownType = (value: string): ActionType =>
  value as string as ActionType;

const TRIP_UUID = '00000000-0000-4000-8000-0000000000aa';

describe('생성 enum · NotificationActionType 은 백엔드 어휘 5값이다', () => {
  it('Object.values 가 TRIP_ITINERARY·PLANB_REPLAN·REFLECTION_DAILY·TRIP_SUMMARY·STAY_DETAIL 와 같다', () => {
    expect(Object.values(NotificationActionType).sort()).toEqual(
      [
        'TRIP_ITINERARY',
        'PLANB_REPLAN',
        'REFLECTION_DAILY',
        'TRIP_SUMMARY',
        'STAY_DETAIL',
      ].sort()
    );
  });
});

describe('AC-1 · 정상 4갈래 — 필수 필드가 있으면 정해진 경로', () => {
  it.each<[string, ActionType, Payload, string]>([
    [
      'TRIP_ITINERARY → 일정 화면',
      'TRIP_ITINERARY',
      { tripId: TRIP_UUID },
      `/trips/${TRIP_UUID}/itinerary`,
    ],
    [
      'TRIP_SUMMARY → 여행 요약',
      'TRIP_SUMMARY',
      { tripId: 't1' },
      '/trips/t1/records/summary',
    ],
    [
      'PLANB_REPLAN → 재계획 진입(triggerId 쿼리)',
      'PLANB_REPLAN',
      { tripId: 't1', triggerId: 'tr-9' },
      '/trips/t1/planb?triggerId=tr-9',
    ],
    [
      'REFLECTION_DAILY → 그날 회고',
      'REFLECTION_DAILY',
      { tripId: 't1', dayDate: '2026-08-20' },
      '/trips/t1/records/reflection/2026-08-20',
    ],
  ])('%s', (_label, actionType, payload, expected) => {
    expect(notificationAction(actionType, payload)).toBe(expected);
  });
});

describe('AC-2 · Plan-B 는 일정 화면이 아니라 재계획 진입', () => {
  it('replanSessionId 가 있어도 무시하고 /planb?triggerId= 로 간다', () => {
    const route = notificationAction('PLANB_REPLAN', {
      tripId: 't1',
      triggerId: 'tr-9',
      replanSessionId: 'rs-1',
    });

    expect(route).toBe('/trips/t1/planb?triggerId=tr-9');
    expect(route).not.toContain('/itinerary');
    expect(route).not.toContain('rs-1');
  });
});

describe('AC-3 · 회고 날짜 키는 dayDate — 옛 키 date 는 읽지 않는다', () => {
  it('{tripId, dayDate} → /records/reflection/{dayDate}', () => {
    expect(
      notificationAction('REFLECTION_DAILY', {
        tripId: 't1',
        dayDate: '2026-08-20',
      })
    ).toBe('/trips/t1/records/reflection/2026-08-20');
  });

  it('옛 키 {tripId, date} 만 있으면 null', () => {
    expect(
      notificationAction(
        'REFLECTION_DAILY',
        wire({ tripId: 't1', date: '2026-08-20' })
      )
    ).toBeNull();
  });

  it('dayDate 와 date 가 둘 다 있고 값이 다르면 dayDate 를 쓴다', () => {
    expect(
      notificationAction(
        'REFLECTION_DAILY',
        wire({ tripId: 't1', dayDate: '2026-08-20', date: '1999-01-01' })
      )
    ).toBe('/trips/t1/records/reflection/2026-08-20');
  });
});

describe('AC-4 · STAY_DETAIL 은 액션 없음(결정2)', () => {
  it('{savedStayId} → null', () => {
    expect(
      notificationAction('STAY_DETAIL', { savedStayId: TRIP_UUID })
    ).toBeNull();
  });

  it('여분 tripId 가 섞여 있어도 여행 경로로 새지 않는다 → null', () => {
    expect(
      notificationAction(
        'STAY_DETAIL',
        wire({ savedStayId: TRIP_UUID, tripId: 't1' })
      )
    ).toBeNull();
  });
});

describe('AC-5 · 액션 없음 — actionType 이 null/undefined 면 payload 가 무엇이든 null', () => {
  it.each<[string, Payload]>([
    ['{tripId}', { tripId: 't1' }],
    ['{tripId, triggerId}', { tripId: 't1', triggerId: 'tr-9' }],
    ['{tripId, dayDate}', { tripId: 't1', dayDate: '2026-08-20' }],
  ])('actionType null · undefined + %s → null', (_label, payload) => {
    expect(notificationAction(null, payload)).toBeNull();
    expect(notificationAction(undefined, payload)).toBeNull();
  });
});

describe('AC-6 · 결측 — 갈래 필수 필드가 없거나 빈 문자열이면 null', () => {
  it.each<[string, ActionType, Payload]>([
    ['TRIP_ITINERARY · {}', 'TRIP_ITINERARY', wire({})],
    ['TRIP_ITINERARY · tripId ""', 'TRIP_ITINERARY', { tripId: '' }],
    ['TRIP_ITINERARY · payload null', 'TRIP_ITINERARY', null],
    ['TRIP_SUMMARY · {}', 'TRIP_SUMMARY', wire({})],
    [
      'PLANB_REPLAN · tripId "" (서버가 실제로 보낼 수 있음)',
      'PLANB_REPLAN',
      { tripId: '', triggerId: 'tr-9' },
    ],
    ['PLANB_REPLAN · triggerId 없음', 'PLANB_REPLAN', wire({ tripId: 't1' })],
    [
      'PLANB_REPLAN · triggerId ""',
      'PLANB_REPLAN',
      { tripId: 't1', triggerId: '' },
    ],
    [
      'REFLECTION_DAILY · dayDate 없음',
      'REFLECTION_DAILY',
      wire({ tripId: 't1' }),
    ],
    [
      'REFLECTION_DAILY · tripId 없음',
      'REFLECTION_DAILY',
      wire({ dayDate: '2026-08-20' }),
    ],
    [
      'REFLECTION_DAILY · dayDate ""',
      'REFLECTION_DAILY',
      { tripId: 't1', dayDate: '' },
    ],
  ])('%s → null', (_label, actionType, payload) => {
    expect(notificationAction(actionType, payload)).toBeNull();
  });
});

describe('AC-7 · 5값 밖 actionType — throw 하지 않고 null', () => {
  it.each<[string, Payload]>([
    ['TRIP_REFLECTION', wire({ tripId: 't1', date: '2026-08-20' })],
    ['planb_replan', { tripId: 't1', triggerId: 'tr-9' }],
    ['', { tripId: 't1' }],
  ])('"%s" → null', (value, payload) => {
    expect(() => notificationAction(unknownType(value), payload)).not.toThrow();
    expect(notificationAction(unknownType(value), payload)).toBeNull();
  });
});

describe('AC-8 · 여분 키가 있어도 정상 갈래로 판정하고, 경로는 필수 필드로만 만든다', () => {
  it('TRIP_ITINERARY + {tripId, foo, kind} → /trips/t1/itinerary', () => {
    expect(
      notificationAction(
        'TRIP_ITINERARY',
        wire({ tripId: 't1', foo: 'bar', kind: 'PLAN_B' })
      )
    ).toBe('/trips/t1/itinerary');
  });
});

describe('AC-9(Q4) · 경로 조각은 encodeURIComponent — 값 안의 / ? # & 가 경로 모양을 바꾸지 않는다', () => {
  it('tripId "a/b?c#d" → /trips/a%2Fb%3Fc%23d/itinerary', () => {
    expect(notificationAction('TRIP_ITINERARY', { tripId: 'a/b?c#d' })).toBe(
      '/trips/a%2Fb%3Fc%23d/itinerary'
    );
  });

  it('triggerId "x&y=z" → ?triggerId=x%26y%3Dz', () => {
    expect(
      notificationAction('PLANB_REPLAN', { tripId: 't1', triggerId: 'x&y=z' })
    ).toBe('/trips/t1/planb?triggerId=x%26y%3Dz');
  });

  it('dayDate "a/b" → /records/reflection/a%2Fb', () => {
    expect(
      notificationAction('REFLECTION_DAILY', { tripId: 't1', dayDate: 'a/b' })
    ).toBe('/trips/t1/records/reflection/a%2Fb');
  });
});

// ── PBT ──────────────────────────────────────────────────────────────────────

/** encodeURIComponent 가 날것으로 남기는 글자 + `%`. 경로 조각 하나(비어 있지 않음). */
const SEG = "[A-Za-z0-9\\-_.!~*'()%]+";

const ROUTABLE = [
  'TRIP_ITINERARY',
  'TRIP_SUMMARY',
  'PLANB_REPLAN',
  'REFLECTION_DAILY',
] as const;
type Routable = (typeof ROUTABLE)[number];

/** 갈래별 경로 형태와, 캡처 그룹 순서대로의 필수 필드. */
const FORMS: Record<Routable, { pattern: RegExp; fields: string[] }> = {
  TRIP_ITINERARY: {
    pattern: new RegExp(`^/trips/(${SEG})/itinerary$`),
    fields: ['tripId'],
  },
  TRIP_SUMMARY: {
    pattern: new RegExp(`^/trips/(${SEG})/records/summary$`),
    fields: ['tripId'],
  },
  PLANB_REPLAN: {
    pattern: new RegExp(`^/trips/(${SEG})/planb\\?triggerId=(${SEG})$`),
    fields: ['tripId', 'triggerId'],
  },
  REFLECTION_DAILY: {
    pattern: new RegExp(`^/trips/(${SEG})/records/reflection/(${SEG})$`),
    fields: ['tripId', 'dayDate'],
  },
};

const isRoutable = (value: unknown): value is Routable =>
  (ROUTABLE as readonly unknown[]).includes(value);

const text = fc.oneof(
  fc.constant(''),
  fc.string(),
  fc.string({ unit: 'grapheme' })
);

const actionTypeArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(...ROUTABLE, 'STAY_DETAIL'),
  fc.constant(null),
  fc.constant(undefined),
  fc.string()
);

/** 알려진 키를 선택적으로 섞는다 — 임의 사전만으로는 tripId 가 거의 안 나와 정상 갈래를 못 밟는다. */
const payloadArb: fc.Arbitrary<Record<string, string> | null | undefined> =
  fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc
      .tuple(
        fc.record(
          {
            tripId: text,
            triggerId: text,
            dayDate: text,
            savedStayId: text,
            date: text,
            replanSessionId: text,
          },
          { requiredKeys: [] }
        ),
        fc.dictionary(fc.string(), fc.string(), { maxKeys: 3 })
      )
      .map(([known, extra]) => ({ ...extra, ...known }))
  );

const field = (
  payload: Record<string, string> | null | undefined,
  key: string
): unknown => (payload == null ? undefined : payload[key]);

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

describe('AC-9 · PBT(CI 차단 게이트) — 임의 (actionType, payload)', () => {
  it('결과는 null 이거나 4경로 형태 중 하나다', () => {
    fc.assert(
      fc.property(actionTypeArb, payloadArb, (actionType, payload) => {
        const route = notificationAction(
          actionType as ActionType,
          wire(payload)
        );

        if (route === null) return;
        expect(ROUTABLE.some((key) => FORMS[key].pattern.test(route))).toBe(
          true
        );
      }),
      { numRuns: 500 }
    );
  });

  it('필수 필드가 다 있을 때만 non-null 이고, 그 actionType 의 형태로 원래 값을 그대로 싣는다', () => {
    fc.assert(
      fc.property(actionTypeArb, payloadArb, (actionType, payload) => {
        const route = notificationAction(
          actionType as ActionType,
          wire(payload)
        );

        const shouldRoute =
          isRoutable(actionType) &&
          FORMS[actionType].fields.every((key) => filled(field(payload, key)));

        if (!shouldRoute) {
          expect(route).toBeNull();
          return;
        }
        expect(route).not.toBeNull();
        const form = FORMS[actionType as Routable];
        const match = form.pattern.exec(route as string);
        expect(match).not.toBeNull();
        form.fields.forEach((key, index) => {
          expect(
            decodeURIComponent((match as RegExpExecArray)[index + 1])
          ).toBe(field(payload, key));
        });
      }),
      { numRuns: 500 }
    );
  });
});
