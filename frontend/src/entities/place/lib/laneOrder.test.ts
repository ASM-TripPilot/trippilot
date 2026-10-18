import fc from 'fast-check';

import type { Place } from '@/entities/place/model';

import { orderLanePlaces } from './laneOrder';

/**
 * TRIP-1432 · 홈·탐색 장소 레인 순서 — 사진 있는 곳을 먼저, 그 안에서 지역(시도 코드 앞 2자리)을 번갈아.
 * 라운드는 그 그룹에서 지역이 처음 나타난 순서이고, 지역 안은 입력 순서를 지킨다.
 * 사진 있음 = `imageUrl` truthy(카드가 사진을 그리는 조건과 같다). 코드가 없으면 "코드 없음" 한 지역.
 */

function place(
  poiId: string,
  regionCode: string | null | undefined,
  imageUrl: string | null | undefined
): Place {
  return {
    poiId,
    nameKo: poiId,
    category: '명소',
    lat: 35.1,
    lng: 129.0,
    region: null,
    regionCode,
    openingHours: null,
    imageUrl,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

const PHOTO = 'https://img.example/p.jpg';
const ids = (places: readonly Place[]): string[] => places.map((p) => p.poiId);
const hasPhoto = (p: Place): boolean => Boolean(p.imageUrl);
const regionKey = (p: Place): string => p.regionCode?.slice(0, 2) ?? '';

describe('orderLanePlaces — 예시', () => {
  it('LO-E1 · 전부 사진이면 지역을 번갈아 뽑고, 한 지역만 남으면 이어서 낸다', () => {
    const input = [
      place('s1', '11110', PHOTO),
      place('s2', '11140', PHOTO),
      place('s3', '11680', PHOTO),
      place('b1', '26350', PHOTO),
      place('j1', '50110', PHOTO),
    ];

    expect(ids(orderLanePlaces(input))).toEqual(['s1', 'b1', 'j1', 's2', 's3']);
  });

  it('LO-E2 · 사진 있는 곳이 모두 앞이고, 두 그룹 안에서 각각 번갈아 뽑는다', () => {
    const input = [
      place('s1', '11110', null),
      place('s2', '11140', PHOTO),
      place('b1', '26350', null),
      place('j1', '50110', PHOTO),
    ];

    expect(ids(orderLanePlaces(input))).toEqual(['s2', 'j1', 's1', 'b1']);
  });

  it('LO-E3 · 라운드는 서울 고정이 아니라 그 그룹에서 먼저 나타난 지역부터다', () => {
    const input = [
      place('b1', '26350', PHOTO),
      place('s1', '11110', PHOTO),
      place('b2', '26110', PHOTO),
      place('s2', '11140', PHOTO),
    ];

    expect(ids(orderLanePlaces(input))).toEqual(['b1', 's1', 'b2', 's2']);
  });

  it('LO-E4 · 코드 없는 장소(null·undefined)는 "코드 없음" 한 지역으로 번갈아 든다', () => {
    const input = [
      place('x', null, PHOTO),
      place('s1', '11', PHOTO),
      place('y', undefined, PHOTO),
    ];

    expect(ids(orderLanePlaces(input))).toEqual(['x', 's1', 'y']);
  });

  it('LO-E5 · 빈 문자열 imageUrl 은 사진 없음이다', () => {
    const input = [place('a', '11110', ''), place('b', '11140', PHOTO)];

    expect(ids(orderLanePlaces(input))).toEqual(['b', 'a']);
  });

  it('LO-E6 · 5자리·2자리 코드라도 앞 2자리가 같으면 같은 지역이다', () => {
    const input = [
      place('s', '11680', PHOTO),
      place('s2', '11', PHOTO),
      place('b', '26350', PHOTO),
    ];

    expect(ids(orderLanePlaces(input))).toEqual(['s', 'b', 's2']);
  });

  it('LO-E7 · 빈 목록은 빈 목록이다', () => {
    expect(orderLanePlaces([])).toEqual([]);
  });
});

// ── 속성(PBT) ──────────────────────────────────────────────────────────────
// 코드·사진 값을 좁혀 같은 지역·같은 그룹이 자주 겹치게 한다(넓히면 ⓒ·ⓓ 가 공허하게 통과한다).
type Spec = {
  code: string | null | undefined;
  image: string | null | undefined;
};

const specArb: fc.Arbitrary<Spec> = fc.record({
  code: fc.constantFrom(
    '11',
    '11680',
    '26',
    '26350',
    '50',
    '50110',
    null,
    undefined,
    ''
  ),
  image: fc.constantFrom(null, undefined, '', PHOTO),
});
const specsArb = fc.array(specArb, { maxLength: 24 });

const toPlaces = (specs: readonly Spec[]): Place[] =>
  specs.map((s, i) => place(`p${i}`, s.code, s.image));

// 생성기 적중을 운에 맡기지 않는다 — 같은 지역 연속·사진 섞임·코드 없음·빈 문자열 사진.
const EXAMPLES: [Spec[]][] = [
  [
    [
      { code: '11', image: PHOTO },
      { code: '11680', image: PHOTO },
      { code: '11', image: PHOTO },
    ],
  ],
  [
    [
      { code: '11', image: PHOTO },
      { code: '11', image: PHOTO },
      { code: '26', image: PHOTO },
      { code: '11', image: PHOTO },
    ],
  ],
  [
    [
      { code: null, image: '' },
      { code: '50', image: PHOTO },
      { code: undefined, image: null },
      { code: '26350', image: PHOTO },
      { code: '', image: PHOTO },
    ],
  ],
];

describe('orderLanePlaces — 속성', () => {
  it('LO-Pⓐ · 출력은 입력의 순열이다(같은 객체, 빠짐·중복 없음)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const input = toPlaces(specs);
        const out = orderLanePlaces(input);

        expect(out).toHaveLength(input.length);
        expect(new Set(out).size).toBe(out.length);
        for (const p of out) expect(input).toContain(p);
      }),
      { examples: EXAMPLES }
    );
  });

  it('LO-Pⓑ · 사진 있는 장소는 모두 사진 없는 장소보다 앞이다', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const out = orderLanePlaces(toPlaces(specs));
        const lastPhoto = out.map(hasPhoto).lastIndexOf(true);
        const firstNoPhoto = out.map(hasPhoto).indexOf(false);

        if (lastPhoto !== -1 && firstNoPhoto !== -1) {
          expect(lastPhoto).toBeLessThan(firstNoPhoto);
        }
      }),
      { examples: EXAMPLES }
    );
  });

  it('LO-Pⓒ · 같은 그룹 안에서 같은 지역이 연달아 나오면, 그 뒤 그 그룹엔 그 지역만 남아 있다', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const out = orderLanePlaces(toPlaces(specs));
        for (const photo of [true, false]) {
          const group = out.filter((p) => hasPhoto(p) === photo);
          for (let i = 0; i + 1 < group.length; i += 1) {
            if (regionKey(group[i]) !== regionKey(group[i + 1])) continue;
            const rest = group.slice(i).map(regionKey);
            expect(new Set(rest)).toEqual(new Set([regionKey(group[i])]));
          }
        }
      }),
      { examples: EXAMPLES }
    );
  });

  it('LO-Pⓓ · (사진 여부, 지역) 묶음 안의 상대 순서는 입력 그대로다', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const input = toPlaces(specs);
        const out = orderLanePlaces(input);
        const bucket = (p: Place): string => `${hasPhoto(p)}|${regionKey(p)}`;
        for (const key of new Set(input.map(bucket))) {
          expect(ids(out.filter((p) => bucket(p) === key))).toEqual(
            ids(input.filter((p) => bucket(p) === key))
          );
        }
      }),
      { examples: EXAMPLES }
    );
  });

  it('LO-Pⓔ · 입력 배열을 바꾸지 않는다(얼린 배열도 던지지 않는다)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const input = Object.freeze(toPlaces(specs));
        const before = ids(input);

        expect(() => orderLanePlaces(input)).not.toThrow();
        expect(ids(input)).toEqual(before);
      }),
      { examples: EXAMPLES }
    );
  });
});
