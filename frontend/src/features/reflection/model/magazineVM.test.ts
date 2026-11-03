import * as fc from 'fast-check';

import type { ReflectionStats } from '@/shared/api/index.schemas';

import type { PaletteKey } from './categoryPalette';
import {
  buildMagazineVM,
  splitHighlight,
  type MagazineInput,
  type MagazineSlot,
  type MagazineVisit,
} from './magazineVM';

/**
 * TRIP-1665 · j03 회고 매거진 VM — 서버 응답·방문·일정 재료를 "화면이 계산 없이 그대로 그릴 값"으로 바꾸는 순수 함수.
 * 초심자용: VM(뷰 모델)은 화면 전용으로 미리 계산해 둔 값 묶음이다. 화면은 이 값을 그리기만 하니, 규칙은 여기서 전부 본다.
 * 색은 hex 가 아니라 팔레트 **키**(`'맛집'` 등)로 담긴다 — 그래서 색 규칙을 이름으로 단언한다(화면에서 색을 읽지 않는다).
 *
 * 무엇을 보장하나:
 *  - AC-3 동선: 방문 순서·건너뜀 제외·이름 해석 순서(일정 슬롯 → 즉석 이름 → "N번째 장소", 지어내지 않음 BR-U5-31).
 *  - AC-4 표지 색: PLAN_B 띠 → 방문 카테고리 최빈(동률은 먼저 간 방문) → 중립.
 *  - AC-5·7 장면: 색 규칙, TEXT 제외·띠 분리, 번호 01.. 와 사진 좌우 번갈아, 모르는 layout 보존(INV-4).
 *  - AC-12 사진: 기기 사진(`photos`)에서만, 그날·그 장소일 때만.
 *  - Q5 숫자 타일 3개(방문·이동·사진), Q11 형광펜 분할, INV-3(duration 없음).
 *  - PBT: 임의 입력에 던지지 않고 불변식이 유지된다.
 */

const DATE = '2026-09-24';

const STATS: ReflectionStats = {
  visitCount: 3,
  distanceKm: 4.2,
  distanceSource: 'VISIT_LINE',
  photoCount: 2,
};

/** 입력 한 벌(방문 0·슬롯 [] — "일정은 도착했고 비어 있음") + 덮어쓰기. */
function make(over: Partial<MagazineInput> = {}): MagazineInput {
  return {
    date: DATE,
    isToday: false,
    title: '부산 첫날',
    region: '부산',
    narrative: '바다를 보며, 혼자만의 하루',
    stats: STATS,
    distanceDash: false,
    payload: undefined,
    visits: [],
    slots: [],
    spontaneousNames: {},
    photos: [],
    ...over,
  };
}

const at = (hour: number) =>
  `2026-09-24T${String(hour).padStart(2, '0')}:00:00Z`;
const visit = (
  poiId: string,
  arrivedAt?: string,
  skippedAt?: string
): MagazineVisit => ({ poiId, arrivedAt, skippedAt });
const slot = (
  poiId: string,
  nameKo?: string | null,
  category?: string | null
): MagazineSlot => ({ poiId, nameKo, category });
const photoScene = (
  poiId: string,
  caption: string,
  layout = 'PHOTO_CAPTION'
) => ({
  layout,
  caption,
  photo_slot: { visit_ref: { date: DATE, poi_id: poiId } },
});
const payloadOf = (body: object) => JSON.stringify(body);

/** 방문 순서대로 카테고리를 가진 방문·슬롯 한 벌 — 표지 색 규칙을 보는 데 쓴다. */
function dayOf(categories: (string | null)[]) {
  return {
    visits: categories.map((_, i) => visit(`p${i}`, at(i + 1))),
    slots: categories.map((category, i) => slot(`p${i}`, `장소${i}`, category)),
  };
}

