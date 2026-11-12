import fc from 'fast-check';

import coverNames from '../../../../assets/region-covers/index.json';
import { REGION_COVERS } from '../config/regionCovers';
import type { TripDestination } from '../model';

import {
  coverChoices,
  coverSourceForKey,
  pickRegionCover,
  tripCoverLabel,
  tripCoverSource,
} from './regionCover';

/**
 * 지역 커버 — 키 → 그림 변환(`coverSourceForKey`)·고를 수 있는 목록(`coverChoices`)·여행 → 표시 그림(`tripCoverSource`).
 * TRIP-1788 이 커버를 "사용자가 고른 키"로 넓히면서, 키·그림 표를 읽는 곳을 이 파일 하나(함수 둘)로 좁혔다 —
 * 나중에 그림을 서버/CDN 으로 옮기면 두 함수만 바꾸면 된다.
 *
 * 새 개념 한 줄 — **프로토타입 키**: 자바스크립트 객체에 `obj['constructor']` 를 물으면 "없음"이 아니라 `Object` 함수가
 * 돌아온다. 서버는 키 모양(영문·숫자·`_`·`-`)만 검사하니 `constructor` 도 통과하므로, 표를 읽을 때 "내 칸인지"를 확인해야 한다.
 *
 * 그림 비교는 `coverSourceForKey`/`REGION_COVERS` 로 만든다 — jest 에서 번들 이미지 `require` 는 `{testUri: 요청 파일 기준 경로}`
 * 객체라 이 테스트 파일에서 직접 `require` 하면 같은 그림도 경로가 달라진다(02a ★2).
 */

const dest = (seq: number, regionCode?: string | null) => ({ seq, regionCode });

describe('coverSourceForKey — 키 → 그림(내 칸만)', () => {
  it('알려진 키는 매번 같은 그림을 준다(같은 객체 참조)', () => {
    expect(coverSourceForKey('26350')).toBe(REGION_COVERS['26350']);
    expect(coverSourceForKey('26350')).toBe(coverSourceForKey('26350'));
    expect(coverSourceForKey('11')).toBe(REGION_COVERS['11']);
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'zz'])(
    '모르는 키(%j)·객체 기본 속성 이름은 null — 함수나 undefined 가 새지 않는다',
    (key) => {
      expect(coverSourceForKey(key)).toBeNull();
    }
  );
});

describe('coverChoices — 고를 수 있는 키·라벨', () => {
  it('키 집합은 그림 표와 이름표(index.json)가 같고, 라벨은 이름표 그대로이며, 키마다 그림이 있다', () => {
    const choices = coverChoices();
    const keys = choices.map((choice) => choice.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(REGION_COVERS).sort());
    expect([...keys].sort()).toEqual(Object.keys(coverNames.covers).sort());
    for (const { key, label } of choices) {
      expect(label).toBe((coverNames.covers as Record<string, string>)[key]);
      expect(label.length).toBeGreaterThan(0);
      expect(coverSourceForKey(key)).not.toBeNull();
    }
  });
});

