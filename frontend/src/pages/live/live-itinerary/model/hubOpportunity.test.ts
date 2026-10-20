/**
 * @jest-environment node
 */
import fc from 'fast-check';

import type {
  Opportunity,
  OpportunityKind,
  Trigger,
  TriggerKind,
  TriggerSeverity,
} from '@/shared/api/index.schemas';

import {
  opportunityCopy,
  opportunityReplanHref,
  pickOpportunity,
} from './hubOpportunity';

/**
 * 상황 감지 FE-C · frontend-components §4.1·§4.2·§4.3 · BR-SA-22 — 허브 기회 카드의 판정(순수).
 *
 * 무엇을 보장하나:
 *  - 고르기(§4.1): ① 같은 날짜에 발화 중인 날씨 위험(WEATHER ∧ 위험 — severity 없음도 위험)이 있으면 행사 카드를 뺀다
 *    ② 남은 첫 항목 1장(서버 순위 그대로) ③ 그 항목을 이 날 기기에서 숨겼으면 아무것도 그리지 않는다 — 숨긴 자리를
 *    다음 항목으로 채우지 않는다(날짜당 1장). 트리거를 아직 모르면(조회 중·실패) 행사 카드를 그리지 않는다 — 비 오는
 *    날 야외 축제를 권하지 않는 쪽으로 닫는다. 행사 카드인데 이름·마지막 날이 없으면 문장을 못 만들어 그리지 않는다.
 *  - 문구(§4.2): kind 별 고정 템플릿 한 곳. 시각·`오늘 열려요`·`N분` 이 없고 거리는 서버 `distanceLabel` 그대로,
 *    마지막 날은 `end` 에서 `M월 d일`(앞자리 0 없음). 행사 카드만 각주가 붙는다.
 *  - [넣어서 다시 짜기](§4.3): i04 를 `prefill = {장소명} 꼭 넣어서 다시 짜 줘` · `includePoiId` 로, 오늘이 아니면
 *    `targetDate` 까지 싣고 연다.
 *
 * node-safe 잠금(`@jest-environment node`). 3동작: 준비(기회 목록·트리거·숨김) → 실행(순수 함수) → 단언(고른 항목·문자열).
 */

const DATE = '2026-10-31';
const OTHER_DATE = '2026-11-01';
const NOTE = '열리는 날·시간은 행사 안내를 확인해 주세요';

const event = (over: Partial<Opportunity> = {}): Opportunity => ({
  key: 'event:부산 불꽃축제',
  kind: 'EVENT_VENUE',
  eventName: '부산 불꽃축제',
  start: '2026-10-30',
  end: '2026-11-02',
  poiId: 'poi-venue',
  poiName: '광안리 해변',
  nearSlotKey: `${DATE}#p1`,
  distanceLabel: '약 400m',
  ...over,
});

const trending = (over: Partial<Opportunity> = {}): Opportunity => ({
  key: 'trending:해동용궁사',
  kind: 'TRENDING',
  eventName: null,
  start: null,
  end: null,
  poiId: 'poi-trend',
  poiName: '해동용궁사',
  nearSlotKey: `${DATE}#p2`,
  distanceLabel: '약 1.2km',
  ...over,
});

const trigger = (over: Partial<Trigger> = {}): Trigger =>
  ({
    triggerId: 'trg-1',
    kind: 'WEATHER',
    affectedDate: DATE,
    slotKey: null,
    reason: '오후에 비 소식이 있어요',
    scope: 'FULL_DAY',
    detectedAt: '2026-10-31T00:15:00Z',
    severity: 'RISK',
    ...over,
  }) as Trigger;

const NO_TRIGGERS: Trigger[] = [];

