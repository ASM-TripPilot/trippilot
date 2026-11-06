import * as fc from 'fast-check';

import { CATEGORY_PALETTES } from '@/features/reflection/index.view';
import type { PaletteKey } from '@/features/reflection/index.view';
import type {
  DayHighlight,
  ItineraryDaysItem,
  TripSummary,
  TripSummaryStats,
} from '@/shared/api/index.schemas';
import { day, slot } from '@/test-support/itineraryFixtures';

import {
  buildSummaryMagazineVM,
  type SummaryMagazineInput,
} from './summaryMagazineVM';

/**
 * TRIP-1666 · j04 여행 요약 매거진 VM — 요약·여행·일정 재료를 "화면이 계산 없이 그대로 그릴 값"으로 바꾸는 순수 함수의 계약.
 * 초심자용: VM(뷰 모델) = 화면 전용으로 미리 계산해 둔 값 묶음. 색은 hex 가 아니라 팔레트 **키**(`'맛집'`)로 담기므로
 * 색 규칙을 이름으로 단언한다 — 화면에서 색을 읽지 않는다(README 판정 4: 생김새 단언 금지).
 *
 * 무엇을 보장하나(AC 번호는 01 브리프 §7):
 *  - AC-4 표지: 제목·지역·기간·스티커·"N곳 · 사진 M장". 여행 정보가 없으면 제목 폴백 `이번 여행`, 지역·기간 없음. 표지 사진은 이번엔 늘 null(색만).
 *  - AC-5 표지 색: 일차를 넘어 전 방문 카테고리 최빈(미술+문화·술집+야경 한 통, 모르는 카테고리는 안 센다, 동률은 먼저 나온 것), 없으면 중립.
 *  - AC-6 인용문: 서버 문장 원문 그대로, 공백뿐이면 없음.
 *  - AC-7 일차 카드: highlights 순서·개수 그대로, 색은 "그 날짜 일정 슬롯 중 이름이 places 에 있는 것"의 최빈.
 *  - AC-8 일차 거리: 서버 km 가 있고 방문 ≥ 2 일 때만 `{km} · 근사|경로`. "측정 못 함"을 0km 로 쓰지 않는다.
 *  - AC-9 숫자 타일 / AC-10 동선 / AC-11 PBT(무예외·카드 수 보존·소요시간 키 0).
 *
 * 입력 계약(구현이 따른다): `{ summary, trip?, itineraryDays?, routeSources? }` — itineraryDays 가 undefined 면 "일정을 모름"(전부 중립),
 * routeSources 는 `distanceSourceByDate` 의 반환 모양 `{ overall, byDate }` 또는 없음.
 */

const STATS: TripSummaryStats = {
  totalVisits: 12,
  totalDistanceKm: 38,
  distanceSource: 'VISIT_LINE',
  totalPhotos: 24,
  hasLocationData: true,
};
const D1 = '2026-09-24';
const D2 = '2026-09-25';
const D3 = '2026-09-26';

const hl = (
  date: string,
  dayOrder: number,
  places: string[],
  over: Partial<DayHighlight> = {}
): DayHighlight => ({
  date,
  dayOrder,
  visitCount: places.length,
  places,
  ...over,
});
const summaryOf = (
  highlights: DayHighlight[],
  over: Partial<TripSummary> = {}
): TripSummary => ({
  narrative: '바다를 보며, 혼자만의 하루',
  highlights,
  stats: STATS,
  source: 'RULE',
  generatedAt: '2026-09-26T10:00:00Z',
  ...over,
});
const TRIP: NonNullable<SummaryMagazineInput['trip']> = {
  title: '부산 여행',
  startDate: D1,
  endDate: D2,
  destinations: [{ seq: 1, region: '부산', nights: 1 }],
};
/** 이름·카테고리만 가진 일정 날짜 한 칸. */
const planDay = (date: string, ...named: [string, string | null][]) =>
  day(
    date,
    named.map(([nameKo, category], i) =>
      slot(`${date}-${i}`, { nameKo, category })
    )
  );
const build = (
  highlights: DayHighlight[],
  extra: Partial<SummaryMagazineInput> = {}
) => buildSummaryMagazineVM({ summary: summaryOf(highlights), ...extra });

