import * as fc from 'fast-check';

import {
  SHARE_FORMATS,
  buildShareCard,
  buildSummaryMagazineVM,
} from '@/features/reflection/index.view';
import type {
  DayHighlight,
  ShareCardCopy,
  Trip,
  TripSummary,
  TripSummaryStats,
} from '@/shared/api/index.schemas';

import {
  buildStorySlides,
  resolveShareText,
  type StorySlide,
} from './shareStory';

/**
 * TRIP-1667 · j06 스토리 덱 — 장(slide) 목록을 만드는 순수 함수와 "화면에 보여 줄 문구" 우선순위 함수의 계약.
 * 초심자용: 순수 함수 = 같은 입력이면 늘 같은 출력, 화면·네트워크를 모른다. 그래서 준비(입력) → 실행(함수 호출) → 단언(출력) 3동작으로 끝난다.
 *
 * 무엇을 보장하나(AC 번호는 01 브리프 §7):
 *  - AC-1 장 구성: 표지 → 일차 장면(방문지가 있는 일차만, 최대 5장) → 동선(방문 1곳 이상) → 숫자. 방문 0곳이면 표지·숫자 두 장.
 *  - AC-10 일차 장면은 j04 빌더가 만든 일차 카드를 그대로 싣는다(같은 규칙을 두 번 쓰지 않는다) — 같은 객체여야 한다.
 *  - AC-11 동선은 대표 카드(`ShareCardVM`)의 방문 순서에서 앞 6곳.
 *  - AC-12/14 숫자 장의 숫자는 대표 카드의 숫자와 **같은 객체**다(두 곳이 어긋날 수 없다). INV-3: 소요시간 키 없음.
 *  - AC-12 해시태그 우선순위(고친 값 > 서버 값 > 온디바이스)와 AC-9 캡션 150자 상한이 `resolveShareText` 한 곳에 있다.
 *
 * 계약(02a §2): `StorySlide` 는 `kind` 로 갈리는 4종이고 `key` 는 `cover` · `day-{n}`(n = 장면에 **실제로 실린** 일차의 1부터 센 순번) · `route` · `stats`.
 */

const TRIP = {
  tripId: 'trip-1',
  title: '부산 여행',
  startDate: '2026-06-10',
  endDate: '2026-06-12',
  party: 2,
  preferenceSnapshot: {},
  destinations: [{ seq: 1, region: '부산', nights: 2 }],
  status: 'ENDED',
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-12T10:00:00Z',
} as Trip;

const STATS: TripSummaryStats = {
  totalVisits: 12,
  totalDistanceKm: 38,
  distanceSource: 'VISIT_LINE',
  totalPhotos: 24,
  hasLocationData: true,
};

const hl = (
  n: number,
  places: string[],
  over: Partial<DayHighlight> = {}
): DayHighlight => ({
  date: `2026-06-${String(10 + n).padStart(2, '0')}`,
  dayOrder: n,
  visitCount: places.length,
  places,
  ...over,
});

function build(
  highlights: DayHighlight[],
  statsOver: Partial<TripSummaryStats> = {}
) {
  const summary: TripSummary = {
    narrative: '좋은 여행이었어요',
    highlights,
    stats: { ...STATS, ...statsOver },
    source: 'RULE',
    generatedAt: '2026-06-12T10:00:00Z',
  };
  const magazine = buildSummaryMagazineVM({ summary, trip: TRIP });
  const card = buildShareCard({
    summary,
    trip: TRIP,
    format: SHARE_FORMATS[0],
  });
  return { magazine, card, slides: buildStorySlides(magazine, card) };
}

const keysOf = (slides: StorySlide[]) => slides.map((s) => s.key);
const slideOf = <K extends StorySlide['kind']>(
  slides: StorySlide[],
  kind: K
): Extract<StorySlide, { kind: K }>[] =>
  slides.filter((s): s is Extract<StorySlide, { kind: K }> => s.kind === kind);