describe('pickOpportunity — 날짜당 1장 고르기 (§4.1)', () => {
  it('K1 막는 것이 없으면 서버 순위 첫 장 그대로', () => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: NO_TRIGGERS,
        hiddenKey: null,
      })
    ).toBe(items[0]);
  });

  it('K2 같은 날 날씨 위험이 발화 중이면 행사 카드를 빼고 남은 첫 장(요즘 인기)', () => {
    const items = [event(), event({ key: 'event:b', kind: 'EVENT_NEARBY' })];
    const withTrending = [...items, trending()];

    expect(
      pickOpportunity(withTrending, {
        date: DATE,
        triggers: [trigger()],
        hiddenKey: null,
      })
    ).toBe(withTrending[2]);
    // 행사만 있으면 그릴 것이 없다.
    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: [trigger()],
        hiddenKey: null,
      })
    ).toBeNull();
  });

  it('K3 severity 가 없는 날씨 트리거(옛 서버)는 위험으로 읽는다', () => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: [trigger({ severity: undefined })],
        hiddenKey: null,
      })
    ).toBe(items[1]);
  });

  it.each([
    ['주의(CAUTION) 날씨', trigger({ severity: 'CAUTION' })],
    ['다른 날의 날씨 위험', trigger({ affectedDate: OTHER_DATE })],
    ['같은 날 휴무 위험', trigger({ kind: 'CLOSURE' })],
    ['같은 날 이동 지연', trigger({ kind: 'DELAY' })],
  ])('K4 %s 는 행사 카드를 빼지 않는다', (_label, other) => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, { date: DATE, triggers: [other], hiddenKey: null })
    ).toBe(items[0]);
  });

  it('K5 트리거를 아직 모르면(조회 중·실패) 행사 카드는 그리지 않는다 — 요즘 인기는 그린다', () => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: undefined,
        hiddenKey: null,
      })
    ).toBe(items[1]);
    expect(
      pickOpportunity([event()], {
        date: DATE,
        triggers: undefined,
        hiddenKey: null,
      })
    ).toBeNull();
  });

  it('K6 고른 첫 장을 숨겼으면 아무것도 그리지 않는다 — 다음 항목으로 채우지 않는다', () => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: NO_TRIGGERS,
        hiddenKey: items[0].key,
      })
    ).toBeNull();
  });

  it('K7 숨긴 key 가 첫 장이 아니면 첫 장을 그대로 그린다', () => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: NO_TRIGGERS,
        hiddenKey: items[1].key,
      })
    ).toBe(items[0]);
  });

  it('K8 날씨 위험으로 행사가 빠진 뒤의 첫 장을 숨겼으면 아무것도 그리지 않는다', () => {
    const items = [event(), trending()];

    expect(
      pickOpportunity(items, {
        date: DATE,
        triggers: [trigger()],
        hiddenKey: items[1].key,
      })
    ).toBeNull();
  });

  it('K9 빈 목록이면 없음', () => {
    expect(
      pickOpportunity([], {
        date: DATE,
        triggers: NO_TRIGGERS,
        hiddenKey: null,
      })
    ).toBeNull();
  });

  it.each([
    ['이름 없음', { eventName: null }],
    ['이름 빈 문자열', { eventName: '  ' }],
    ['마지막 날 없음', { end: null }],
    ['마지막 날 형식 아님', { end: '11월 2일' }],
  ] as const)(
    'K10 행사 카드인데 %s → 문장을 못 만들어 건너뛰고 다음 항목',
    (_label, over) => {
      const items = [event(over), trending()];

      expect(
        pickOpportunity(items, {
          date: DATE,
          triggers: NO_TRIGGERS,
          hiddenKey: null,
        })
      ).toBe(items[1]);
    }
  );
});

describe('opportunityCopy — kind 별 고정 템플릿 (§4.2)', () => {
  it('C1 행사장(EVENT_VENUE) — 제목·본문·각주', () => {
    expect(opportunityCopy(event())).toEqual({
      title: '‘부산 불꽃축제’ 기간이에요',
      body: '광안리 해변에서 열려요 · 동선에서 약 400m · 11월 2일까지',
      note: NOTE,
    });
  });

  it.each([
    ['받침 있음', '감천문화마을', '감천문화마을이'],
    ['받침 없음', '흰여울카페', '흰여울카페가'],
    ['한글이 아니면 병기', 'Cafe B', 'Cafe B이(가)'],
  ])(
    'C2 행사장 가까이(EVENT_NEARBY) — %s: 주격 조사를 장소명 받침에 맞춘다',
    (_label, poiName, subject) => {
      expect(
        opportunityCopy(
          event({
            kind: 'EVENT_NEARBY',
            poiName,
            distanceLabel: '약 250m',
            end: '2026-10-27',
          })
        )
      ).toEqual({
        title: '‘부산 불꽃축제’ 기간이에요',
        body: `행사장 가까이에 ${subject} 있어요 · 동선에서 약 250m · 10월 27일까지`,
        note: NOTE,
      });
    }
  );

  it('C3 요즘 인기(TRENDING) — 고정 제목, 각주 없음', () => {
    expect(opportunityCopy(trending())).toEqual({
      title: '요즘 많이 찾는 곳이 동선 근처에 있어요',
      body: '해동용궁사 · 동선에서 약 1.2km',
      note: null,
    });
  });

  it('C4 마지막 날은 앞자리 0 없이 M월 d일', () => {
    expect(opportunityCopy(event({ end: '2027-01-05' })).body).toBe(
      '광안리 해변에서 열려요 · 동선에서 약 400m · 1월 5일까지'
    );
  });
});

