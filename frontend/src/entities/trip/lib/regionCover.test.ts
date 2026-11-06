import fc from 'fast-check';

import coverNames from '../../../../assets/region-covers/index.json';
import { REGION_COVERS } from '../config/regionCovers';
import type { TripDestination } from '../model';

import {
  coverChoices,
  coverSourceForKey,
  pickRegionCover,
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