describe('buildStorySlides — 장 구성(AC-1)', () => {
  it('SS-1 · 방문지가 있는 두 일차 → 표지 · 1일차 · 2일차 · 동선 · 숫자 순서와 키', () => {
    // 준비: 1일차 2곳, 2일차 2곳
    const { slides } = build([
      hl(1, ['광안리', '감천']),
      hl(2, ['자갈치', '송정']),
    ]);

    // 단언: 순서·키 — 장 수가 곧 진행 바 구간 수다
    expect(keysOf(slides)).toEqual([
      'cover',
      'day-1',
      'day-2',
      'route',
      'stats',
    ]);
    expect(slides.map((s) => s.kind)).toEqual([
      'cover',
      'day',
      'day',
      'route',
      'stats',
    ]);
  });

  it('SS-2 · 표지·일차·숫자 장은 빌더 결과·대표 카드의 "같은 객체"를 싣는다(규칙을 두 번 쓰지 않는다)', () => {
    const { slides, magazine, card } = build([
      hl(1, ['광안리', '감천']),
      hl(2, ['자갈치']),
    ]);

    expect(slideOf(slides, 'cover')[0].cover).toBe(magazine.cover);
    const days = slideOf(slides, 'day');
    expect(days[0].day).toBe(magazine.days[0]);
    expect(days[1].day).toBe(magazine.days[1]);
    expect(slideOf(slides, 'stats')[0].cells).toBe(card.statsCells);
  });

  it('SS-3 · 방문 0곳이면 장면·동선 장이 없고 표지 → 숫자 두 장', () => {
    const { slides } = build([]);

    expect(keysOf(slides)).toEqual(['cover', 'stats']);
  });

  it('SS-4 · 방문지가 없는 일차는 장면에서 빠지고, 키 번호는 실린 일차만 1부터 센다', () => {
    // 준비: 1일차 2곳 · 2일차 0곳 · 3일차 1곳
    const { slides, magazine } = build([
      hl(1, ['광안리', '감천']),
      hl(2, []),
      hl(3, ['송정']),
    ]);

    // 단언: 2일차(빈 날)는 건너뛰고 3일차가 day-2 가 된다
    expect(keysOf(slides)).toEqual([
      'cover',
      'day-1',
      'day-2',
      'route',
      'stats',
    ]);
    const days = slideOf(slides, 'day');
    expect(days[0].day).toBe(magazine.days[0]);
    expect(days[1].day).toBe(magazine.days[2]);
    expect(days[1].day.dayLabel).toBe('3일차');
  });

  it('SS-5 · 일차가 7개여도 장면은 앞 5일차까지(day-1..day-5), 동선·숫자 장은 그대로 붙는다', () => {
    const { slides, magazine } = build(
      Array.from({ length: 7 }, (_, i) => hl(i + 1, [`장소${i + 1}`]))
    );

    expect(keysOf(slides)).toEqual([
      'cover',
      'day-1',
      'day-2',
      'day-3',
      'day-4',
      'day-5',
      'route',
      'stats',
    ]);
    // 앞 5일차가 실린다(뒤 5일차가 아니다)
    expect(slideOf(slides, 'day').map((s) => s.day)).toEqual(
      magazine.days.slice(0, 5)
    );
  });
});

