import fc from 'fast-check';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import {
  filterRegions,
  groupRegionsBySido,
  limitRegionsWhenEmpty,
  regionTint,
} from './regions';

/**
 * TRIP-445 지역 카탈로그 서버 연동 — 순수 모델 두 개.
 *
 * 무엇을 보장하나:
 *  · `filterRegions(list, query)` — **시그니처가 바뀌었다**(Q1/D1). 이제 서버가 준 목록을
 *    인자로 받아 클라이언트에서 좁힌다(상수 `REGIONS`가 사라졌으므로). 빈 질의=전체,
 *    불일치=빈 배열이라는 **의미는 현행 그대로**다 — "입력 안 함"과 "일치 없음"은 다르다.
 *  · `regionTint(regionCode)` — 맹점①의 해시 폴백. 닫힌 6코드 Record(`REGION_TINT`)가
 *    서버의 임의 `regionCode`('51720' 같은 숫자문자열)에 구조적으로 파손되던 것을,
 *    코드를 결정적으로 해시해 색 쌍을 고르는 순수 함수로 바꾼다.
 *
 * 3동작 뼈대: 준비(Arrange)=서버 shape 표본 조립 → 실행(Act)=순수 함수 호출 → 단언(Assert).
 * 순수 함수라 준비가 값 하나뿐인 경우가 많다.
 */

/** 서버 `Region` 표본을 짧게 만드는 도우미 — required 6필드를 전부 채운다(계약 그대로). */
function region(
  over: Partial<Region> & Pick<Region, 'regionCode' | 'name'>
): Region {
  return {
    sidoName: over.sidoName ?? '',
    level: over.level ?? RegionLevel.SIGUNGU,
    selectable: over.selectable ?? true,
    poiCount: over.poiCount ?? 1,
    ...over,
  };
}

/** 시도→층→이름 순으로 서버가 준다고 가정한 표본(정렬은 서버 몫, 화면은 순서 보존). */
const SERVER_REGIONS: Region[] = [
  region({
    regionCode: '26',
    name: '부산광역시',
    level: RegionLevel.SIDO,
    sidoName: '부산광역시',
    poiCount: 12,
  }),
  region({
    regionCode: '11',
    name: '서울특별시',
    level: RegionLevel.SIDO,
    sidoName: '서울특별시',
    poiCount: 40,
  }),
  region({
    regionCode: '50',
    name: '제주특별자치도',
    level: RegionLevel.SIDO,
    sidoName: '제주특별자치도',
    poiCount: 8,
  }),
  region({
    regionCode: '51720',
    name: '홍천군',
    level: RegionLevel.SIGUNGU,
    sidoName: '강원특별자치도',
    poiCount: 0,
  }),
];

describe('filterRegions(list, query) — 서버 목록을 클라이언트에서 좁힌다(D1)', () => {
  it('빈 질의는 목록 전체를 그대로 돌려준다', () => {
    // 준비: 서버 목록. 실행: 빈 질의. 단언: 원본 그대로.
    expect(filterRegions(SERVER_REGIONS, '')).toEqual(SERVER_REGIONS);
  });

  it('공백만 있어도 전체다 — 트림 후 판정한다', () => {
    expect(filterRegions(SERVER_REGIONS, '   ')).toEqual(SERVER_REGIONS);
  });

  it('이름 부분 일치로 좁힌다', () => {
    // 실행: '제' → 제주만. 단언: 남은 코드로 확인(이름 대신 안정 식별자로 비교).
    expect(
      filterRegions(SERVER_REGIONS, '제').map((r) => r.regionCode)
    ).toEqual(['50']);
  });

  it('앞뒤 공백은 무시한다', () => {
    expect(
      filterRegions(SERVER_REGIONS, '  부산 ').map((r) => r.regionCode)
    ).toEqual(['26']);
  });

  it('일치가 없으면 빈 배열 — 전체로 되돌아가지 않는다', () => {
    // "결과 없으면 전부 보여주기"는 사용자에겐 필터가 고장난 것으로 보인다.
    expect(filterRegions(SERVER_REGIONS, '없는지역')).toEqual([]);
  });

  it('속성: 어떤 질의에도 결과는 입력 목록의 부분집합이고 순서를 보존한다', () => {
    fc.assert(
      fc.property(fc.string(), (query) => {
        const got = filterRegions(SERVER_REGIONS, query);
        const codes = got.map((r) => r.regionCode);
        const allCodes = SERVER_REGIONS.map((r) => r.regionCode);

        // 부분집합
        expect(codes.every((c) => allCodes.includes(c))).toBe(true);
        // 순서 보존 — 원본에서 걸러낸 순서와 같다
        expect(codes).toEqual(allCodes.filter((c) => codes.includes(c)));
      }),
      { numRuns: 300 }
    );
  });
});