describe('표지 (AC-4)', () => {
  it('여행 제목·첫 목적지 지역·기간·스티커·"N곳 · 사진 M장" 라벨이 서고, 표지 사진은 없다(색만)', () => {
    const { cover, tripTitleKnown } = build([hl(D1, 1, ['A'])], {
      trip: TRIP,
    });
    expect(cover).toMatchObject({
      title: '부산 여행',
      region: '부산',
      dateLabel: '2026.09.24 ~ 09.25',
      stickerLabel: '여행 회고',
      visitLabel: '12곳',
      photoLabel: '사진 24장',
      picture: null,
    });
    expect(tripTitleKnown).toBe(true);
  });

  it('여행 정보가 아직 없으면(조회 전·실패) 제목은 `이번 여행`, 지역·기간은 없고, 제목을 아는 척하지 않는다', () => {
    const { cover, tripTitleKnown } = build([hl(D1, 1, ['A'])]);
    expect(cover.title).toBe('이번 여행');
    expect(cover.region).toBeUndefined();
    expect(cover.dateLabel).toBeUndefined();
    expect(cover.visitLabel).toBe('12곳');
    expect(tripTitleKnown).toBe(false);
  });

  it.each(['', '   '])(
    '여행 제목이 %p 이면 폴백이고 제목을 안다고 하지 않는다',
    (title) => {
      const { cover, tripTitleKnown } = build([], {
        trip: { ...TRIP, title },
      });
      expect(cover.title).toBe('이번 여행');
      expect(tripTitleKnown).toBe(false);
    }
  );

  it('지역은 destinations[0] 만 쓰고, 목적지가 없으면 지역이 없다', () => {
    const two = build([], {
      trip: {
        ...TRIP,
        destinations: [
          { seq: 1, region: '제주', nights: 1 },
          { seq: 2, region: '서울', nights: 1 },
        ],
      },
    });
    expect(two.cover.region).toBe('제주');
    expect(
      build([], { trip: { ...TRIP, destinations: [] } }).cover.region
    ).toBeUndefined();
  });

  it('기간은 시작·끝이 둘 다 있을 때만, 같은 날이면 날짜 하나', () => {
    expect(
      build([], { trip: { ...TRIP, endDate: '' } }).cover.dateLabel
    ).toBeUndefined();
    expect(
      build([], { trip: { ...TRIP, startDate: '' } }).cover.dateLabel
    ).toBeUndefined();
    expect(build([], { trip: { ...TRIP, endDate: D1 } }).cover.dateLabel).toBe(
      '2026.09.24'
    );
  });

  it('방문·사진 라벨은 요약 통계 값이고 0 도 그대로 쓴다', () => {
    const vm = buildSummaryMagazineVM({
      summary: summaryOf([], {
        stats: { ...STATS, totalVisits: 0, totalPhotos: 0 },
      }),
    });
    expect(vm.cover.visitLabel).toBe('0곳');
    expect(vm.cover.photoLabel).toBe('사진 0장');
  });
});