describe('buildStorySlides — 동선 장(AC-11)', () => {
  it('SS-6 · 동선은 대표 카드 방문 순서의 앞 6곳 · 번호는 1부터 이어지고 팔레트는 표지와 같다', () => {
    // 준비: 3일 × 3곳 = 9곳
    const { slides, card, magazine } = build([
      hl(1, ['a1', 'a2', 'a3']),
      hl(2, ['b1', 'b2', 'b3']),
      hl(3, ['c1', 'c2', 'c3']),
    ]);

    const [route] = slideOf(slides, 'route');
    expect(route.stops).toEqual(card.orderedVisits.slice(0, 6));
    expect(route.stops.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(route.stops.map((s) => s.place)).toEqual([
      'a1',
      'a2',
      'a3',
      'b1',
      'b2',
      'b3',
    ]);
    expect(route.palette).toBe(magazine.routePalette);
  });

  it('SS-7 · 방문지가 6곳 이하면 전부, 한 곳도 없으면 동선 장 자체가 없다(짝)', () => {
    const few = slideOf(build([hl(1, ['a', 'b'])]).slides, 'route');
    expect(few).toHaveLength(1);
    expect(few[0].stops).toHaveLength(2);

    expect(slideOf(build([hl(1, [])]).slides, 'route')).toHaveLength(0);
  });
});

describe('buildStorySlides — 숫자 장(AC-12·14)과 INV-3', () => {
  it('SS-8 · 숫자 장의 거리 각주는 j04 숫자 타일의 각주와 같고, 거리를 못 잰 날은 각주가 없다', () => {
    const measured = build([hl(1, ['a'])], { hasLocationData: true });
    const tile = measured.magazine.stats.find((t) => t.key === 'distance');
    expect(tile?.note).toBeTruthy(); // 오라클이 비면 아래 단언이 공허하다
    expect(slideOf(measured.slides, 'stats')[0].distanceNote).toBe(tile?.note);

    const unknown = build([hl(1, ['a'])], { hasLocationData: false });
    expect(slideOf(unknown.slides, 'stats')[0].cells.distanceText).toBe('—');
    expect(slideOf(unknown.slides, 'stats')[0].distanceNote).toBeNull();
  });

  it('SS-9 · INV-3 · 어떤 장에도 소요시간 필드(duration)가 없다(키 재귀 스캔) — 스캔이 비지 않았음을 같은 it 에서 확인', () => {
    const { slides } = build([hl(1, ['a', 'b'], { distanceKm: 1.9 })]);

    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) {
          keys.push(k);
          walk(child);
        }
      }
    };
    walk(slides);

    expect(keys).toContain('cells'); // 앵커: 훑었다
    expect(keys.filter((k) => /duration|minutes|소요/i.test(k))).toEqual([]);
  });
});

describe('buildStorySlides — 불변식(PBT)', () => {
  it('SS-10 · 일차별 방문 수가 어떻게 섞여도: 첫 장 표지·끝 장 숫자, 키 유일, 장면 ≤ 5, 동선 정지점 ≤ 6, 장 수 공식', () => {
    // 일차별 방문 수 0~4, 일차 0~9개. 경계(빈 목록·전부 0·7일·빈 날 사이)는 examples 로 박는다.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 9 }),
        (counts) => {
          const highlights = counts.map((n, i) =>
            hl(
              i + 1,
              Array.from({ length: n }, (_, k) => `p${i + 1}-${k + 1}`)
            )
          );
          const { slides } = build(highlights);

          const withPlaces = counts.filter((n) => n > 0).length;
          const anyPlace = withPlaces > 0;
          const days = slideOf(slides, 'day');
          const route = slideOf(slides, 'route');

          expect(slides[0].kind).toBe('cover');
          expect(slides[slides.length - 1].kind).toBe('stats');
          expect(new Set(keysOf(slides)).size).toBe(slides.length);
          expect(days.length).toBe(Math.min(5, withPlaces));
          expect(days.map((d) => d.key)).toEqual(
            days.map((_, i) => `day-${i + 1}`)
          );
          expect(route.length).toBe(anyPlace ? 1 : 0);
          if (route[0]) {
            expect(route[0].stops.length).toBe(
              Math.min(
                6,
                counts.reduce((a, b) => a + b, 0)
              )
            );
          }
          expect(slides.length).toBe(2 + days.length + route.length);
        }
      ),
      {
        examples: [
          [[]],
          [[0, 0]],
          [[0, 4, 0]],
          [[1, 1, 1, 1, 1, 1, 1]],
          [[4, 4, 4, 4, 4, 4, 4, 4, 4]],
        ],
      }
    );
  });
});