describe('opportunityReplanHref — [넣어서 다시 짜기] → i04 (§4.3)', () => {
  it('R1 오늘이면 날짜를 싣지 않는다(생략 = 오늘)', () => {
    expect(opportunityReplanHref('trip-1', event(), DATE, DATE)).toEqual({
      pathname: '/trips/[tripId]/planb',
      params: {
        tripId: 'trip-1',
        prefill: '광안리 해변 꼭 넣어서 다시 짜 줘',
        includePoiId: 'poi-venue',
      },
    });
  });

  it('R2 오늘이 아니면 그 날짜를 targetDate 로 싣는다', () => {
    expect(
      opportunityReplanHref('trip-1', trending(), OTHER_DATE, DATE)
    ).toEqual({
      pathname: '/trips/[tripId]/planb',
      params: {
        tripId: 'trip-1',
        prefill: '해동용궁사 꼭 넣어서 다시 짜 줘',
        includePoiId: 'poi-trend',
        targetDate: OTHER_DATE,
      },
    });
  });
});

// ── 성질 ─────────────────────────────────────────────────────────────────────────

const KINDS: OpportunityKind[] = ['EVENT_VENUE', 'EVENT_NEARBY', 'TRENDING'];
const TRIGGER_KINDS: TriggerKind[] = ['WEATHER', 'CLOSURE', 'DELAY', 'MANUAL'];
const SEVERITIES: (TriggerSeverity | undefined)[] = [
  'RISK',
  'CAUTION',
  undefined,
];

/** 명세에서 바로 옮긴 "행사를 막는 트리거" — 같은 날 · 날씨 · 주의가 아님(없음 = 위험). */
const blocksEvents = (t: Trigger): boolean =>
  t.kind === 'WEATHER' && t.severity !== 'CAUTION' && t.affectedDate === DATE;

/** 명세에서 바로 옮긴 "그릴 수 있는 항목" — 요즘 인기는 늘, 행사는 막히지 않았고 이름·마지막 날이 있을 때만. */
const drawable = (item: Opportunity, eventsBlocked: boolean): boolean =>
  item.kind === 'TRENDING' ||
  (!eventsBlocked &&
    (item.eventName ?? '').trim() !== '' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.end ?? ''));

const itemArb: fc.Arbitrary<Opportunity> = fc
  .record({
    key: fc.string({ minLength: 1, maxLength: 6 }),
    kind: fc.constantFrom(...KINDS),
    eventName: fc.constantFrom<string | null | undefined>(
      '부산 불꽃축제',
      '',
      null,
      undefined
    ),
    end: fc.constantFrom<string | null | undefined>(
      '2026-11-02',
      null,
      undefined,
      '11월 2일'
    ),
  })
  .map(({ key, kind, eventName, end }) =>
    event({ key, kind, eventName, end, poiId: `poi-${key}` })
  );
const itemsArb = fc.uniqueArray(itemArb, {
  selector: (item) => item.key,
  maxLength: 4,
});
const triggersArb: fc.Arbitrary<Trigger[] | undefined> = fc.option(
  fc.array(
    fc
      .record({
        kind: fc.constantFrom(...TRIGGER_KINDS),
        severity: fc.constantFrom(...SEVERITIES),
        affectedDate: fc.constantFrom(DATE, OTHER_DATE),
      })
      .map((over) => trigger(over)),
    { maxLength: 3 }
  ),
  { nil: undefined }
);
/** 숨김 — 없음 · 목록의 n 번째 key · 목록에 없는 key. */
const hiddenArb = fc.oneof(
  fc.constant<null>(null),
  fc.nat({ max: 3 }),
  fc.constant('event:목록에 없는 행사')
);
const resolveHidden = (
  items: Opportunity[],
  hidden: null | number | string
): string | null =>
  typeof hidden === 'number' ? (items[hidden]?.key ?? null) : hidden;

