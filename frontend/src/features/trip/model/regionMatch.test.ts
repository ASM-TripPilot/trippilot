/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';

import { addressInRegion, sidoKey } from './regionMatch';

/**
 * TRIP-1011(#036) — 주소가 "그 밤의 지역"에 속하는지 가르는 순수 함수(브리프 §5 매칭 규칙 · AC-5).
 *
 * 무엇을 보장하나:
 *  - **시도 키 접기** `sidoKey` — 끝 명칭(특별자치시·특별자치도·특별시·광역시·도)을 떼고, 남은 글자가 3자면
 *    1·3번째 글자만 남긴다. 그래서 정식 명칭(`서울특별시`·`충청북도`)과 카카오 지번 약칭(`서울`·`충북`)이
 *    같은 키가 된다.
 *  - **판정** `addressInRegion` — 주소 앞 토막 중 하나가 지역 이름과 같거나, 시도 키가 같으면 true.
 *    시군구 여행지(`중구`·`강릉시`)는 토막 일치로, 시도 여행지는 키 일치로 걸린다.
 *  - **지역 상수표 없음** — 지역 이름 목록을 소스에 두지 않는다(TRIP-445 서버 카탈로그 원칙). 규칙만으로 접힌다.
 *
 * 커버하지 않는 것: 시군구 동명이지역(서울 중구 여행에 부산 중구 숙소가 걸림)·`전남광주통합특별시`는
 * 브리프 §9-③ "이번 범위에서 못 하는 것"이라 잠그지 않는다(fail-open 방향이라 숨겨지는 숙소는 없다).
 */

describe('AC-5 · sidoKey — 정식 명칭과 약칭이 같은 키로 접힌다 (브리프 §5 결과 표)', () => {
  it.each([
    ['서울특별시', '서울'],
    ['서울', '서울'],
    ['부산광역시', '부산'],
    ['경기도', '경기'],
    ['충청북도', '충북'],
    ['충북', '충북'],
    ['강원특별자치도', '강원'],
    ['세종특별자치시', '세종'],
    ['전라남도', '전남'],
  ])('sidoKey(%s) === %s', (input, expected) => {
    expect(sidoKey(input)).toBe(expected);
  });
});

describe('AC-5 · addressInRegion — 예시 표 (브리프 AC-5 네 줄 + 보강)', () => {
  it.each([
    // 브리프 AC-5 네 줄
    ['서울 중구 을지로 30', '서울특별시', true],
    ['충북 청주시 상당구 상당로 82', '충청북도', true],
    ['부산광역시 중구 중앙대로 26', '중구', true],
    ['광주 서구 내방로 111', '광주시', false],
    // 보강 — 정식 명칭 도로명 주소 · QA 재현(#036)
    ['서울특별시 종로구 청계천로 279', '서울특별시', true],
    ['부산광역시 해운대구 해운대해변로 296', '서울특별시', false],
    ['부산 금정구 구서동 1', '서울특별시', false],
    // 보강 — 시군구 여행지는 토막 일치로 걸린다(일반시·행정구 포함)
    ['강원특별자치도 강릉시 창해로 307', '강릉시', true],
    ['경기 수원시 장안구 정조로 1', '수원시', true],
    // 보강 — 경기 광주시 주소가 광주광역시 여행에 걸리지 않는다(`광주시`는 시도 끝 명칭이 없어 접지 않는다 — `광주`와 다름)
    ['경기 광주시 행정타운로 50', '광주광역시', false],
    // 03b 경고-1 — 끝 명칭 없는 3자 시군구는 접지 않는다(`대덕구`→`대구` 오판 금지)
    ['대전 대덕구 대덕대로 1', '대구광역시', false],
    ['서울 강서구 공항대로 1', '강남구', false],
    ['서울 중랑구 망우로 1', '중구', false],
  ])('addressInRegion(%s, %s) === %s', (address, region, expected) => {
    expect(addressInRegion(address, region)).toBe(expected);
  });
});

/**
 * 속성 테스트의 입력 — 시도 (정식 명칭, 카카오 약칭) 쌍. 이 표는 **테스트 픽스처 쪽**에만 둔다(브리프
 * AC-5). 구현이 같은 표를 가지면 표를 읽어 맞추는 "상수표 구현"이 된다 — 아래 구조 스캔이 그것을 막는다.
 * 옛 명칭(`전라북도`·`강원도`)도 넣는다 — 규칙만으로 새 명칭과 같은 키가 되는지 함께 본다.
 */