describe('resolveShareText — 캡션 150자 · 해시태그 우선순위(AC-9·12)', () => {
  const COPY: ShareCardCopy = {
    caption: '광안리에서 노을을 봤어요',
    hashtags: ['#광안리노을', '#감천문화마을'],
    isFallback: false,
  };
  const ON_DEVICE = '#부산여행';

  it('RT-1 · 해시태그는 고친 값 > 서버 값 > 온디바이스 순서로 이긴다', () => {
    const base = { copy: COPY, onDeviceHashtags: ON_DEVICE };

    expect(
      resolveShareText({ ...base, editedHashtags: '#내태그' }).hashtagText
    ).toBe('#내태그');
    expect(
      resolveShareText({ ...base, editedHashtags: null }).hashtagText
    ).toBe('#광안리노을 #감천문화마을');
    expect(
      resolveShareText({
        copy: undefined,
        editedHashtags: null,
        onDeviceHashtags: ON_DEVICE,
      }).hashtagText
    ).toBe(ON_DEVICE);
  });

  it('RT-2 · 서버 해시태그가 빈 배열(폴백)이면 온디바이스로 내려가고, 빈 문자열로 고친 값은 서버 값을 이긴다(기존 규칙 그대로)', () => {
    const fallback: ShareCardCopy = {
      caption: '',
      hashtags: [],
      isFallback: true,
    };

    expect(
      resolveShareText({
        copy: fallback,
        editedHashtags: null,
        onDeviceHashtags: ON_DEVICE,
      }).hashtagText
    ).toBe(ON_DEVICE);
    expect(
      resolveShareText({
        copy: COPY,
        editedHashtags: '',
        onDeviceHashtags: ON_DEVICE,
      }).hashtagText
    ).toBe('');
  });

  it('RT-3 · 서버가 약속을 어겨도 캡션은 앞 150자, 해시태그는 앞 10개만(공백 한 칸으로 이음)', () => {
    const tags = Array.from({ length: 11 }, (_, i) => `#태그${i + 1}`);

    const out = resolveShareText({
      copy: { caption: '가'.repeat(151), hashtags: tags, isFallback: false },
      editedHashtags: null,
      onDeviceHashtags: ON_DEVICE,
    });

    expect(out.caption).toBe('가'.repeat(150));
    expect(out.hashtagText).toBe(tags.slice(0, 10).join(' '));
  });

  it('RT-4 · 서버 문구가 아직 없으면(copy 없음) 캡션은 빈 문자열이다', () => {
    expect(
      resolveShareText({
        copy: undefined,
        editedHashtags: null,
        onDeviceHashtags: ON_DEVICE,
      }).caption
    ).toBe('');
  });

  it('RT-5 · 어떤 입력에도: 캡션 ≤ 150자 · 고친 값이 있으면 그 값 · 아니면 서버 앞 10개 · 그것도 없으면 온디바이스', () => {
    const copyArb = fc.option(
      fc.record({
        caption: fc.string({ maxLength: 220 }),
        hashtags: fc.array(fc.string({ minLength: 1, maxLength: 6 }), {
          maxLength: 14,
        }),
        isFallback: fc.boolean(),
      }),
      { nil: undefined }
    );
    fc.assert(
      fc.property(
        copyArb,
        fc.option(fc.string({ maxLength: 20 }), { nil: null }),
        fc.string({ maxLength: 12 }),
        (copy, edited, onDevice) => {
          const out = resolveShareText({
            copy,
            editedHashtags: edited,
            onDeviceHashtags: onDevice,
          });
          const server = (copy?.hashtags ?? []).slice(0, 10);
          const expected =
            edited !== null
              ? edited
              : server.length > 0
                ? server.join(' ')
                : onDevice;

          expect(out.caption.length).toBeLessThanOrEqual(150);
          expect(out.caption).toBe((copy?.caption ?? '').slice(0, 150));
          expect(out.hashtagText).toBe(expected);
        }
      ),
      {
        examples: [
          [undefined, null, ''],
          [{ caption: '', hashtags: [], isFallback: true }, null, '#a'],
          [{ caption: 'x', hashtags: ['#a'], isFallback: false }, '', '#b'],
        ],
      }
    );
  });
});
