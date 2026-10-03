/**
 * @jest-environment node
 */
import fc from 'fast-check';

import type { Region } from '@/shared/api/index.schemas';
import { RegionLevel } from '@/shared/api/index.schemas';

import { placeLocationLabel, regionCodeInTrip } from './regionMatch';

/**
 * TRIP-1042 — 꼭 갈 곳 고르기(d02 select)의 여행 지역 판정과 행 위치 표기를 **코드로** 한다.
 *
 * 무엇을 보장하나:
 *  - `regionCodeInTrip` — 장소 코드가 여행 목적지 코드와 **짧은 쪽이 긴 쪽의 접두사**면 지역 안이다
 *    (BR-U1-58 · 01b Q1 b). 코드는 시도 2자리·시군구 5자리의 고정폭 계층이라, 5자리끼리는 같은 값만 통과한다.
 *    장소 코드가 없으면 지역 안(fail-open, BR-U1-58 ③), 목적지 코드가 하나라도 없으면 판정 자체를 건너뛴다(01b Q6).
 *  - `placeLocationLabel` — 행 위치를 `인천 남동구`처럼 시도 짧은 이름 + 시군구로 적는다. 시도 이름은 서버
 *    카탈로그(`GET /regions`)의 SIDO 행에서 얻고, 상수표를 두지 않는다(TRIP-445 · 맹점 ②).
 *
 * 커버하지 않는 것: 코드 `12`(전남광주통합특별시)의 짧은 이름(01b Q5 — 특례 없이 관측만).
 */

describe('TRIP-1042 · regionCodeInTrip 예시 (AC-1·2·3 · Q1 · Q6)', () => {
  it.each<[string | null, (string | null)[], boolean, string]>([
    ['11110', ['11'], true, 'AC-1 서울 여행의 종로구'],
    ['28200', ['11'], false, 'AC-2 서울 여행의 인천 남동구'],
    [null, ['11'], true, 'AC-3 코드 모름 → 지역 안(fail-open)'],
    ['26', ['26350'], true, 'Q1 시도만 아는 장소 → 시군구 여행에 안'],
    ['26350', ['26'], true, 'Q1 시군구 장소 → 시도 여행에 안'],
    ['11110', [], true, 'Q6 목적지 없음 → 판정 생략'],
    ['28200', ['11', null], true, 'Q6 목적지 하나라도 코드 없음 → 판정 생략'],
    ['26350', ['11', '26'], true, '다중 목적지 중 하나와 맞음'],
  ])('(%s, %j) → %s — %s', (placeCode, destinationCodes, expected) => {
    expect(regionCodeInTrip(placeCode, destinationCodes)).toBe(expected);
  });
});

// 코드 생성기 — 고정폭 계층(시도 2자리 · 시군구 5자리)만 만든다. 임의 길이 문자열은 "짧은 쪽 접두사"
// 규칙에서 비현실 반례(`1` vs `11110`)를 낳는다(02a ★9).
const sido = fc.integer({ min: 10, max: 99 }).map(String);
const tail = fc
  .integer({ min: 0, max: 999 })
  .map((n) => String(n).padStart(3, '0'));
const sigungu = fc.tuple(sido, tail).map(([s, t]) => s + t);
const anyCode = fc.oneof(sido, sigungu);
const missing = fc.constantFrom<null | undefined | string>(null, undefined, '');