const SIDO_PAIRS: readonly (readonly [string, string])[] = [
  ['서울특별시', '서울'],
  ['부산광역시', '부산'],
  ['대구광역시', '대구'],
  ['인천광역시', '인천'],
  ['광주광역시', '광주'],
  ['대전광역시', '대전'],
  ['울산광역시', '울산'],
  ['세종특별자치시', '세종'],
  ['경기도', '경기'],
  ['강원특별자치도', '강원'],
  ['강원도', '강원'],
  ['충청북도', '충북'],
  ['충청남도', '충남'],
  ['전북특별자치도', '전북'],
  ['전라북도', '전북'],
  ['전라남도', '전남'],
  ['경상북도', '경북'],
  ['경상남도', '경남'],
  ['제주특별자치도', '제주'],
];

/** 주소 꼬리 — 시도 이름과 우연히 겹치지 않는 시군구·도로 토막만 쓴다. */
const TAILS = ['중구 세종대로 110', '해운대구 우동 1', '종로구 청계천로 279'];

describe('AC-5 · 속성 — 어떤 시도든 정식 명칭과 약칭이 같은 곳으로 판정된다 (PBT)', () => {
  it('sidoKey(정식) === sidoKey(약칭)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SIDO_PAIRS), ([formal, abbr]) => {
        expect(sidoKey(formal)).toBe(sidoKey(abbr));
      }),
      { numRuns: 200 }
    );
  });

  it('정식 명칭 여행지는 약칭 주소·정식 주소 둘 다 "이 여행지"로 판정한다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SIDO_PAIRS),
        fc.constantFrom(...TAILS),
        ([formal, abbr], tail) => {
          expect(addressInRegion(`${abbr} ${tail}`, formal)).toBe(true);
          expect(addressInRegion(`${formal} ${tail}`, formal)).toBe(true);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('다른 시도의 주소는 (약칭이든 정식이든) "이 여행지"가 아니다', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SIDO_PAIRS),
        fc.constantFrom(...SIDO_PAIRS),
        fc.constantFrom(...TAILS),
        ([formalA, abbrA], [formalB, abbrB], tail) => {
          // 같은 곳(약칭이 같음 — 예: 전라북도·전북특별자치도)은 이 속성의 대상이 아니다.
          fc.pre(abbrA !== abbrB);
          expect(addressInRegion(`${abbrB} ${tail}`, formalA)).toBe(false);
          expect(addressInRegion(`${formalB} ${tail}`, formalA)).toBe(false);
        }
      ),
      { numRuns: 500 }
    );
  });
});

/** 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(`staySelectSheetStructure.test.ts` 계승). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 시도 이름 조각 — 이 중 하나라도 구현 소스(주석 제외)에 있으면 지역 상수표를 둔 것이다. */
const SIDO_NAME_IN_SOURCE =
  /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;

describe('AC-5 · 구조 — 지역 이름 상수표 없이 규칙만으로 접는다 (TRIP-445 서버 카탈로그 원칙)', () => {
  it('탐지기 자가검사 — 주석 속 지역명은 걷히고, 코드 속 지역명은 문다', () => {
    const sample = [
      '// 서울특별시 → 서울 로 접힌다', // 주석 → 걷힘
      "const FIXED = ['부산'];", // 코드 → 생존
      "const url = 'https://example.com/a';", // URL 슬래시 보존
    ].join('\n');

    const stripped = stripComments(sample);

    expect(stripped).not.toMatch(/서울/);
    expect(stripped).toMatch(/https:\/\/example\.com/);
    expect(SIDO_NAME_IN_SOURCE.test(stripped)).toBe(true);
  });

  it('regionMatch.ts 소스(주석 제외)에 시도 이름이 0건이고, 두 함수를 export 한다', () => {
    const source = stripComments(
      readFileSync(join(__dirname, 'regionMatch.ts'), 'utf8')
    );

    // 긍정 짝 — 빈 파일 공짜 통과 차단.
    expect(source).toMatch(/export function sidoKey\b/);
    expect(source).toMatch(/export function addressInRegion\b/);
    // 부정 — 지역 상수표 금지.
    expect(source).not.toMatch(SIDO_NAME_IN_SOURCE);
  });
});
