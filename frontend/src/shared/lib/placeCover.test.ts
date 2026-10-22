import fc from 'fast-check';

import {
  COVER,
  COVER_SLUGS,
  FALLBACK_COVER,
  SLUG_OF,
  UUID_V1,
  UUID_V2,
  UUID_V3,
  VARIANT_OF,
} from '@/test-support/placeCoverFixtures';

import { fnv1a32, placeCoverSource } from './placeCover';

/**
 * 장소 카테고리 생성 이미지 선택 — 순수 함수 `placeCoverSource(category, poiId)` (사이클 20261022-place-category-covers,
 * 01b 「설계 제약」). 사진이 없는 장소 칸에 "카테고리 10종 × 가로 3변형" 중 어느 번들 그림을 줄지 정한다.
 *
 * 무엇을 보장하나:
 *  - 한글 카테고리 10종 × 변형 3 = 30장이 전부 서로 다른 그림이고, 카테고리마다 자기 slug 의 그림만 준다
 *    (맛집 칸에 술집 그림이 나오는 오배선 차단).
 *  - 변형은 `FNV-1a(poiId) % 3 + 1` 이다. 같은 poiId 는 어느 화면·어느 실행에서나 같은 그림이다(목록 → 상세 일관).
 *    해시 값 자체를 상수로 박아 둔다 — 알고리즘이 조용히 바뀌면 앱 업데이트 뒤 이미 본 장소의 그림이 바뀐다.
 *  - poiId 가 없거나 빈 문자열이면 해시하지 않고 변형 1 이다.
 *  - 카테고리가 모르는 값·null·영문 코드·`Object.prototype` 상속 이름이면 중립 폴백 `place.webp` 이다.
 *
 * 기대값은 `@/test-support/placeCoverFixtures` 의 손으로 적은 표(COVER·SLUG_OF·VARIANT_OF)에서 온다 — 구현의 맵으로
 * 기대값을 만들지 않는다(동어반복 방지).
 *
 * 3동작 뼈대: 준비=카테고리·poiId → 실행=`placeCoverSource(…)` → 단언=기대 표의 그림과 같은 객체(`toBe`).
 * (개념) `toBe` = 같은 객체인지(참조 동일성). jest-expo 의 `require('x.webp')` 는 모듈 캐시 덕에 같은 파일이면 항상 같은
 * 객체를 돌려주므로 "같은 파일을 골랐는가" 를 가른다.
 */

const CATEGORIES = Object.keys(SLUG_OF);
const VARIANT_IDS = [
  { poiId: UUID_V1, variant: 1 },
  { poiId: UUID_V2, variant: 2 },
  { poiId: UUID_V3, variant: 3 },
] as const;

describe('placeCoverSource · 카테고리 → 그림 매핑 (AC-P4·P5)', () => {
  it.each(
    CATEGORIES.flatMap((category) =>
      VARIANT_IDS.map(({ poiId, variant }) => ({ category, poiId, variant }))
    )
  )('$category + 변형 $variant → 자기 slug 의 $variant 번 그림', (c) => {
    const slug = SLUG_OF[c.category];

    expect(placeCoverSource(c.category, c.poiId)).toBe(COVER[slug][c.variant]);
  });

  it('30장(10종 × 3변형)이 전부 서로 다르고 폴백과도 다르다', () => {
    const picked = CATEGORIES.flatMap((category) =>
      VARIANT_IDS.map(({ poiId }) => placeCoverSource(category, poiId))
    );

    expect(picked).toHaveLength(30);
    expect(new Set(picked).size).toBe(30);
    expect(picked).not.toContain(FALLBACK_COVER);
    // 앵커 — 기대 표 쪽도 30장이 서로 다르다(표가 망가졌다면 위 단언이 의미 없다).
    const table = COVER_SLUGS.flatMap((slug) => [
      COVER[slug][1],
      COVER[slug][2],
      COVER[slug][3],
    ]);
    expect(new Set(table).size).toBe(30);
  });

  it('카테고리가 다르면 같은 poiId 라도 다른 그림이다 (맛집 ≠ 술집)', () => {
    expect(placeCoverSource('맛집', UUID_V2)).not.toBe(
      placeCoverSource('술집', UUID_V2)
    );
  });
});