describe('regionTint(regionCode) — 임의 코드용 해시 폴백(맹점①)', () => {
  it('같은 코드는 항상 같은 색 쌍이다 — 결정적이다', () => {
    // 결정성: 렌더가 리마운트돼도 카드 색이 안 흔들린다.
    expect(regionTint('51720')).toEqual(regionTint('51720'));
  });

  it('임의 숫자문자열 코드에도 hex 색 2개를 던지지 않고 돌려준다', () => {
    // 닫힌 Record라면 여기서 undefined 구조분해로 깨진다 — 해시 폴백은 아무 코드나 받는다.
    const codes = ['11', '26', '50', '51720', '4131000000'];
    codes.forEach((code) => {
      const pair = regionTint(code);
      expect(pair).toHaveLength(2);
      expect(pair[0]).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(pair[1]).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  it('여러 코드에 색이 분산된다 — 전부 한 쌍으로 뭉치지 않는다', () => {
    // 준비: 서로 다른 코드 20개. 실행: 각 tint. 단언: 서로 다른 결과가 2개 이상.
    const pairs = Array.from({ length: 20 }, (_, i) =>
      JSON.stringify(regionTint(String(1000 + i * 37)))
    );
    expect(new Set(pairs).size).toBeGreaterThanOrEqual(2);
  });
});

describe('limitRegionsWhenEmpty(list, query, limit) — 빈 질의는 대표 소수만(TRIP-469)', () => {
  it('검색어가 비면(공백만 포함) 앞쪽 limit 개만 준다', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      region({ regionCode: String(i), name: `지역${i}` })
    );
    expect(limitRegionsWhenEmpty(many, '', 6)).toHaveLength(6);
    expect(limitRegionsWhenEmpty(many, '   ', 6)).toHaveLength(6);
    // 순서 보존 — 앞 6개가 곧 대표(서버 정렬 신뢰).
    expect(limitRegionsWhenEmpty(many, '', 6)[0].name).toBe('지역0');
  });

  it('검색어가 있으면 목록 전체를 그대로 준다(캡 안 함)', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      region({ regionCode: String(i), name: `지역${i}` })
    );
    expect(limitRegionsWhenEmpty(many, '지역', 6)).toHaveLength(30);
  });

  it('limit 기본값은 6이다', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      region({ regionCode: String(i), name: `지역${i}` })
    );
    expect(limitRegionsWhenEmpty(many, '')).toHaveLength(6);
  });
});

