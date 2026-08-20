import fc from 'fast-check';

import type { Region } from '@/shared/api/generated/schemas';
import { RegionLevel } from '@/shared/api/generated/schemas';

import { filterRegions, regionTint } from './regions';

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