describe('placeCoverSource · 변형 고르기 FNV-1a (AC-P1·P9·P10)', () => {
  it('해시 값 자체를 상수로 못 박는다 — 빈 문자열·"a"·UUID (알고리즘이 바뀌면 이미 본 그림이 바뀐다)', () => {
    // 값은 알고리즘(FNV-1a 32비트: 오프셋 0x811c9dc5, 소수 0x01000193, 글자 XOR 후 곱셈)을 node 로 독립 계산한 것이다.
    // 'a' 의 0xe40c292c 는 공개된 FNV-1a 32 표준 값과 같다. 'a' 는 2^31 을 넘어, 루프 안 `>>> 0` 과 마지막 `return hash >>> 0` 이 둘 다 빠지면 음수가 된다.
    // (둘은 서로 중복이라 한쪽만 지우면 값이 같다 — 마지막 것만 지우는 변이는 이 단언도 못 잡는 동치 변이다.)
    expect(fnv1a32('')).toBe(2166136261);
    expect(fnv1a32('a')).toBe(3826002220);
    expect(fnv1a32(UUID_V1)).toBe(2292069672);
    expect(fnv1a32(UUID_V2)).toBe(4043892016);
    expect(fnv1a32(UUID_V3)).toBe(3491767295);
    expect(fnv1a32('current')).toBe(3647323098);
  });

  it('손으로 박은 poiId → 변형 표가 구현의 해시와 일치한다 (표가 고르는 그림의 근거)', () => {
    for (const [poiId, variant] of Object.entries(VARIANT_OF)) {
      expect({ poiId, variant: (fnv1a32(poiId) % 3) + 1 }).toEqual({
        poiId,
        variant,
      });
    }
  });

  it('실제로 그림이 변형 번호를 따른다 — 표의 poiId 전부에서 기대 그림과 같다', () => {
    for (const poiId of Object.keys(VARIANT_OF)) {
      const variant = VARIANT_OF[poiId];

      expect(placeCoverSource('맛집', poiId)).toBe(COVER.food[variant]);
    }
  });

  it.each([undefined, null, ''])(
    'poiId 가 %p 이면 해시하지 않고 변형 1 이다 (빈 문자열을 해시하면 변형 2 가 나온다)',
    (poiId) => {
      expect(placeCoverSource('맛집', poiId)).toBe(COVER.food[1]);
      expect(placeCoverSource('술집', poiId)).toBe(COVER.bar[1]);
      // 앵커 — 빈 문자열의 FNV-1a 는 2166136261 → %3 = 1 → 변형 2. 그래서 "변형 1" 은 해시 결과가 아니라 규칙이다.
      expect((fnv1a32('') % 3) + 1).toBe(2);
    }
  );

  it('같은 입력은 몇 번을 불러도 같은 그림이다 (결정성)', () => {
    const first = placeCoverSource('야경', UUID_V3);

    expect(placeCoverSource('야경', UUID_V3)).toBe(first);
    expect(placeCoverSource('야경', UUID_V3)).toBe(COVER.night_view[3]);
  });

  it('poiId 가 "__proto__"·"constructor" 같은 이름이어도 그냥 문자열로 해시한다', () => {
    expect(placeCoverSource('맛집', '__proto__')).toBe(COVER.food[3]);
    expect(placeCoverSource('맛집', 'constructor')).toBe(COVER.food[1]);
  });
});

