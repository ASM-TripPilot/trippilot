import fc from 'fast-check';

import type { StayItem } from '@/shared/api/index.schemas';

import { filterBySido } from './sidoFilter';

/**
 * TRIP-1273(F3) — e02 숙소 목록의 시도 후처리 필터 순수 함수.
 *
 * 왜 클라에서 거르나: 서버 `/stays/search?region=` 은 이름 정확 일치로 지역을 풀고, 같은 이름의 구(서울
 * 강서구 11500 · 부산 강서구 26440)를 **의도적으로 합쳐** 돌려준다. 시도 접두·코드를 받는 파라미터가 없어
 * (계약 공백) FE 가 요청만 바꿔서는 못 고친다 — 그래서 지역 피커가 URL 에 실어 준 시도(`sido`)로 응답을
 * 한 번 더 거른다. 가격대 칩 `filterByPriceRange` 와 같은 "계약 공백 → 클라 파생 필터 → 서버가 생기면 승격" 선례.
 *
 * 무엇을 보장하나:
 *  - **시도가 없으면 거르지 않는다**(AC-F4) — 코드·시도 없이 들어온 경로(위저드 둘러보기·탐색 '모두 보기')는 현행.
 *  - **주소가 다른 시도인 숙소는 뺀다**(AC-F1) — 정식(`서울특별시`)·약칭(`서울`) 표기 모두 같은 시도로 본다.
 *  - **주소를 모르면 남긴다**(AC-F3 · fail-open) — 숨기지 않는다.
 *  - **동명 구·접기 함정**(★3) — `대덕구`를 `대구`로, 경기 `광주시`를 `광주`로 접으면 다른 시도 숙소가 남는다
 *    (TRIP-1011 sidoKey 오판 계열). 첫 토막(시도)이 판정의 축이다.
 *  - 순서 보존·비파괴(캐시가 소유한 배열을 건드리지 않는다).
 *
 * *(개념)* `filterBySido(items, sido)` 의 결과에서 `externalId` 만 뽑아 비교하면 어떤 숙소가 남았는지가 한눈에 보인다.
 */

function item(externalId: string, address?: string | null): StayItem {
  const base: StayItem = {
    externalSource: 'LOCALDATA',
    externalId,
    name: `숙소-${externalId}`,
    lat: 37.5,
    lng: 126.8,
    region: '강서구',
    amenities: [],
    stayType: 'HOTEL',
    price: null,
  };
  // `undefined` 를 넘기면 필드 자체를 안 만든다(응답에 address 키가 없는 경우).
  return address === undefined ? base : { ...base, address };
}

function idsOf(list: StayItem[]): string[] {
  return list.map((one) => one.externalId);
}

const SEOUL_GANGSEO = item('seoul', '서울특별시 강서구 공항대로 247');
const SEOUL_GANGSEO_ABBR = item('seoul-abbr', '서울 강서구 화곡로 1');
const BUSAN_GANGSEO = item('busan', '부산광역시 강서구 녹산산단321로 24');

describe('SF-1 · 시도가 없으면 거르지 않는다 (AC-F4)', () => {
  it.each<[string, string | undefined]>([
    ['undefined', undefined],
    ['빈 문자열', ''],
  ])('시도가 %s 면 전량을 순서 그대로, 새 배열로 돌려준다', (_, sido) => {
    const items = [BUSAN_GANGSEO, SEOUL_GANGSEO];

    const result = filterBySido(items, sido);

    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });
});

describe('SF-2 · 서울 강서구를 골랐으면 부산 강서구는 빠진다 (AC-F1 · QA F3)', () => {
  it('정식·약칭 표기의 서울 숙소만 남는다', () => {
    expect(
      idsOf(
        filterBySido(
          [SEOUL_GANGSEO, BUSAN_GANGSEO, SEOUL_GANGSEO_ABBR],
          '서울특별시'
        )
      )
    ).toEqual(['seoul', 'seoul-abbr']);
  });

  it('짝 · 부산 강서구를 골랐으면 서울 강서구가 빠진다', () => {
    expect(
      idsOf(
        filterBySido(
          [SEOUL_GANGSEO, BUSAN_GANGSEO, SEOUL_GANGSEO_ABBR],
          '부산광역시'
        )
      )
    ).toEqual(['busan']);
  });
});