describe('표지 색 · 동선 박스 색 (AC-5)', () => {
  const paletteOf = (
    highlights: DayHighlight[],
    itineraryDays: ItineraryDaysItem[] | undefined
  ) => build(highlights, { itineraryDays });

  it('일차를 넘어 전 방문의 최빈 카테고리가 표지 색이고 동선 박스 색(routePalette)도 같다', () => {
    const vm = paletteOf(
      [hl(D1, 1, ['A', 'B']), hl(D2, 2, ['C', 'D'])],
      [
        planDay(D1, ['A', '맛집'], ['B', '카페']),
        planDay(D2, ['C', '카페'], ['D', '카페']),
      ]
    );
    expect(vm.cover.palette).toBe('카페');
    expect(vm.routePalette).toBe('카페');
  });

  it('미술은 문화로, 술집은 야경으로 한 통에 센다(영문 코드도 같다)', () => {
    expect(
      paletteOf(
        [hl(D1, 1, ['A', 'B', 'C'])],
        [planDay(D1, ['A', '미술'], ['B', 'CULTURE'], ['C', '맛집'])]
      ).cover.palette
    ).toBe('문화');
    expect(
      paletteOf(
        [hl(D1, 1, ['A', 'B', 'C'])],
        [planDay(D1, ['A', '술집'], ['B', '야경'], ['C', '맛집'])]
      ).cover.palette
    ).toBe('야경');
  });

  it('동률이면 먼저 나온 곳(앞 일차, 같은 날이면 앞 슬롯)의 색이다', () => {
    expect(
      paletteOf(
        [hl(D1, 1, ['A']), hl(D2, 2, ['B'])],
        [planDay(D1, ['A', '맛집']), planDay(D2, ['B', '카페'])]
      ).cover.palette
    ).toBe('맛집');
    expect(
      paletteOf(
        [hl(D1, 1, ['A', 'B'])],
        [planDay(D1, ['A', '카페'], ['B', '맛집'])]
      ).cover.palette
    ).toBe('카페');
  });

  it('places 에 없는 슬롯(건너뜀·대체)은 세지 않는다', () => {
    expect(
      paletteOf(
        [hl(D1, 1, ['A'])],
        [
          planDay(
            D1,
            ['A', '맛집'],
            ['X', '카페'],
            ['Y', '카페'],
            ['Z', '카페']
          ),
        ]
      ).cover.palette
    ).toBe('맛집');
  });

  it.each<[string, DayHighlight[], ItineraryDaysItem[] | undefined]>([
    ['일정을 모름(undefined)', [hl(D1, 1, ['A'])], undefined],
    ['일정이 비어 있음', [hl(D1, 1, ['A'])], []],
    [
      '이름이 하나도 안 맞음(즉석 방문)',
      [hl(D1, 1, ['즉석'])],
      [planDay(D1, ['A', '맛집'])],
    ],
    [
      '카테고리가 모르는 값·null',
      [hl(D1, 1, ['A', 'B'])],
      [planDay(D1, ['A', '공항'], ['B', null])],
    ],
    ['방문한 곳이 없음', [], [planDay(D1, ['A', '맛집'])]],
  ])('%s → 중립(STATS)', (_label, highlights, days) => {
    const vm = paletteOf(highlights, days);
    expect(vm.cover.palette).toBe('STATS');
    expect(vm.routePalette).toBe('STATS');
  });
});

describe('인용문 (AC-6)', () => {
  it('서버 문장 그대로이고 마지막 쉼표 뒤 구가 형광펜 구간이다(head + mark = 원문)', () => {
    const quote = build([]).quote;
    expect(quote).toEqual({
      text: '바다를 보며, 혼자만의 하루',
      head: '바다를 보며, ',
      mark: '혼자만의 하루',
    });
  });

  it('쉼표가 없으면 전체가 형광펜 구간이다', () => {
    const quote = buildSummaryMagazineVM({
      summary: summaryOf([], { narrative: '비가 스친 날에도 바다를 걸었다.' }),
    }).quote;
    expect(quote).toEqual({
      text: '비가 스친 날에도 바다를 걸었다.',
      head: '',
      mark: '비가 스친 날에도 바다를 걸었다.',
    });
  });

  it.each(['', '   ', '\n'])(
    '문장이 %p 이면 인용문이 없다(null)',
    (narrative) => {
      expect(
        buildSummaryMagazineVM({ summary: summaryOf([], { narrative }) }).quote
      ).toBeNull();
    }
  );
});