describe('placeCoverSource · 폴백 (AC-P7·P8)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['빈 문자열', ''],
    ['모르는 한글', '숙소'],
    ['영문 코드 FOOD', 'FOOD'],
    ['영문 코드 소문자 food', 'food'],
    ['영문 코드 NIGHT_VIEW', 'NIGHT_VIEW'],
    ['영문 코드 SIGHT', 'SIGHT'],
  ])(
    '카테고리가 %s 이면 중립 폴백 place.webp 이다 (한글만 받는다)',
    (_, category) => {
      expect(placeCoverSource(category, UUID_V2)).toBe(FALLBACK_COVER);
      // poiId 가 없어도 같다 — 폴백은 변형이 없다.
      expect(placeCoverSource(category, undefined)).toBe(FALLBACK_COVER);
    }
  );

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'isPrototypeOf',
    '__defineGetter__',
  ])(
    '카테고리가 객체 상속 이름 "%s" 이면 함수·undefined 가 아니라 폴백을 돌려준다 (프로토타입 키 함정)',
    (category) => {
      const result = placeCoverSource(category, UUID_V2);

      expect(result).toBe(FALLBACK_COVER);
      expect(typeof result).not.toBe('function');
      expect(result).toBeDefined();
    }
  );

  it('앵커 — 폴백 파일은 30장 어느 것과도 다르다', () => {
    const table = COVER_SLUGS.flatMap((slug) => [
      COVER[slug][1],
      COVER[slug][2],
      COVER[slug][3],
    ]);

    expect(table).not.toContain(FALLBACK_COVER);
  });
});

/**
 * 성질 기반 테스트(PBT) — 무작위 입력 수백 개로 규칙이 항상 성립하는지 본다. (개념) `examples` = 무작위에 맡기지 않고
 * 반드시 한 번은 넣는 입력. "세 변형이 모두 나오는가" 는 확률에 맡기지 않고 실 UUID 3개를 박는다(README PBT 규칙).
 */
describe('placeCoverSource · 성질 (PBT)', () => {
  const categoryArb = fc.constantFrom(...CATEGORIES);

  it('임의의 poiId 에서 항상 그 카테고리 slug 의 3장 중 하나이고 같은 입력은 같은 그림이다', () => {
    fc.assert(
      fc.property(
        categoryArb,
        fc.oneof(fc.uuid(), fc.string({ maxLength: 40 })),
        (category, poiId) => {
          const slug = SLUG_OF[category];
          const allowed = [COVER[slug][1], COVER[slug][2], COVER[slug][3]];

          const first = placeCoverSource(category, poiId);

          expect(allowed).toContain(first);
          expect(placeCoverSource(category, poiId)).toBe(first);
        }
      ),
      {
        examples: [
          ['맛집', UUID_V1],
          ['맛집', UUID_V2],
          ['맛집', UUID_V3],
        ],
      }
    );
  });

  it('한글 10종 밖의 임의 문자열 카테고리는 항상 폴백이다', () => {
    fc.assert(
      fc.property(
        fc
          .string({ maxLength: 20 })
          .filter((text) => !CATEGORIES.includes(text)),
        fc.uuid(),
        (category, poiId) => {
          expect(placeCoverSource(category, poiId)).toBe(FALLBACK_COVER);
        }
      ),
      {
        examples: [
          ['constructor', UUID_V1],
          ['__proto__', UUID_V1],
          ['FOOD', UUID_V2],
        ],
      }
    );
  });

  it('fnv1a32 는 임의 문자열에서 항상 0 이상 2^32 미만의 정수다 (>>> 0 보정)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        const hash = fnv1a32(text);

        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThan(2 ** 32);
      }),
      { examples: [['a'], ['current'], [UUID_V1]] }
    );
  });

  it('UUID 모양 poiId 3000개를 뽑으면 세 변형이 거의 고르게 나온다 (고정 시드 — 29%~38%)', () => {
    // 준비 — 확률이 아니라 고정 시드 난수열(mulberry32)로 UUID v4 모양 문자열 3000개를 만든다.
    let seed = 20261022;
    const next = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const hex = (length: number): string =>
      Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join(
        ''
      );
    const sample = Array.from(
      { length: 3000 },
      () =>
        `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(next() * 4)]}${hex(3)}-${hex(12)}`
    );

    // 실행
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const poiId of sample) {
      const picked = placeCoverSource('명소', poiId);
      const variant = ([1, 2, 3] as const).find(
        (candidate) => COVER.sight[candidate] === picked
      );
      expect(variant).toBeDefined();
      counts[variant as 1 | 2 | 3] += 1;
    }

    // 단언 — 세 변형이 모두 나오고(공허 방지) 각각 전체의 29%~38%.
    for (const variant of [1, 2, 3] as const) {
      expect(counts[variant]).toBeGreaterThan(3000 * 0.29);
      expect(counts[variant]).toBeLessThan(3000 * 0.38);
    }
  });
});