/**
 * TRIP-597 · AC-8 — `groupRegionsBySido(regions)`: 평면 카탈로그를 시/도별로 접는 순수 함수.
 *
 * 무엇을 보장하나(왜 이 함수가 test-first 핵심인가):
 *  · 지역 선택 화면이 인천광역시(시/도)와 미추홀구(구/군)를 한 평면에 뒤섞어 쏟아내던 것을,
 *    드릴다운으로 접으려면 먼저 "어떤 구/군이 어떤 시/도에 속하나"를 **결정적으로** 계산해야
 *    한다. 그 계산이 이 함수다 — 화면 없이 로직만 jest 로 잠근다.
 *  · **그룹 키 = `regionCode` 앞 2자리**(법정동코드 시도 코드). 서버가 "시군구 앞 2자리 =
 *    소속 시도 코드"를 못박았고(코드가 관계의 정본), `sidoName` 은 표시용이라 그룹 라벨로만 쓴다.
 *  · 각 그룹은 자기 SIDO Region(`sido`, '전체' 행이 될 것)과 그 하위 SIGUNGU 목록(`sigungu`)을
 *    나눠 갖고, **서버가 준 순서를 보존**한다(화면은 재정렬하지 않는다).
 *
 * 3동작 뼈대: 준비(Arrange)=시도·시군구 혼재 Region[] → 실행(Act)=groupRegionsBySido(list)
 *   → 단언(Assert)=접힌 그룹의 shape. 순수 함수라 준비가 입력값 하나뿐이다.
 * ★ 코드는 안정 식별자라 이름 대신 `regionCode` 로 비교한다(동명 위험 회피).
 */