describe('SF-3 · 주소를 모르면 남긴다 (AC-F3 · fail-open)', () => {
  it('address 가 null 이거나 필드가 없으면 남고, 다른 시도 주소만 빠진다', () => {
    const result = filterBySido(
      [item('null', null), BUSAN_GANGSEO, item('missing')],
      '서울특별시'
    );

    expect(idsOf(result)).toEqual(['null', 'missing']);
  });
});

describe('SF-4 · 시도 단위 선택도 그 시도 숙소는 다 남는다 (AC-F5)', () => {
  it('서울특별시 — 종로구(정식)·중구(약칭)는 남고 부산 중구는 빠진다', () => {
    const result = filterBySido(
      [
        item('jongno', '서울특별시 종로구 종로 1'),
        item('junggu', '서울 중구 을지로 30'),
        item('busan-junggu', '부산광역시 중구 중앙대로 2'),
      ],
      '서울특별시'
    );

    expect(idsOf(result)).toEqual(['jongno', 'junggu']);
  });
});

describe('SF-5 · 동명 구·접기 함정 반례 (★3 · TRIP-1011 sidoKey 오판 계열)', () => {
  it.each<[string, string, boolean]>([
    // [고른 시도, 숙소 주소, 남아야 하나]
    ['서울특별시', '부산광역시 강서구 공항로 1', false], // F3 원 증상
    ['대구광역시', '대전광역시 대덕구 대덕대로 1', false], // 대덕구→대구 접기 금지
    ['대구광역시', '대전 대덕구 대덕대로 1', false], // 약칭 시도여도 같다
    ['대구광역시', '대구 중구 동성로 1', true], // 약칭 대구는 남긴다
    ['광주광역시', '경기도 광주시 경충대로 1', false], // 경기 광주시 ≠ 광주광역시
    ['광주광역시', '광주 서구 상무대로 1', true],
    ['강원특별자치도', '경상남도 고성군 고성읍 1', false], // 동명 군
    ['강원특별자치도', '강원 고성군 간성로 1', true],
    ['강원특별자치도', '강원도 고성군 간성로 1', true], // 옛 표기 '강원도'
  ])('%s 을(를) 골랐을 때 "%s" → 남음=%s', (sido, address, kept) => {
    const result = filterBySido([item('x', address)], sido);

    expect(idsOf(result)).toEqual(kept ? ['x'] : []);
  });
});

describe('SF-6 · 비파괴', () => {
  it('거른 뒤에도 입력 배열이 그대로다', () => {
    const items = [SEOUL_GANGSEO, BUSAN_GANGSEO];
    const snapshot = idsOf(items);

    filterBySido(items, '서울특별시');

    expect(idsOf(items)).toEqual(snapshot);
  });
});