describe('동선 (AC-3 · BR-U5-31)', () => {
  it('이름은 일정 슬롯 → 즉석 이름 → "N번째 장소" 순이고, 즉석에는 카테고리가 없다', () => {
    const { route } = buildMagazineVM(
      make({
        visits: [visit('a', at(1)), visit('b', at(2)), visit('c', at(3))],
        slots: [slot('a', '광안리해수욕장', '명소')],
        spontaneousNames: { b: '즉석 카페' },
      })
    );

    expect(route).toEqual([
      { order: 1, name: '광안리해수욕장', named: true, category: '명소' },
      { order: 2, name: '즉석 카페', named: true },
      { order: 3, name: '3번째 장소', named: false },
    ]);
  });

  it('도착 시각 오름차순으로 세운다 — 시각 없는 방문은 뒤로, 같은 시각은 입력 순서', () => {
    const ids = ['late', 'none', 'early', 'tie1', 'tie2'];
    const { route } = buildMagazineVM(
      make({
        visits: [
          visit('late', at(5)),
          visit('none'),
          visit('early', at(1)),
          visit('tie1', at(3)),
          visit('tie2', at(3)),
        ],
        // 이름을 슬롯 이름으로 줘서 순서를 이름으로 읽는다.
        slots: ids.map((id) => slot(id, id)),
      })
    );
    expect(route?.map((stop) => stop.name)).toEqual([
      'early',
      'tie1',
      'tie2',
      'late',
      'none',
    ]);
    expect(route?.map((stop) => stop.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('건너뛴 방문은 빠지고 순번은 1부터 이어진다', () => {
    const { route } = buildMagazineVM(
      make({
        visits: [
          visit('a', at(1)),
          visit('b', at(2), at(2)),
          visit('c', at(3)),
        ],
        slots: [slot('a', 'A'), slot('b', 'B'), slot('c', 'C')],
      })
    );
    expect(route?.map((stop) => [stop.order, stop.name])).toEqual([
      [1, 'A'],
      [2, 'C'],
    ]);
  });

  it.each([null, '', '   '])(
    '슬롯 이름이 %p 이면 다음 단계(즉석 이름 → 순번 문구)로 간다',
    (nameKo) => {
      const withSpontaneous = buildMagazineVM(
        make({
          visits: [visit('a', at(1))],
          slots: [slot('a', nameKo, '명소')],
          spontaneousNames: { a: '즉석 이름' },
        })
      ).route;
      expect(withSpontaneous?.[0]).toMatchObject({
        name: '즉석 이름',
        named: true,
      });

      const without = buildMagazineVM(
        make({ visits: [visit('a', at(1))], slots: [slot('a', nameKo)] })
      ).route;
      expect(without?.[0]).toMatchObject({ name: '1번째 장소', named: false });
    }
  );

  it('일정이 아직 안 왔으면 null(그리지 않음), 곳이 없으면 [], 일정이 비어 있으면 순번 문구', () => {
    const one = [visit('a', at(1))];
    expect(
      buildMagazineVM(make({ visits: one, slots: undefined })).route
    ).toBeNull();
    expect(
      buildMagazineVM(make({ visits: [], slots: undefined })).route
    ).toEqual([]);
    expect(
      buildMagazineVM(
        make({ visits: [visit('a', at(1), at(1))], slots: undefined })
      ).route
    ).toEqual([]);
    expect(buildMagazineVM(make({ visits: one, slots: [] })).route).toEqual([
      { order: 1, name: '1번째 장소', named: false },
    ]);
  });

  it.each(['__proto__', 'toString', 'constructor', 'hasOwnProperty'])(
    'poiId 가 %p 여도 던지지 않고 이름을 지어내지 않는다',
    (poiId) => {
      const { route } = buildMagazineVM(
        make({ visits: [visit(poiId, at(1))], slots: [], spontaneousNames: {} })
      );
      expect(route).toEqual([{ order: 1, name: '1번째 장소', named: false }]);
    }
  );
});

describe('표지 색 (AC-4 · Q2)', () => {
  const coverOf = (over: Partial<MagazineInput>) =>
    buildMagazineVM(make(over)).cover.palette;
  const planB = payloadOf({
    scenes: [
      { layout: 'EVENT', caption: '비로 실내 전환', source_event: 'PLAN_B' },
    ],
  });
  const skipped = payloadOf({
    scenes: [{ layout: 'EVENT', caption: '건너뜀', source_event: 'SKIPPED' }],
  });

  it('PLAN_B 띠가 있으면 카테고리와 무관하게 PLAN_B 다', () => {
    expect(coverOf({ ...dayOf(['맛집', '맛집']), payload: planB })).toBe(
      'PLAN_B'
    );
  });

  it('SKIPPED 띠만 있으면 카테고리 최빈으로 돌아간다', () => {
    expect(
      coverOf({ ...dayOf(['카페', '카페', '맛집']), payload: skipped })
    ).toBe('카페');
  });

  it.each<[string, (string | null)[], PaletteKey]>([
    ['최빈', ['맛집', '카페', '맛집'], '맛집'],
    ['미술과 문화는 한 통', ['미술', '문화', '맛집'], '문화'],
    ['영문 코드도 같은 통', ['FOOD', 'FOOD', 'CAFE'], '맛집'],
    ['모르는 카테고리는 세지 않는다', ['공항', '공항', '공항', '카페'], '카페'],
    ['카테고리가 하나도 없으면 중립', [null, null], 'STATS'],
    ['방문이 없으면 중립', [], 'STATS'],
  ])('%s', (_name, categories, expected) => {
    expect(coverOf(dayOf(categories))).toBe(expected);
  });

  it('동률이면 먼저 간 방문의 카테고리다 — 입력 순서를 거꾸로 줘도 도착 시각이 정한다', () => {
    expect(
      coverOf({
        visits: [visit('late', at(5)), visit('early', at(1))],
        slots: [slot('late', 'L', '맛집'), slot('early', 'E', '카페')],
      })
    ).toBe('카페');
  });

  it('건너뛴 방문과 이름 못 찾은 방문은 색에 세지 않는다', () => {
    expect(
      coverOf({
        visits: [
          visit('a', at(1)),
          visit('b', at(2), at(2)),
          visit('c', at(3), at(3)),
          visit('ghost', at(4)),
        ],
        slots: [
          slot('a', 'A', '카페'),
          slot('b', 'B', '맛집'),
          slot('c', 'C', '맛집'),
        ],
      })
    ).toBe('카페');
  });

  it('일정을 아직 모르면(동선 null) 중립이다', () => {
    expect(coverOf({ visits: [visit('a', at(1))], slots: undefined })).toBe(
      'STATS'
    );
  });
});

describe('장면 분류·색·번호 (AC-5 · AC-7 · INV-4)', () => {
  const sceneVM = (scenes: object[], over: Partial<MagazineInput> = {}) =>
    buildMagazineVM(make({ payload: payloadOf({ scenes }), ...over }));

  it('사진 장면은 그 방문의 카테고리 색, 일정에 없거나 일정을 모르면 중립이다', () => {
    const scenes = [
      photoScene('a', '맛있었다'),
      photoScene('zzz', '모르는 곳'),
    ];
    const known = sceneVM(scenes, { slots: [slot('a', 'A', '맛집')] });
    expect(known.scenes.map((s) => s.palette)).toEqual(['맛집', 'STATS']);

    const unknown = sceneVM(scenes, { slots: undefined });
    expect(unknown.scenes.map((s) => s.palette)).toEqual(['STATS', 'STATS']);
  });

  it('장소 이름은 슬롯 → 즉석 이름이고, 즉석 방문의 장면 색은 중립이다(이름을 지어내지 않는다)', () => {
    const vm = sceneVM(
      [photoScene('a', '하나'), photoScene('s', '둘'), photoScene('g', '셋')],
      { slots: [slot('a', 'A', '카페')], spontaneousNames: { s: '즉석 가게' } }
    );
    expect(vm.scenes.map((s) => s.placeName)).toEqual([
      'A',
      '즉석 가게',
      undefined,
    ]);
    expect(vm.scenes.map((s) => s.palette)).toEqual(['카페', 'STATS', 'STATS']);
  });

  it('STATS·MAP·모르는 layout 은 중립 카드로 남는다 — 캡션을 버리지 않는다', () => {
    const vm = sceneVM([
      { layout: 'STATS', caption: '3곳' },
      { layout: 'MAP', caption: '동선' },
      { layout: 'WEIRD', caption: '새 종류' },
    ]);
    expect(vm.scenes.map((s) => [s.caption, s.palette])).toEqual([
      ['3곳', 'STATS'],
      ['동선', 'STATS'],
      ['새 종류', 'STATS'],
    ]);
  });

  it('EVENT + PLAN_B/SKIPPED 는 번호 없는 띠가 된다', () => {
    const vm = sceneVM([
      { layout: 'EVENT', caption: '비로 전환', source_event: 'PLAN_B' },
      { layout: 'EVENT', caption: '건너뜀', source_event: 'SKIPPED' },
    ]);
    expect(vm.scenes).toEqual([]);
    expect(vm.planChanges).toEqual([
      { event: 'PLAN_B', caption: '비로 전환', palette: 'PLAN_B' },
      { event: 'SKIPPED', caption: '건너뜀', palette: 'SKIPPED' },
    ]);
  });

  it('EVENT 인데 출처가 없거나 모르는 값이면 띠가 아니라 중립 번호 카드다', () => {
    const vm = sceneVM([
      { layout: 'EVENT', caption: '출처 없음' },
      { layout: 'EVENT', caption: '모르는 출처', source_event: 'FOO' },
    ]);
    expect(vm.planChanges).toEqual([]);
    expect(vm.scenes.map((s) => [s.caption, s.palette])).toEqual([
      ['출처 없음', 'STATS'],
      ['모르는 출처', 'STATS'],
    ]);
  });

  it('TEXT(백엔드 규칙 카드)는 카드에서 빠지고 띠도 없다', () => {
    const vm = sceneVM([
      { layout: 'TEXT', caption: '광안리 을(를) 다녀왔어요.' },
      { layout: 'TEXT', caption: '해운대 을(를) 다녀왔어요.' },
    ]);
    expect(vm.scenes).toEqual([]);
    expect(vm.planChanges).toEqual([]);
  });

  it('번호는 01부터 두 자리로 이어지고 사진은 왼·오 번갈아 — TEXT 와 띠는 번호를 먹지 않는다', () => {
    const vm = sceneVM([
      photoScene('a', '하나'),
      { layout: 'TEXT', caption: '건너뛰기' },
      { layout: 'EVENT', caption: '띠', source_event: 'PLAN_B' },
      { layout: 'STATS', caption: '둘' },
      photoScene('b', '셋', 'PHOTO_FULL'),
      { layout: 'MAP', caption: '넷' },
    ]);
    expect(vm.scenes.map((s) => s.number)).toEqual(['01', '02', '03', '04']);
    expect(vm.scenes.map((s) => s.photoSide)).toEqual([
      'left',
      'right',
      'left',
      'right',
    ]);
    expect(vm.scenes.map((s) => s.caption)).toEqual(['하나', '둘', '셋', '넷']);
    expect(new Set(vm.scenes.map((s) => s.key)).size).toBe(4);
  });

  it('payload 가 없거나 깨져도 장면·띠는 비어 있고 던지지 않는다', () => {
    for (const payload of [undefined, 'nope', '{"scenes":7}']) {
      const vm = buildMagazineVM(make({ payload }));
      expect(vm.scenes).toEqual([]);
      expect(vm.planChanges).toEqual([]);
      expect(vm.hashtags).toEqual([]);
    }
  });
});

describe('사진은 기기 사진에서만 (AC-12)', () => {
  const photos = [{ uri: 'file://a', poiId: 'a' }];

  it('장면: 그날·그 장소 사진이 있을 때만 uri 가 생기고, 장소 카테고리를 알면 그림용으로 싣는다', () => {
    const vm = buildMagazineVM(
      make({
        payload: payloadOf({
          scenes: [
            photoScene('a', '있다'),
            photoScene('b', '기기에 없다'),
            {
              layout: 'PHOTO_FULL',
              caption: '다른 날',
              photo_slot: { visit_ref: { date: '2026-09-25', poi_id: 'a' } },
            },
          ],
        }),
        slots: [slot('a', 'A', '맛집'), slot('b', 'B', '카페')],
        photos,
      })
    );
    expect(vm.scenes[0].picture?.uri).toBe('file://a');
    expect(vm.scenes[1].picture?.uri).toBeUndefined();
    expect(vm.scenes[1].picture?.category).toBe('카페');
    expect(vm.scenes[2].picture?.uri).toBeUndefined();
  });

  it('장면: 사진 자리가 없는 카드·사진이 아닌 layout 은 사진이 없다(null)', () => {
    const vm = buildMagazineVM(
      make({
        payload: payloadOf({
          scenes: [
            { layout: 'PHOTO_CAPTION', caption: '자리 없음' },
            {
              layout: 'STATS',
              caption: '통계',
              photo_slot: { visit_ref: { date: DATE, poi_id: 'a' } },
            },
          ],
        }),
        photos,
      })
    );
    expect(vm.scenes.map((s) => s.picture)).toEqual([null, null]);
  });

  it('표지: cover.photo_slot 이 같은 날·기기 사진과 이어질 때만 uri, 슬롯이 없으면 null', () => {
    const slotted = (date: string) =>
      payloadOf({
        cover: {
          title: 't',
          subtitle: 's',
          photo_slot: { visit_ref: { date, poi_id: 'a' } },
        },
      });
    expect(
      buildMagazineVM(make({ payload: slotted(DATE), photos })).cover.picture
        ?.uri
    ).toBe('file://a');
    expect(
      buildMagazineVM(make({ payload: slotted('2026-09-25'), photos })).cover
        .picture?.uri
    ).toBeUndefined();
    expect(
      buildMagazineVM(make({ payload: slotted(DATE), photos: [] })).cover
        .picture?.uri
    ).toBeUndefined();
    expect(
      buildMagazineVM(
        make({
          payload: payloadOf({ cover: { title: 't', subtitle: 's' } }),
          photos,
        })
      ).cover.picture
    ).toBeNull();
  });
});

// TRIP-1666 D1 — 사진이 없는 **표지**는 카테고리 "그림"이 아니라 카테고리 "색"으로 선다(표지 picture 가 null → 뷰가 색 바탕만 깐다).
// 장면 카드의 그림은 그대로다(Q7). 기존 표지 단언(`?.uri`)은 손대지 않는다 — null 에도 `?.uri` 는 undefined 라 계속 맞다.
describe('D1 · 사진 없는 표지는 그림이 아니라 색 (TRIP-1666 AC-1·AC-2)', () => {
  const slotted = (date: string, poiId: string) =>
    payloadOf({
      cover: {
        title: 't',
        subtitle: 's',
        photo_slot: { visit_ref: { date, poi_id: poiId } },
      },
      scenes: [photoScene('a', '장면 카드')],
    });
  const slots = [slot('a', 'A', '맛집')];

  it('AC-1: 표지 사진 자리는 있는데 이 기기 사진이 없으면(없음·다른 날·다른 장소) cover.picture 는 null — 카테고리를 알아도 그림 객체를 만들지 않는다', () => {
    for (const photos of [[], [{ uri: 'file://other', poiId: 'zzz' }]]) {
      expect(
        buildMagazineVM(make({ payload: slotted(DATE, 'a'), slots, photos }))
          .cover.picture
      ).toBeNull();
    }
    expect(
      buildMagazineVM(
        make({
          payload: slotted('2026-09-25', 'a'),
          slots,
          photos: [{ uri: 'file://a', poiId: 'a' }],
        })
      ).cover.picture
    ).toBeNull();
  });

  it('AC-1 긍정 짝: 같은 날·같은 장소 기기 사진이 있으면 uri 가 있는 사진 객체다', () => {
    const vm = buildMagazineVM(
      make({
        payload: slotted(DATE, 'a'),
        slots,
        photos: [{ uri: 'file://a', poiId: 'a' }],
      })
    );
    expect(vm.cover.picture).toMatchObject({ uri: 'file://a' });
  });

  it('AC-2(선제 green — D1 이 장면까지 지우지 않게 지금 동작을 굳힌다): 같은 입력에서 장면 카드는 사진이 없어도 카테고리 그림용 객체를 그대로 가진다(D1 은 표지만 바꾼다)', () => {
    const vm = buildMagazineVM(
      make({ payload: slotted(DATE, 'a'), slots, photos: [] })
    );
    expect(vm.scenes[0].picture).toEqual({ poiId: 'a', category: '맛집' });
  });

  it('AC-3: 표지 색 키 규칙은 그대로다 — 사진이 없어도 방문 카테고리 최빈이 표지 색이 된다', () => {
    expect(
      buildMagazineVM(
        make({
          payload: slotted(DATE, 'a'),
          ...dayOf(['카페', '카페', '맛집']),
          photos: [],
        })
      ).cover.palette
    ).toBe('카페');
  });
});

describe('숫자 타일 (Q5 · BR-U5-43 · INV-3)', () => {
  const tiles = (over: Partial<MagazineInput>) =>
    buildMagazineVM(make(over)).stats;

  it('방문·이동·사진 3개가 이 순서로, 값은 기존 통계 행과 같은 식이다', () => {
    expect(tiles({})).toMatchObject([
      { key: 'visits', label: '방문', value: '3' },
      { key: 'distance', label: '이동', value: '4.2km', note: '근사' },
      { key: 'photos', label: '사진', value: '2' },
    ]);
  });

  it('거리 출처가 ROUTE 면 "경로", 직선 합이면 "근사"', () => {
    const stats = (distanceSource: ReflectionStats['distanceSource']) =>
      tiles({ stats: { ...STATS, distanceSource } })[1].note;
    expect(stats('ROUTE')).toBe('경로');
    expect(stats('VISIT_LINE')).toBe('근사');
  });

  it('방문이 적어 거리를 못 재면 값은 "—"이고 출처 라벨이 없다', () => {
    const distance = tiles({ distanceDash: true })[1];
    expect(distance.value).toBe('—');
    expect(distance.note).toBeUndefined();
  });

  it('0곳·0장도 0 으로 채워진다', () => {
    const zero = tiles({
      stats: { ...STATS, visitCount: 0, photoCount: 0, distanceKm: 0 },
      distanceDash: true,
    });
    expect(zero.map((tile) => tile.value)).toEqual(['0', '—', '0']);
  });
});

describe('표지·인용문·해시태그', () => {
  it('인용문은 표시본 그대로이고(다시 고르지 않음) 비어 있어도 던지지 않는다', () => {
    expect(buildMagazineVM(make({ narrative: '하루' })).quote.text).toBe(
      '하루'
    );
    expect(buildMagazineVM(make({ narrative: '' })).quote).toEqual({
      text: '',
      head: '',
      mark: '',
    });
  });

  it('표지 문구: 스티커는 오늘이면 "오늘의 회고", 아니면 "하루 회고". 제목·지역은 그대로', () => {
    const today = buildMagazineVM(make({ isToday: true })).cover;
    const other = buildMagazineVM(
      make({ isToday: false, region: undefined })
    ).cover;
    expect(today.stickerLabel).toBe('오늘의 회고');
    expect(other.stickerLabel).toBe('하루 회고');
    expect(today.title).toBe('부산 첫날');
    expect(today.region).toBe('부산');
    expect(other.region).toBeUndefined();
  });

  it('방문·사진 라벨에 통계 숫자가 들어가고 날짜 라벨이 있으며 소요시간 말이 없다(INV-3)', () => {
    const { dateLabel, visitLabel, photoLabel } = buildMagazineVM(make()).cover;
    expect(visitLabel).toContain('3');
    expect(photoLabel).toContain('2');
    expect(dateLabel.trim()).not.toBe('');
    for (const label of [dateLabel, visitLabel, photoLabel]) {
      expect(label).not.toMatch(/소요|분|시간/);
    }
  });

  it('해시태그는 payload 를 다듬은 값이고 없으면 빈 배열이다', () => {
    const tags = buildMagazineVM(
      make({ payload: payloadOf({ hashtags: [' #부산 ', '맛집', '부산'] }) })
    ).hashtags;
    expect(tags).toEqual(['부산', '맛집']);
  });

  it('VM 어디에도 duration 키가 없다(INV-3)', () => {
    const vm = buildMagazineVM(
      make({
        payload: payloadOf({ scenes: [photoScene('a', '캡션')] }),
        visits: [visit('a', at(1))],
        slots: [slot('a', 'A', '맛집')],
      })
    );
    expect(JSON.stringify(vm)).not.toMatch(/duration/i);
  });
});

describe('splitHighlight — 형광펜 구간 (AC-6 · Q11)', () => {
  it.each([
    ['혼자만의 하루', '', '혼자만의 하루'],
    ['바다를 보며, 혼자만의 하루', '바다를 보며, ', '혼자만의 하루'],
    ['a, b, c', 'a, b, ', 'c'],
    ['끝,', '', '끝,'],
    ['끝,  ', '', '끝,  '],
    ['', '', ''],
  ])('%p → head %p · mark %p', (text, head, mark) => {
    expect(splitHighlight(text)).toEqual({ head, mark });
  });
});

describe('성질 (PBT)', () => {
  const POIS = [
    'p1',
    'p2',
    'p3',
    'p4',
    'p5',
    '__proto__',
    'toString',
    'constructor',
  ];
  const PALETTE_KEYS: PaletteKey[] = [
    '명소',
    '맛집',
    '카페',
    '야경',
    '자연',
    '쇼핑',
    '문화',
    '액티비티',
    'PLAN_B',
    'SKIPPED',
    'STATS',
  ];
  const iso = fc
    .date({
      min: new Date('2026-09-24T00:00:00Z'),
      max: new Date('2026-09-24T23:59:59Z'),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString());
  const nameArb = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.stringMatching(/^[가-힣A-Za-z0-9]{1,6}$/)
  );
  const categoryArb = fc.option(
    fc.constantFrom(
      '명소',
      '맛집',
      '카페',
      '미술',
      '술집',
      'FOOD',
      'CAFE',
      '공항',
      '',
      'toString'
    ),
    { nil: null }
  );
  const sceneArb = fc.record({
    layout: fc.constantFrom(
      'PHOTO_FULL',
      'PHOTO_CAPTION',
      'STATS',
      'MAP',
      'EVENT',
      'TEXT',
      'WEIRD'
    ),
    caption: fc.string(),
    photo_slot: fc.option(
      fc.record({
        visit_ref: fc.record({
          date: fc.constantFrom(DATE, '2026-01-01'),
          poi_id: fc.constantFrom(...POIS),
        }),
      }),
      { nil: null }
    ),
    source_event: fc.option(fc.constantFrom('PLAN_B', 'SKIPPED', 'FOO'), {
      nil: null,
    }),
  });
  const payloadArb = fc.oneof(
    fc.constant(undefined),
    fc.string(),
    fc
      .record({
        scenes: fc.array(sceneArb, { maxLength: 8 }),
        hashtags: fc.array(fc.string()),
      })
      .map((body) => JSON.stringify(body))
  );
  const visitsArb = fc.uniqueArray(
    fc.record({
      poiId: fc.constantFrom(...POIS),
      arrivedAt: fc.option(iso, { nil: undefined }),
      skippedAt: fc.option(iso, { nil: undefined }),
    }),
    { selector: (v) => v.poiId, maxLength: 6 }
  );
  const slotsArb = fc.option(
    fc.uniqueArray(
      fc.record({
        poiId: fc.constantFrom(...POIS),
        nameKo: fc.option(nameArb, { nil: null }),
        category: categoryArb,
      }),
      { selector: (s) => s.poiId, maxLength: 6 }
    ),
    { nil: undefined }
  );
  const namesArb = fc
    .array(fc.tuple(fc.constantFrom(...POIS), nameArb), { maxLength: 4 })
    .map((entries) => Object.fromEntries(entries));
  const inputArb = fc.record({
    isToday: fc.boolean(),
    narrative: fc.string(),
    payload: payloadArb,
    visits: visitsArb,
    slots: slotsArb,
    spontaneousNames: namesArb,
    photos: fc.array(
      fc.record({
        uri: fc.constant('file://x'),
        poiId: fc.constantFrom(...POIS),
      }),
      { maxLength: 4 }
    ),
    distanceDash: fc.boolean(),
  });

  it('임의 입력에 던지지 않고, 번호·좌우·인용문·팔레트·타일 불변식이 유지된다', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const vm = buildMagazineVM(make(input));

        vm.scenes.forEach((scene, i) => {
          expect(scene.number).toBe(String(i + 1).padStart(2, '0'));
          expect(scene.photoSide).toBe(i % 2 === 0 ? 'left' : 'right');
          expect(PALETTE_KEYS).toContain(scene.palette);
        });
        expect(new Set(vm.scenes.map((s) => s.key)).size).toBe(
          vm.scenes.length
        );
        expect(vm.quote.head + vm.quote.mark).toBe(vm.quote.text);
        expect(vm.quote.text).toBe(input.narrative);
        expect(PALETTE_KEYS).toContain(vm.cover.palette);
        for (const change of vm.planChanges) {
          expect(['PLAN_B', 'SKIPPED']).toContain(change.event);
        }
        expect(vm.stats.map((tile) => tile.key)).toEqual([
          'visits',
          'distance',
          'photos',
        ]);
      }),
      { numRuns: 300 }
    );
  });

  it('동선 순서 불변식 — 건너뜀 제외·도착 시각 오름차순(없으면 뒤, 같으면 입력 순서)·순번 1..k·이름 해석', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const vm = buildMagazineVM(make(input));
        const kept = input.visits
          .map((v, index) => ({ v, index }))
          .filter(({ v }) => !v.skippedAt)
          .sort((a, b) => {
            const x = a.v.arrivedAt;
            const y = b.v.arrivedAt;
            if (x && y && x !== y) return x < y ? -1 : 1;
            if (x && !y) return -1;
            if (!x && y) return 1;
            return a.index - b.index;
          });

        if (kept.length === 0) {
          expect(vm.route).toEqual([]);
          return;
        }
        if (input.slots === undefined) {
          expect(vm.route).toBeNull();
          return;
        }
        const route = vm.route ?? [];
        expect(route.map((stop) => stop.order)).toEqual(
          kept.map((_, i) => i + 1)
        );

        // 이름 오라클 — 슬롯(비지 않음) → 즉석(own 속성·비지 않음) → 순번 문구.
        route.forEach((stop, i) => {
          const { poiId } = kept[i].v;
          const fromSlot = input.slots?.find(
            (s) => s.poiId === poiId && s.nameKo && s.nameKo.trim() !== ''
          )?.nameKo;
          const own = Object.prototype.hasOwnProperty.call(
            input.spontaneousNames,
            poiId
          )
            ? input.spontaneousNames[poiId]
            : undefined;
          const spontaneous = own && own.trim() !== '' ? own : undefined;
          const expected = fromSlot ?? spontaneous;
          expect(stop.name).toBe(expected ?? `${i + 1}번째 장소`);
          expect(stop.named).toBe(expected !== undefined);
        });
      }),
      { numRuns: 300 }
    );
  });

  it('splitHighlight — 임의 문자열에서 head+mark 가 원문이고, 쉼표 뒤 구가 있으면 mark 는 공백으로 시작하지 않는 마지막 구다', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const { head, mark } = splitHighlight(text);
        expect(head + mark).toBe(text);
        const comma = text.lastIndexOf(',');
        const tail = comma < 0 ? '' : text.slice(comma + 1).replace(/^\s+/, '');
        if (tail === '') {
          expect(head).toBe('');
          expect(mark).toBe(text);
        } else {
          expect(mark).toBe(tail);
        }
      }),
      { numRuns: 400 }
    );
  });
});