describe('일차 카드 (AC-7)', () => {
  it('highlights 순서·개수 그대로 — 라벨은 dayOrder 기준 `N일차`, 방문 수는 visitCount, 칩은 places 원문', () => {
    const { days } = build([
      hl(D1, 1, ['광안리', '광안리'], { visitCount: 5 }),
      hl(D3, 3, ['전포 카페거리']),
    ]);
    expect(days).toHaveLength(2);
    expect(days.map((d) => d.key)).toEqual([D1, D3]);
    expect(days.map((d) => d.dayLabel)).toEqual(['1일차', '3일차']);
    expect(days.map((d) => d.visitCountLabel)).toEqual(['5곳', '1곳']);
    expect(days.map((d) => d.places)).toEqual([
      ['광안리', '광안리'],
      ['전포 카페거리'],
    ]);
  });

  it('카드 색은 그 날짜 슬롯 중 이름이 places 에 있는 것의 최빈이다 — 날짜별로 따로', () => {
    const { days } = build([hl(D1, 1, ['A', 'B']), hl(D2, 2, ['C'])], {
      itineraryDays: [
        planDay(D1, ['A', '맛집'], ['B', '맛집'], ['C', '카페']),
        planDay(D2, ['C', '자연'], ['A', '맛집'], ['B', '맛집']),
      ],
    });
    expect(days.map((d) => d.palette)).toEqual(['맛집', '자연']);
  });

  it('다른 날짜의 같은 이름 슬롯·부분 일치·이름 없는 슬롯은 세지 않아 중립이다', () => {
    const { days } = build([hl(D1, 1, ['광안리']), hl(D2, 2, ['해운대'])], {
      itineraryDays: [
        planDay(D1, ['광안리해수욕장', '명소'], ['해운대', '맛집']),
        planDay(D2, ['해운대', null]),
      ],
    });
    expect(days.map((d) => d.palette)).toEqual(['STATS', 'STATS']);
  });

  it('일정을 모르면 모든 카드가 중립이다', () => {
    expect(
      build([hl(D1, 1, ['A'])], { itineraryDays: undefined }).days[0].palette
    ).toBe('STATS');
  });

  it('일차 카드 색의 동률은 먼저 나온 슬롯이다', () => {
    expect(
      build([hl(D1, 1, ['A', 'B'])], {
        itineraryDays: [planDay(D1, ['A', '카페'], ['B', '맛집'])],
      }).days[0].palette
    ).toBe('카페');
  });
});

describe('일차 거리 (AC-8 · Q3 · BR-U5-43)', () => {
  const dist = (
    over: Partial<DayHighlight>,
    routeSources?: SummaryMagazineInput['routeSources'],
    places: string[] = ['A', 'B']
  ) => build([hl(D1, 1, places, over)], { routeSources }).days[0].distance;

  it.each<[string, Partial<DayHighlight>, string]>([
    [
      '서버 근사',
      { distanceKm: 1.929, distanceSource: 'VISIT_LINE' },
      '1.9km · 근사',
    ],
    ['서버 경로', { distanceKm: 12, distanceSource: 'ROUTE' }, '12km · 경로'],
    ['출처가 비면 근사로 본다', { distanceKm: 3 }, '3km · 근사'],
  ])('방문 2곳 이상 + 서버 km → %s', (_label, over, expected) => {
    expect(dist(over)).toBe(expected);
  });

  it('서버 출처가 없을 때만 위치 자동화가 파생한 날짜별 출처를 쓰고, 서버 출처가 있으면 서버가 이긴다', () => {
    const sources = {
      overall: 'VISIT_LINE' as const,
      byDate: { [D1]: 'ROUTE' as const },
    };
    expect(dist({ distanceKm: 3 }, sources)).toBe('3km · 경로');
    expect(dist({ distanceKm: 3, distanceSource: 'VISIT_LINE' }, sources)).toBe(
      '3km · 근사'
    );
  });

  it.each<[string, Partial<DayHighlight>, string[]]>([
    ['km 가 null(측정 못 함)', { distanceKm: null }, ['A', 'B']],
    ['km 가 없음(옛 요약)', {}, ['A', 'B']],
    ['방문 1곳', { distanceKm: 3, distanceSource: 'ROUTE' }, ['A']],
    ['방문 0곳(서버가 0.0 을 채운다)', { distanceKm: 0, visitCount: 0 }, []],
  ])('거리 줄이 없다(null) — %s', (_label, over, places) => {
    expect(dist(over, undefined, places)).toBeNull();
  });

  it('(b) 위치 자동화가 켜져 있어도 서버 km 가 없는 옛 요약은 거리 줄이 없다 — 예전 `· 거리 근사` 라벨은 사라진다', () => {
    expect(
      dist({}, { overall: 'ROUTE', byDate: { [D1]: 'ROUTE' } })
    ).toBeNull();
  });
});