describe('SF-PBT · 어떤 시도·표기·동명 구 조합이든 첫 토막의 시도로만 가른다', () => {
  // 시도 표: 정식 이름(피커가 URL 에 싣는 `sidoName`)과 주소에 나오는 표기들.
  const SIDOS: { formal: string; forms: string[] }[] = [
    { formal: '서울특별시', forms: ['서울특별시', '서울'] },
    { formal: '부산광역시', forms: ['부산광역시', '부산'] },
    { formal: '대구광역시', forms: ['대구광역시', '대구'] },
    { formal: '대전광역시', forms: ['대전광역시', '대전'] },
    { formal: '광주광역시', forms: ['광주광역시', '광주'] },
    { formal: '인천광역시', forms: ['인천광역시', '인천'] },
    { formal: '경기도', forms: ['경기도', '경기'] },
    { formal: '강원특별자치도', forms: ['강원특별자치도', '강원', '강원도'] },
    { formal: '경상남도', forms: ['경상남도', '경남'] },
  ];
  // 시군구 — 동명 구(강서·중·동·서·남·북구)와 접기 함정(대덕구·광주시·고성군). 시도 끝명칭이 없는 값만(★4).
  const SIGUNGU = [
    '강서구',
    '중구',
    '동구',
    '서구',
    '남구',
    '북구',
    '대덕구',
    '고성군',
    '광주시',
    '수원시 영통구',
  ];
  // 도로 — `…로` 로 끝나 `도` 접미로 잘리지 않는다(★4).
  const ROADS = ['공항대로 247', '중앙대로 1', '해안로 3'];

  type Spec =
    | {
        kind: 'addr';
        sido: number;
        form: number;
        sigungu: number;
        road: number;
      }
    | { kind: 'null' }
    | { kind: 'missing' };

  const SPEC: fc.Arbitrary<Spec> = fc.oneof(
    fc.record({
      kind: fc.constant('addr' as const),
      sido: fc.nat({ max: SIDOS.length - 1 }),
      form: fc.nat({ max: 2 }),
      sigungu: fc.nat({ max: SIGUNGU.length - 1 }),
      road: fc.nat({ max: ROADS.length - 1 }),
    }),
    fc.constant({ kind: 'null' as const }),
    fc.constant({ kind: 'missing' as const })
  );

  function build(spec: Spec, index: number): StayItem {
    if (spec.kind === 'null') return item(`s${index}`, null);
    if (spec.kind === 'missing') return item(`s${index}`);
    const { forms } = SIDOS[spec.sido];
    const form = forms[spec.form % forms.length];
    return item(
      `s${index}`,
      `${form} ${SIGUNGU[spec.sigungu]} ${ROADS[spec.road]}`
    );
  }

  const addr = (sido: number, form: number, sigungu: number): Spec => ({
    kind: 'addr',
    sido,
    form,
    sigungu,
    road: 0,
  });

  it('결과 id = 오라클(주소 없음 또는 주소 시도 = 고른 시도), 순서 보존', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: SIDOS.length - 1 }),
        fc.array(SPEC, { maxLength: 10 }),
        (picked, specs) => {
          const items = specs.map(build);

          const result = filterBySido(items, SIDOS[picked].formal);

          // 오라클 — 구현과 다른 길: 문자열을 가르지 않고 생성 명세의 시도 번호로 직접 판정한다.
          const expected = specs
            .map((spec, index) => ({ spec, id: `s${index}` }))
            .filter(({ spec }) => spec.kind !== 'addr' || spec.sido === picked)
            .map(({ id }) => id);
          expect(idsOf(result)).toEqual(expected);
        }
      ),
      {
        numRuns: 300,
        // ★3 — 확률에 맡기지 않는 반례(README PBT 규칙). 인덱스: 시도 0 서울·1 부산·2 대구·3 대전·4 광주·
        // 6 경기·7 강원·8 경남 / 시군구 0 강서구·6 대덕구·7 고성군·8 광주시.
        examples: [
          [0, [addr(0, 0, 0), addr(1, 0, 0), addr(0, 1, 0)]], // 서울 vs 부산 강서구
          [2, [addr(3, 0, 6), addr(3, 1, 6), addr(2, 1, 1)]], // 대구 vs 대전 대덕구
          [4, [addr(6, 0, 8), addr(4, 1, 3)]], // 광주광역시 vs 경기 광주시
          [7, [addr(8, 0, 7), addr(7, 2, 7), addr(7, 1, 7)]], // 강원 vs 경남 고성군 · 강원도 표기
          [0, [{ kind: 'null' }, { kind: 'missing' }, addr(1, 0, 0)]], // fail-open
          [1, []], // 빈 입력
        ],
      }
    );
  });
});