describe('groupRegionsBySido(regions) — 평면 카탈로그를 시/도로 접는다(AC-8)', () => {
  // 공통 픽스처 — 법정동 앞자리(현실값). 인천 28 / 미추홀구 28177 / 연수구 28185 /
  // 강원 51 / 춘천 51110 / 홍천 51720. 이름에 '전체' 부분문자열 없음(화면 테스트와 정합).
  const INCHEON = region({
    regionCode: '28',
    name: '인천광역시',
    level: RegionLevel.SIDO,
    sidoName: '인천광역시',
    selectable: true,
    poiCount: 50,
  });
  const MICHUHOL = region({
    regionCode: '28177',
    name: '미추홀구',
    level: RegionLevel.SIGUNGU,
    sidoName: '인천광역시',
    poiCount: 8,
  });
  const YEONSU = region({
    regionCode: '28185',
    name: '연수구',
    level: RegionLevel.SIGUNGU,
    sidoName: '인천광역시',
    poiCount: 5,
  });
  const GANGWON = region({
    regionCode: '51',
    name: '강원특별자치도',
    level: RegionLevel.SIDO,
    sidoName: '강원특별자치도',
    selectable: false,
    poiCount: 30,
  });
  const CHUNCHEON = region({
    regionCode: '51110',
    name: '춘천시',
    level: RegionLevel.SIGUNGU,
    sidoName: '강원특별자치도',
    poiCount: 12,
  });

  it('시도 코드 앞 2자리별로 접고, 각 그룹이 SIDO Region + SIGUNGU 목록을 나눠 갖는다', () => {
    // 준비: 인천(시도)+미추홀+연수 / 강원(시도)+춘천 혼재.
    const groups = groupRegionsBySido([
      INCHEON,
      MICHUHOL,
      YEONSU,
      GANGWON,
      CHUNCHEON,
    ]);

    // 단언: 그룹 2개(28·51), 각 그룹의 키·라벨·SIDO·SIGUNGU 코드까지 완전 일치.
    expect(groups.map((g) => g.sidoCode)).toEqual(['28', '51']);

    const incheon = groups[0];
    expect(incheon.sidoName).toBe('인천광역시');
    expect(incheon.sido).toBe(INCHEON); // 객체 동일성 — 재조립하지 않는다.
    expect(incheon.sigungu.map((r) => r.regionCode)).toEqual([
      '28177',
      '28185',
    ]);

    const gangwon = groups[1];
    expect(gangwon.sidoName).toBe('강원특별자치도');
    expect(gangwon.sido).toBe(GANGWON);
    expect(gangwon.sigungu.map((r) => r.regionCode)).toEqual(['51110']);
  });

  it('서버 순서를 보존한다 — 그룹은 시도 첫 등장 순, 그룹 내 시군구는 입력 순', () => {
    // 준비: 일부러 뒤섞은 입력(미추홀 먼저, 인천 SIDO 나중, 강원 뒤에).
    const groups = groupRegionsBySido([
      MICHUHOL, // 28 첫 등장
      INCHEON,
      CHUNCHEON, // 51 첫 등장
      GANGWON,
      YEONSU, // 28 두 번째 시군구
    ]);

    // 그룹 순서 = 시도 코드 첫 등장 순(28 → 51).
    expect(groups.map((g) => g.sidoCode)).toEqual(['28', '51']);
    // 28 그룹 시군구 순서 = 입력에 나타난 순(미추홀 → 연수).
    expect(groups[0].sigungu.map((r) => r.regionCode)).toEqual([
      '28177',
      '28185',
    ]);
  });

  it('엣지② · 하위 시군구가 없는 시도는 sigungu 가 빈 배열이다', () => {
    // 준비: 세종특별자치시(SIDO) 단독 — 그 안에 시군구 없음.
    const sejong = region({
      regionCode: '36',
      name: '세종특별자치시',
      level: RegionLevel.SIDO,
      sidoName: '세종특별자치시',
      selectable: true,
      poiCount: 4,
    });
    const groups = groupRegionsBySido([sejong]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sido).toBe(sejong);
    expect(groups[0].sigungu).toEqual([]);
  });

  it('엣지③ · 소속 SIDO 행이 목록에 없는 시군구는 sido=null 로 방어한다', () => {
    // 준비: 미추홀구(28177)만, 인천(28) SIDO 행 없음.
    const groups = groupRegionsBySido([MICHUHOL]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sidoCode).toBe('28');
    expect(groups[0].sido).toBeNull();
    expect(groups[0].sigungu.map((r) => r.regionCode)).toEqual(['28177']);
  });

  it('엣지④ · poiCount 를 재계산·합산하지 않는다 — 서버 값을 그대로 둔다', () => {
    // 서버가 시도 행에 이미 합산한 값(50)을 함수가 건드리지 않는다(계약).
    const groups = groupRegionsBySido([INCHEON, MICHUHOL, YEONSU]);
    expect(groups[0].sido?.poiCount).toBe(50);
  });

  it('속성(PBT) · 접힌 결과의 시군구 총수·코드 집합이 입력과 정확히 같다(누락·중복 0)', () => {
    // fast-check 는 임의 Region[] 를 300번 만들어 던진다 — 손으로 못 짠 조합까지 훑는다.
    const arbCode = fc
      .tuple(
        fc.constantFrom('11', '26', '28', '41', '51'), // 시도 앞 2자리 후보
        fc.stringMatching(/^[0-9]{3}$/) // 시군구 뒷 3자리
      )
      .map(([sido, rest]) => ({ sido, full: sido + rest }));

    const arbRegion = fc.oneof(
      // SIDO 행: 코드 2자리.
      arbCode.map(({ sido }) =>
        region({
          regionCode: sido,
          name: `시도${sido}`,
          level: RegionLevel.SIDO,
          sidoName: `시도${sido}`,
        })
      ),
      // SIGUNGU 행: 코드 5자리.
      arbCode.map(({ full }) =>
        region({
          regionCode: full,
          name: `구군${full}`,
          level: RegionLevel.SIGUNGU,
        })
      )
    );

    fc.assert(
      fc.property(fc.array(arbRegion, { maxLength: 40 }), (list) => {
        const groups = groupRegionsBySido(list);

        const inputSigungu = list
          .filter((r) => r.level === RegionLevel.SIGUNGU)
          .map((r) => r.regionCode);
        const groupedSigungu = groups.flatMap((g) =>
          g.sigungu.map((r) => r.regionCode)
        );

        // 총수 보존(누락·중복 없음).
        expect(groupedSigungu).toHaveLength(inputSigungu.length);
        // 집합 보존 — 정렬해 비교(그룹 재배치는 순서만 바꾸지 원소는 안 바꾼다).
        expect([...groupedSigungu].sort()).toEqual([...inputSigungu].sort());
      }),
      { numRuns: 300 }
    );
  });
});