describe('숫자 타일 (AC-9 · BR-U5-39 · BR-U5-43)', () => {
  const tiles = (
    over: Partial<TripSummaryStats>,
    routeSources?: SummaryMagazineInput['routeSources']
  ) => {
    const vm = buildSummaryMagazineVM({
      summary: summaryOf([], { stats: { ...STATS, ...over } }),
      routeSources,
    });
    return Object.fromEntries(vm.stats.map((tile) => [tile.key, tile]));
  };

  it('방문·이동·사진 세 타일이 있고 값은 기존 통계 식(summaryStats)과 같다', () => {
    const t = tiles({});
    expect(t.visits).toMatchObject({ label: '방문', value: '12' });
    expect(t.photos).toMatchObject({ label: '사진', value: '24' });
    expect(t.distance).toMatchObject({
      label: '이동',
      value: '38km',
      note: '근사',
    });
    expect(Object.keys(t).sort()).toEqual(['distance', 'photos', 'visits']);
  });

  it('이동 출처 라벨은 위치 자동화 파생 전체 출처가 있으면 그것, 없으면 서버 stats.distanceSource', () => {
    expect(tiles({ distanceSource: 'ROUTE' }).distance.note).toBe('경로');
    expect(tiles({}, { overall: 'ROUTE', byDate: {} }).distance.note).toBe(
      '경로'
    );
  });

  it('위치 기록이 없으면 이동은 `—` 이고 출처 라벨이 없다(0km 로 쓰지 않는다)', () => {
    const t = tiles({ hasLocationData: false, totalDistanceKm: 0 });
    expect(t.distance.value).toBe('—');
    expect(t.distance.note).toBeUndefined();
  });
});

describe('동선 (AC-10)', () => {
  it('일차를 넘어 번호 1..N 이 이어지고, 정류장마다 그 일차 라벨이 있다(방문 0곳인 날은 건너뛴다)', () => {
    const { route } = build([
      hl(D1, 1, ['A', 'B']),
      hl(D2, 2, []),
      hl(D3, 3, ['C']),
    ]);
    expect(route.map((s) => [s.order, s.name, s.dayLabel])).toEqual([
      [1, 'A', '1일차'],
      [2, 'B', '1일차'],
      [3, 'C', '3일차'],
    ]);
  });

  it('방문이 하나도 없으면 동선이 비어 있다', () => {
    expect(build([hl(D1, 1, []), hl(D2, 2, [])]).route).toEqual([]);
    expect(build([]).route).toEqual([]);
  });
});

describe('성질 (AC-11 · INV-3 · INV-4)', () => {
  const KEYS = Object.keys(CATEGORY_PALETTES) as PaletteKey[];
  const dateArb = fc.constantFrom(D1, D2, D3);
  const highlightArb = fc.record({
    date: dateArb,
    dayOrder: fc.integer({ min: 1, max: 30 }),
    visitCount: fc.integer({ min: 0, max: 20 }),
    places: fc.array(fc.string({ maxLength: 10 }), { maxLength: 5 }),
    distanceKm: fc.option(fc.double({ min: 0, max: 500, noNaN: true }), {
      nil: undefined,
    }),
    distanceSource: fc.constantFrom('ROUTE', 'VISIT_LINE', undefined),
  });
  const planArb = fc.array(
    fc.record({
      date: dateArb,
      slots: fc.array(
        fc.tuple(
          fc.string({ maxLength: 10 }),
          fc.oneof(
            fc.constantFrom('맛집', '카페', '미술', '술집', 'FOOD', null),
            fc.string({ maxLength: 6 })
          )
        ),
        { maxLength: 5 }
      ),
    }),
    { maxLength: 3 }
  );
  const tripArb = fc.option(
    fc.record({
      title: fc.string({ maxLength: 12 }),
      startDate: fc.constantFrom('', D1),
      endDate: fc.constantFrom('', D2),
      destinations: fc.array(
        fc.record({
          seq: fc.integer({ min: 1, max: 3 }),
          region: fc.string({ maxLength: 6 }),
          nights: fc.integer({ min: 0, max: 5 }),
        }),
        { maxLength: 2 }
      ),
    }),
    { nil: undefined }
  );
  const inputArb = fc.record({
    highlights: fc.array(highlightArb, { maxLength: 5 }),
    plan: fc.option(planArb, { nil: undefined }),
    trip: tripArb,
    narrative: fc.string({ maxLength: 30 }),
  });

  /** 객체의 키 이름을 전부 모은다(값은 보지 않는다 — 장소 이름에 `분` 같은 글자가 있어도 무관). */
  function keysDeep(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
    else if (value && typeof value === 'object')
      for (const [k, v] of Object.entries(value)) {
        out.push(k);
        keysDeep(v, out);
      }
    return out;
  }

  it('임의 입력에도 던지지 않고, 카드 수·순서·동선 번호가 보존되며, 색 키는 11개 안이고, 소요시간 키가 없다', () => {
    fc.assert(
      fc.property(inputArb, ({ highlights, plan, trip, narrative }) => {
        const vm = buildSummaryMagazineVM({
          summary: summaryOf(highlights as DayHighlight[], { narrative }),
          trip,
          itineraryDays: plan?.map((p) =>
            planDay(p.date, ...(p.slots as [string, string | null][]))
          ),
        });
        expect(vm.days).toHaveLength(highlights.length);
        expect(vm.days.map((d) => d.key)).toEqual(
          highlights.map((h) => h.date)
        );
        expect(vm.route.map((s) => s.order)).toEqual(
          vm.route.map((_, i) => i + 1)
        );
        expect(vm.route).toHaveLength(
          highlights.reduce((n, h) => n + h.places.length, 0)
        );
        for (const palette of [
          vm.cover.palette,
          vm.routePalette,
          ...vm.days.map((d) => d.palette),
        ]) {
          expect(KEYS).toContain(palette);
          expect(['PLAN_B', 'SKIPPED']).not.toContain(palette);
        }
        expect(keysDeep(vm).join(' ')).not.toMatch(
          /duration|dwell|minute|소요|elapsed/i
        );
      }),
      { numRuns: 200 }
    );
  });
});