describe('tripCoverSource — 고른 키 → 첫 목적지 자동 → null', () => {
  it('알려진 coverKey 면 첫 목적지가 다른 지역이어도 고른 그림이다', () => {
    const result = tripCoverSource({
      coverKey: '11110',
      destinations: [dest(1, '26350')],
    });

    expect(result).toBe(coverSourceForKey('11110'));
    expect(result).not.toBe(coverSourceForKey('26350'));
  });

  it.each<[string, string | null | undefined]>([
    ['null(자동)', null],
    ['undefined(옛 서버)', undefined],
    ['빈 문자열', ''],
    ['앱이 모르는 키', 'zz9'],
    ['객체 기본 속성 이름', 'constructor'],
  ])(
    'coverKey 가 %s 면 첫 목적지(시군구)의 그림으로 내려간다',
    (_label, key) => {
      expect(
        tripCoverSource({ coverKey: key, destinations: [dest(1, '26350')] })
      ).toBe(coverSourceForKey('26350'));
    }
  );

  it.each([
    ['강릉', '51150'],
    ['경주', '47130'],
    ['통영', '48220'],
  ])('%s(강원·경상) 여행은 그 시군 그림이 자동 커버다', (_name, code) => {
    expect(coverSourceForKey(code)).not.toBeNull();
    expect(tripCoverSource({ destinations: [dest(1, code)] })).toBe(
      coverSourceForKey(code)
    );
  });

  it('첫 목적지는 seq 최소이고, 시군구 그림이 없으면 같은 시도 그림이다', () => {
    expect(
      tripCoverSource({ destinations: [dest(2, '26'), dest(1, '50')] })
    ).toBe(coverSourceForKey('50'));
    expect(tripCoverSource({ destinations: [dest(1, '11999')] })).toBe(
      coverSourceForKey('11')
    );
  });

  it('고른 키도 목적지도 못 쓰면 null — 호출부가 그라데이션을 그린다', () => {
    expect(tripCoverSource({ coverKey: 'zz9', destinations: [] })).toBeNull();
    expect(
      tripCoverSource({ coverKey: null, destinations: undefined })
    ).toBeNull();
    expect(tripCoverSource({})).toBeNull();
    expect(tripCoverSource({ destinations: [dest(1, '28200')] })).toBeNull();
    expect(tripCoverSource({ destinations: [dest(1, null)] })).toBeNull();
    expect(tripCoverSource({ destinations: [dest(1, ' ')] })).toBeNull();
  });

  it('PBT — 모르는 키는 키가 없을 때와 같은 결과, 아는 키는 항상 그 그림이다', () => {
    const known = coverChoices().map((choice) => choice.key);
    const knownSet = new Set(known);
    const regionCode = fc.constantFrom(
      '11110',
      '26350',
      '50110',
      '28200',
      '11999'
    );

    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), regionCode, (key, code) => {
        fc.pre(!knownSet.has(key));
        const destinations = [dest(1, code)];
        expect(tripCoverSource({ coverKey: key, destinations })).toBe(
          tripCoverSource({ destinations })
        );
      })
    );
    fc.assert(
      fc.property(fc.constantFrom(...known), regionCode, (key, code) => {
        expect(
          tripCoverSource({ coverKey: key, destinations: [dest(1, code)] })
        ).toBe(coverSourceForKey(key));
      })
    );
  });
});

describe('pickRegionCover — 고정 지역 전용(튜플)', () => {
  it('시군구 → 같은 시도 → null 로 내려간다', () => {
    expect(pickRegionCover([dest(1, '26350')])).toBe(REGION_COVERS['26350']);
    expect(pickRegionCover([dest(1, '11999')])).toBe(REGION_COVERS['11']);
    expect(pickRegionCover([dest(1, '28200')])).toBeNull();
    expect(pickRegionCover([dest(1, null)])).toBeNull();
  });

  it('지역 코드가 객체 기본 속성 이름이어도 null — 이 함수도 같은 변환을 지난다', () => {
    expect(pickRegionCover([dest(1, 'constructor')])).toBeNull();
  });
});

describe('pickRegionCover — 컴파일 가드', () => {
  it('길이가 정해지지 않은 배열은 컴파일 오류라 소비처가 tripCoverSource 로 가게 된다(tsc 가 심판 — 아래 지시어가 안 쓰이면 tsc 가 red)', () => {
    const call = (
      destinations: readonly Pick<TripDestination, 'seq' | 'regionCode'>[]
    ): void => {
      // @ts-expect-error — 배열 전체는 튜플이 아니라 pickRegionCover 에 못 넘긴다
      pickRegionCover(destinations);
    };

    expect(typeof call).toBe('function');
  });
});

/**
 * TRIP-1806 · 첫 목적지와 다른 시도의 그림을 고른 여행에만 「그림 · 해운대」 를 작게 붙인다.
 * "같은 시도"는 첫 목적지(seq 최소) `regionCode` 와 `coverKey` 의 앞 2자리가 같다는 뜻이다.
 *
 * 기대 글자는 전부 리터럴이다 — 이 함수 결과로 기대값을 만들면 함수가 틀려도 같이 움직여 통과한다.
 */