describe('TRIP-1042 · regionCodeInTrip 성질 (PBT)', () => {
  it('P1 · 장소 코드가 없으면(null·undefined·빈 문자열) 어떤 목적지든 지역 안이다', () => {
    fc.assert(
      fc.property(missing, fc.array(anyCode, { maxLength: 4 }), (p, dests) => {
        expect(regionCodeInTrip(p, dests)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('P2 · 목적지가 0곳이면 어떤 장소든 지역 안이다 (Q6)', () => {
    fc.assert(
      fc.property(anyCode, (p) => {
        expect(regionCodeInTrip(p, [])).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('P3 · 목적지 중 하나라도 코드가 없으면 판정을 건너뛴다 (Q6 부분 누락, 02a ★8)', () => {
    fc.assert(
      fc.property(
        anyCode,
        fc.array(anyCode, { maxLength: 3 }),
        missing,
        fc.nat(),
        (p, coded, hole, at) => {
          const dests: (string | null | undefined)[] = [...coded];
          dests.splice(at % (coded.length + 1), 0, hole);
          expect(regionCodeInTrip(p, dests)).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('P4 · 같은 시도 안에서는 시도↔시군구 어느 방향이든, 같은 값이면 지역 안이다 (Q1)', () => {
    fc.assert(
      fc.property(sido, tail, (s, t) => {
        expect(regionCodeInTrip(s + t, [s])).toBe(true);
        expect(regionCodeInTrip(s, [s + t])).toBe(true);
        expect(regionCodeInTrip(s + t, [s + t])).toBe(true);
        expect(regionCodeInTrip(s, [s])).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('P5 · 시도가 다르면 모양(2·5자리)과 상관없이 지역 밖이다', () => {
    fc.assert(
      fc.property(
        fc.tuple(sido, sido).filter(([a, b]) => a !== b),
        tail,
        tail,
        fc.boolean(),
        fc.boolean(),
        ([s1, s2], t1, t2, placeLong, destLong) => {
          const p = placeLong ? s1 + t1 : s1;
          const d = destLong ? s2 + t2 : s2;
          expect(regionCodeInTrip(p, [d])).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('P6 · 같은 시도라도 시군구가 다르면(5자리끼리) 지역 밖이다', () => {
    fc.assert(
      fc.property(
        sido,
        fc.tuple(tail, tail).filter(([a, b]) => a !== b),
        (s, [t1, t2]) => {
          expect(regionCodeInTrip(s + t1, [s + t2])).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('P7 · 여러 목적지면 "하나라도 맞으면 안"이고, 목적지 순서와 무관하다', () => {
    fc.assert(
      fc.property(
        anyCode,
        fc.array(anyCode, { minLength: 1, maxLength: 4 }),
        (p, dests) => {
          const whole = regionCodeInTrip(p, dests);
          expect(whole).toBe(dests.some((d) => regionCodeInTrip(p, [d])));
          expect(regionCodeInTrip(p, [...dests].reverse())).toBe(whole);
        }
      ),
      { numRuns: 300 }
    );
  });
});

function region(
  regionCode: string,
  name: string,
  sidoName: string,
  level: RegionLevel
): Region {
  return { regionCode, name, sidoName, level, selectable: true, poiCount: 1 };
}

/** 서버 카탈로그 모양 그대로 — SIDO 행은 `name === sidoName`, SIGUNGU 행은 상위 시도명을 싣는다. */
const CATALOG: Region[] = [
  region('11', '서울특별시', '서울특별시', RegionLevel.SIDO),
  region('11110', '종로구', '서울특별시', RegionLevel.SIGUNGU),
  region('26', '부산광역시', '부산광역시', RegionLevel.SIDO),
  region('28', '인천광역시', '인천광역시', RegionLevel.SIDO),
  region('28200', '남동구', '인천광역시', RegionLevel.SIGUNGU),
  region('50', '제주특별자치도', '제주특별자치도', RegionLevel.SIDO),
];

describe('TRIP-1042 AC-9 · placeLocationLabel — 시도 짧은 이름 + 시군구', () => {
  it.each<[string | null, string | null, string]>([
    ['28200', '남동구', '인천 남동구'],
    ['11110', '종로구', '서울 종로구'],
    // 시드 POI 는 시도 2자리 + region 이 곧 시도 짧은 이름이다 — `부산 부산` 으로 겹쳐 쓰지 않는다.
    ['26', '부산', '부산'],
    ['50', '제주', '제주'],
    [null, '종로구', '종로구'],
    // 카탈로그에 그 시도 행이 없으면 지어내지 않고 region 그대로.
    ['99999', '어딘가', '어딘가'],
  ])('(%s, %s) → %s', (regionCode, placeRegion, expected) => {
    expect(
      placeLocationLabel({ regionCode, region: placeRegion }, CATALOG)
    ).toBe(expected);
  });

  it('카탈로그가 아직 없으면(조회 중 빈 배열) 시군구만 보인다', () => {
    expect(
      placeLocationLabel({ regionCode: '11110', region: '종로구' }, [])
    ).toBe('종로구');
  });

  it('코드도 region 도 없으면 null 이다', () => {
    expect(
      placeLocationLabel({ regionCode: null, region: null }, CATALOG)
    ).toBeNull();
  });
});