// TRIP-1781 · 표지 사진 — 고른 사진(훅 결과)을 빌더 입력으로 받아 `cover.picture` 한 곳에서만 만든다.
// 이 한 곳 덕분에 j04 표지·j06 덱 표지·j06 대표 카드가 같은 사진을 받는다(각 화면이 따로 계산하지 않는다).
describe('표지 사진 입력 (TRIP-1781 VM-1·VM-2)', () => {
  const PHOTO = { uri: 'file://a', poiId: 'p1' };

  it('VM-1 · 고른 사진이 cover.picture 가 되고, 표지의 나머지 값(제목·라벨·색)은 사진 없을 때와 같다', () => {
    const rows = [hl(D1, 1, ['A'])];
    const withPhoto = build(rows, { trip: TRIP, coverPhoto: PHOTO });
    const without = build(rows, { trip: TRIP });

    expect(withPhoto.cover.picture).toEqual(PHOTO);
    expect({ ...withPhoto.cover, picture: null }).toEqual(without.cover);
  });

  it.each([
    ['null', { coverPhoto: null }],
    ['생략', {}],
    ['주소가 빈 문자열', { coverPhoto: { uri: '', poiId: 'p1' } }],
  ])(
    'VM-2 · 사진 입력이 %s 이면 picture 는 null(빈 칸·깨진 이미지를 만들지 않는다)',
    (_name, extra) => {
      expect(build([hl(D1, 1, ['A'])], extra).cover.picture).toBeNull();
    }
  );
});

describe('TRIP-1795 · 고친 이름·분류와 서버 방문지 이름의 조인 (AC-5)', () => {
  /**
   * 서버 요약의 `places` 는 **장소 원본 이름**이다. 일차 카드 색은 "일정 슬롯 중 이름이 places 에 있는 것"의 카테고리 최빈이라
   * 조인 키는 반드시 원본 `nameKo` 여야 하고(고친 이름으로 조인하면 서버와 안 맞아 색이 중립으로 빠진다),
   * 색의 재료인 카테고리 값만 고친 분류를 따른다.
   */
  const renamedDay = day(D1, [
    {
      ...slot(`${D1}-0`, { nameKo: '웨이브온', category: '자연' }),
      displayName: '우리 아지트',
      displayCategory: '맛집',
    },
  ]);

  it('SM-D1 · places 가 원본 이름이면 조인이 되고, 일차 카드 색은 고친 분류(맛집)를 따른다', () => {
    const { days } = build([hl(D1, 1, ['웨이브온'])], {
      itineraryDays: [renamedDay],
    });

    expect(days[0].palette).toBe('맛집'); // 원본 분류(자연)였다면 '자연'
  });

  it('SM-D2 · places 가 고친 이름이면 조인하지 않는다(서버 문자열은 원본이라 이 경우는 없지만 키가 원본임을 못박는다)', () => {
    const { days } = build([hl(D1, 1, ['우리 아지트'])], {
      itineraryDays: [renamedDay],
    });

    expect(days[0].palette).toBe('STATS');
  });
});