describe('tripCoverLabel — 다른 시도 그림이면 이름, 아니면 null', () => {
  describe('경우표 — 고른 키 × 첫 목적지 코드', () => {
    it.each<[string, string | null | undefined, string | null, string | null]>([
      ['자동(null)', null, '50110', null],
      ['자동(칸 없음·옛 서버)', undefined, '50110', null],
      ['자동(빈 문자열)', '', '50110', null],
      ['앱이 모르는 키 — 실제 그림은 자동 커버', 'zz9', '50110', null],
      ['객체 기본 속성 이름', 'constructor', '50110', null],
      ['객체 기본 속성 이름', '__proto__', '50110', null],
      ['같은 그림', '26350', '26350', null],
      ['같은 시도 다른 구', '26110', '26350', null],
      ['그림이 시도 대표(2자리)', '26', '26350', null],
      ['목적지가 시도 전체(2자리)', '26350', '26', null],
      ['AC 원문', '26350', '50110', '그림 · 해운대'],
      ['시도 대표 그림', '26', '50110', '그림 · 부산'],
      ['제주 대표', '50', '26350', '그림 · 제주'],
      ['강원 대표', '51', '50110', '그림 · 강원'],
      ['경북 대표', '47', '50110', '그림 · 경북'],
      ['경남 대표', '48', '50110', '그림 · 경남'],
      [
        '동명 — 서울 중구 여행 위 부산 중구',
        '26110',
        '11140',
        '그림 · 부산 중구',
      ],
      ['동명 — 그림은 부산뿐이어도', '26170', '27140', '그림 · 부산 동구'],
      ['동명 고성군', '51820', '48820', '그림 · 강원 고성군'],
      ['동명 강서구', '11500', '26440', '그림 · 서울 강서구'],
      ['세종은 항상 다른 시도', '26350', '36', '그림 · 해운대'],
      ['제주시는 접미를 떼면 제주', '50110', '26350', '그림 · 제주'],
    ])('%s: coverKey=%j · 첫 목적지=%j', (_why, coverKey, code, expected) => {
      // 준비 → 실행
      const label = tripCoverLabel({
        coverKey,
        destinations: [dest(1, code)],
      });

      // 단언
      expect(label).toBe(expected);
    });

    it.each<
      [string, { seq: number; regionCode?: string | null }[] | undefined]
    >([
      ['코드 null', [dest(1, null)]],
      ['코드 공백', [dest(1, ' ')]],
      ['코드 칸 없음', [{ seq: 1 }]],
      ['목적지 없음', []],
      ['목적지 칸 없음', undefined],
    ])(
      '첫 목적지 코드를 몰라 판정할 수 없으면(%s) 이름을 붙인다 — 같은 지역이어도 "그림 · 해운대"는 참이다',
      (_why, destinations) => {
        expect(tripCoverLabel({ coverKey: '26350', destinations })).toBe(
          '그림 · 해운대'
        );
      }
    );
  });

  describe('첫 목적지는 seq 최소 — 배열 앞이 아니다', () => {
    it('배열 앞이 다른 시도여도 seq 최소가 같은 시도면 없다', () => {
      expect(
        tripCoverLabel({
          coverKey: '26350',
          destinations: [dest(2, '50110'), dest(1, '26110')],
        })
      ).toBeNull();
    });

    it('배열 앞이 같은 시도여도 seq 최소가 다른 시도면 있다', () => {
      expect(
        tripCoverLabel({
          coverKey: '26350',
          destinations: [dest(2, '26110'), dest(1, '50110')],
        })
      ).toBe('그림 · 해운대');
    });

    it('첫 목적지가 아닌 다른 목적지의 그림이어도 첫 목적지와 다르면 붙인다', () => {
      expect(
        tripCoverLabel({
          coverKey: '26350',
          destinations: [dest(1, '50110'), dest(2, '26350')],
        })
      ).toBe('그림 · 해운대');
    });
  });

  // 전수 검사는 그림 목록 안의 겹침만 본다 — 부산 동구는 그림이 한 장이라 「동구」로 나와도 거기선 안 걸린다(02a ★7).
  describe('이름표 변환 — 세종(자동 그림 없음) 위에서 글자를 본다', () => {
    it.each([
      // 시도 대표 → 시도 짧은 이름
      ['11', '그림 · 서울'],
      ['26', '그림 · 부산'],
      ['47', '그림 · 경북'],
      ['48', '그림 · 경남'],
      ['50', '그림 · 제주'],
      ['51', '그림 · 강원'],
      // 다른 시도에 같은 이름이 있는 시군구 → 시도 + 시군구(접미 안 뗌)
      ['11140', '그림 · 서울 중구'],
      ['11500', '그림 · 서울 강서구'],
      ['26110', '그림 · 부산 중구'],
      ['26140', '그림 · 부산 서구'],
      ['26170', '그림 · 부산 동구'],
      ['26290', '그림 · 부산 남구'],
      ['26320', '그림 · 부산 북구'],
      ['26440', '그림 · 부산 강서구'],
      ['48820', '그림 · 경남 고성군'],
      ['51820', '그림 · 강원 고성군'],
      // 그 밖 → 끝의 구·군·시 하나만 뗀다
      ['11110', '그림 · 종로'],
      ['11230', '그림 · 동대문'],
      ['11305', '그림 · 강북'],
      ['26230', '그림 · 부산진'],
      ['26350', '그림 · 해운대'],
      ['26710', '그림 · 기장'],
      ['47110', '그림 · 포항'],
      ['47130', '그림 · 경주'],
      ['48220', '그림 · 통영'],
      ['50110', '그림 · 제주'],
      ['50130', '그림 · 서귀포'],
      ['51150', '그림 · 강릉'],
    ])('%s → %s', (coverKey, expected) => {
      expect(tripCoverLabel({ coverKey, destinations: [dest(1, '36')] })).toBe(
        expected
      );
    });
  });

  describe('전수 — 번들 그림 전부', () => {
    const labelOf = (key: string) =>
      tripCoverLabel({ coverKey: key, destinations: [dest(1, '36')] });

    it('모두 「그림 · 」 로 시작하고 이름이 두 글자 이상이며 정식 명칭·undefined 가 새지 않는다', () => {
      const keys = coverChoices().map((choice) => choice.key);
      expect(keys.length).toBeGreaterThan(0);

      for (const key of keys) {
        const label = labelOf(key);

        expect(label).toMatch(/^그림 · .{2,}$/);
        expect(label).not.toMatch(/undefined|광역시|특별/);
      }
    });

    it('같은 문구가 서로 다른 시도의 키에서 나오지 않는다 — 새 지역을 더할 때 동명을 잡는 그물', () => {
      const sidoByLabel = new Map<string, Set<string>>();
      for (const { key } of coverChoices()) {
        const label = String(labelOf(key));
        const sidos = sidoByLabel.get(label) ?? new Set<string>();
        sidos.add(key.slice(0, 2));
        sidoByLabel.set(label, sidos);
      }

      expect(sidoByLabel.size).toBeGreaterThan(0);
      for (const [label, sidos] of sidoByLabel) {
        expect([label, sidos.size]).toEqual([label, 1]);
      }
    });
  });

  describe('PBT — 어떤 입력에도 성립해야 하는 성질', () => {
    const known = coverChoices().map((choice) => choice.key);
    const knownSet = new Set(known);
    const PROTOTYPE_KEYS = ['constructor', '__proto__', 'toString', ''];
    // 앞 2자리가 전부 다르다 — 시도마다 한 곳씩(세종 36·전남광주 12 는 그림이 없는 시도).
    const OTHER_CODES = [
      '11110',
      '26350',
      '47110',
      '48120',
      '50110',
      '51110',
      '36',
      '12110',
    ];

    it('P1 · 모르는 키는 항상 null', () => {
      fc.assert(
        fc.property(
          fc.string({ maxLength: 12 }),
          fc.constantFrom(...OTHER_CODES),
          (key, code) => {
            fc.pre(!knownSet.has(key));
            expect(
              tripCoverLabel({ coverKey: key, destinations: [dest(1, code)] })
            ).toBeNull();
          }
        ),
        { examples: PROTOTYPE_KEYS.map((key) => [key, '50110']) }
      );
    });

    it('P2 · 아는 키 + 같은 시도 코드는 항상 null', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...known),
          fc.constantFrom('', '110', '350', '999'),
          (key, rest) => {
            const code = `${key.slice(0, 2)}${rest}`;
            expect(
              tripCoverLabel({ coverKey: key, destinations: [dest(1, code)] })
            ).toBeNull();
          }
        )
      );
    });

    it('P3 · 아는 키 + 다른 시도 코드는 항상 이름 문자열', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...known),
          fc.constantFrom(...OTHER_CODES),
          (key, code) => {
            fc.pre(key.slice(0, 2) !== code.slice(0, 2));
            expect(
              tripCoverLabel({ coverKey: key, destinations: [dest(1, code)] })
            ).toMatch(/^그림 · /);
          }
        )
      );
    });

    // 자동 그림도 같은 시도도 없는 세종 위에서는 "고른 그림이 실제로 보인다" ⟺ "이름이 있다" 다.
    it('P4 · 세종 위에서 그림이 없는 입력과 이름이 없는 입력이 정확히 같다', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constantFrom(...known), fc.string({ maxLength: 12 })),
          (key) => {
            const trip = { coverKey: key, destinations: [dest(1, '36')] };
            expect(tripCoverLabel(trip) === null).toBe(
              tripCoverSource(trip) === null
            );
          }
        ),
        { examples: [...PROTOTYPE_KEYS, '26350', '26'].map((key) => [key]) }
      );
    });
  });
});