describe('pickOpportunity 성질 (§4.1)', () => {
  it('P1 결과는 없음이거나 목록의 첫 "그릴 수 있는" 항목이고, 숨긴 첫 장은 다음으로 채우지 않는다', () => {
    fc.assert(
      fc.property(itemsArb, triggersArb, hiddenArb, (items, triggers, h) => {
        const hiddenKey = resolveHidden(items, h);
        const result = pickOpportunity(items, {
          date: DATE,
          triggers,
          hiddenKey,
        });
        const eventsBlocked =
          triggers === undefined || triggers.some(blocksEvents);
        const first = items.find((item) => drawable(item, eventsBlocked));

        if (first === undefined || first.key === hiddenKey) {
          expect(result).toBeNull();
        } else {
          expect(result).toBe(first);
        }
      }),
      {
        examples: [
          // 같은 날 날씨 위험 + 행사 첫 장 → 요즘 인기.
          [[event(), trending()], [trigger()], null],
          // 첫 장 숨김 → 없음(다음 장으로 안 채움).
          [[event(), trending()], [], 0],
          // 트리거 모름 + 행사만 → 없음.
          [[event()], undefined, null],
          // 주의 날씨 + 행사 → 행사 그대로.
          [[event(), trending()], [trigger({ severity: 'CAUTION' })], null],
        ],
      }
    );
  });

  it('P2 같은 날 날씨 위험이 있거나 트리거를 모르면 결과는 없음 또는 요즘 인기', () => {
    fc.assert(
      fc.property(itemsArb, triggersArb, hiddenArb, (items, triggers, h) => {
        fc.pre(triggers === undefined || triggers.some(blocksEvents));
        const result = pickOpportunity(items, {
          date: DATE,
          triggers,
          hiddenKey: resolveHidden(items, h),
        });

        expect(result === null || result.kind === 'TRENDING').toBe(true);
      }),
      { examples: [[[event(), trending()], [trigger()], null]] }
    );
  });

  it('P3 행사를 막지 않는 트리거는 결과를 바꾸지 않는다(트리거 없음과 같다)', () => {
    fc.assert(
      fc.property(itemsArb, triggersArb, hiddenArb, (items, triggers, h) => {
        fc.pre(triggers !== undefined && !triggers.some(blocksEvents));
        const hiddenKey = resolveHidden(items, h);

        expect(
          pickOpportunity(items, { date: DATE, triggers, hiddenKey })
        ).toBe(
          pickOpportunity(items, {
            date: DATE,
            triggers: NO_TRIGGERS,
            hiddenKey,
          })
        );
      }),
      {
        examples: [
          [
            [event(), trending()],
            [
              trigger({ severity: 'CAUTION' }),
              trigger({ affectedDate: OTHER_DATE }),
              trigger({ kind: 'CLOSURE' }),
            ],
            null,
          ],
        ],
      }
    );
  });
});

/** 시각·소요시간·'오늘 열려요' — 템플릿이 만들면 안 되는 말(INV-2·3). */
const FORBIDDEN = /\d+\s*(분|시간)|소요|\d{1,2}:\d{2}|\d+\s*시|오늘 열려요/;

describe('opportunityCopy 성질 (§4.2 · INV-2·3)', () => {
  it('P4 어떤 kind·이름·거리·마지막 날에서도 템플릿은 시각·소요시간·"오늘 열려요"를 만들지 않는다(서버 재료 자리는 비우고 검사)', () => {
    const nameArb = fc.oneof(
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.constantFrom('365분식', '4시30분왕족발', '오늘 열려요 장터')
    );
    fc.assert(
      fc.property(
        fc.constantFrom(...KINDS),
        nameArb,
        nameArb,
        fc.constantFrom('약 400m', '약 1.2km', '10분 거리'),
        fc.date({
          min: new Date('2020-01-01T00:00:00Z'),
          max: new Date('2040-12-31T00:00:00Z'),
          noInvalidDate: true,
        }),
        (kind, poiName, eventName, distanceLabel, endDate) => {
          const end = endDate.toISOString().slice(0, 10);
          const copy = opportunityCopy(
            event({ kind, poiName, eventName, distanceLabel, end })
          );
          // 짝 앵커 — 빈 문자열 공허 통과 차단.
          expect(copy.title.length).toBeGreaterThan(0);
          expect(copy.body.length).toBeGreaterThan(0);
          // 그 줄에 들어간 재료만, 긴 것부터 지운다 — 짧은 재료(공백 한 칸 등)를 먼저 지우면 긴 재료가 더는 안 맞아
          // 서버 문자열('10분 거리')이 템플릿 위반으로 남는다(실측 반례 — 아래 examples 첫 줄).
          const strip = (text: string, parts: string[]) =>
            [...parts]
              .sort((a, b) => b.length - a.length)
              .reduce((rest, part) => rest.split(part).join(''), text);
          // 마지막 날 'M월 d일까지' 의 숫자는 날짜라 시각 패턴(N시 등)과 겹치지 않는다 — 그대로 둔 채 검사한다.
          expect(
            strip(copy.title, kind === 'TRENDING' ? [] : [eventName])
          ).not.toMatch(FORBIDDEN);
          expect(strip(copy.body, [poiName, distanceLabel])).not.toMatch(
            FORBIDDEN
          );
          expect(copy.note ?? '').not.toMatch(FORBIDDEN);
        }
      ),
      {
        examples: [
          [
            'EVENT_VENUE',
            ' ',
            '365분식',
            '10분 거리',
            new Date('2020-01-01T00:00:00Z'),
          ],
          [
            'EVENT_VENUE',
            '365분식',
            '4시30분왕족발 축제',
            '10분 거리',
            new Date('2026-12-31T00:00:00Z'),
          ],
          [
            'TRENDING',
            '오늘 열려요 장터',
            '부산 불꽃축제',
            '약 1.2km',
            new Date('2028-02-29T00:00:00Z'),
          ],
        ],
      }
    );
  });
});
