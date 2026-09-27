import fc from 'fast-check';

import {
  type StayAddressState,
  type StaySheetSection,
  staySheetSections,
} from './staySheetSections';

/**
 * TRIP-1011(#036 · D8) — 숙소 선택 시트의 후보를 "그 밤 지역" / "다른 지역" 두 섹션으로 가르는 순수 함수.
 *
 * 무엇을 보장하나:
 *  - **숨김 없음(fail-open · INV-4)** 두 섹션을 합치면 입력 숙소 전부다 — 한 곳도 빠지거나 겹치지 않는다.
 *  - **주소 확인된 것만 "그 밤 지역"** 주소를 모르거나(좌표 없음·주소 null·조회 실패) 아직 조회 중인 숙소는
 *    "다른 지역"으로 간다(01b Q2 · 오케 지시 "조회 실패·로딩은 다른 지역 · 위치 확인 안 됨").
 *  - **헤더 문구(01b Q3)** 첫 섹션 `{그 밤 지역} 숙소`, 둘째 `다른 지역` — 주소 모르는 숙소가 한 곳이라도
 *    섞이면 `다른 지역 · 위치 확인 안 됨`.
 *  - **한쪽이 비면 null** 헤더 없이 평면 목록으로 그리라는 신호다(01b Q3). 전부 조회 중이면 전부 "다른
 *    지역"이 되어 한쪽이 비므로 역시 null — 브리프 AC-6 "조회 중이면 평면 목록"과 같은 결과다.
 *  - **입력 순서 보존** 섹션 안 순서는 입력(저장 목록) 순서 그대로다.
 *
 * "그 밤 지역"의 판정 자체(정식·약칭 접기)는 `regionMatch.test.ts`가 잠근다. 여기서는 주소 상태 → 섹션
 * 배치만 본다.
 */

interface Stay {
  savedStayId: string;
}

const JW: Stay = { savedStayId: 'jw' };
const DENBA: Stay = { savedStayId: 'denba' };
const PARA_1: Stay = { savedStayId: 'para-1' };
const PARA_2: Stay = { savedStayId: 'para-2' };

const SEOUL_ADDR: StayAddressState = {
  status: 'known',
  address: '서울특별시 종로구 청계천로 279',
};
const BUSAN_ADDR: StayAddressState = {
  status: 'known',
  address: '부산광역시 해운대구 해운대해변로 296',
};
const BUSAN_ABBR: StayAddressState = {
  status: 'known',
  address: '부산 금정구 구서동 1',
};

/** 섹션 배열에서 key 로 한 섹션을 찾는다(없으면 undefined). */
function section<T>(
  sections: StaySheetSection<T>[] | null,
  key: 'here' | 'other'
): StaySheetSection<T> | undefined {
  return sections?.find((one) => one.key === key);
}

/** 섹션 후보의 id 목록 — 요소(객체) 배열을 통째 toEqual 하지 않고 문자열 배열로 비교한다(★4). */
function ids(one: StaySheetSection<Stay> | undefined): string[] | undefined {
  return one?.candidates.map((stay) => stay.savedStayId);
}

describe('AC-4 · QA 재현(#036) — 서울 밤에 서울 1곳 / 부산 3곳', () => {
  it('"서울특별시 숙소"에 JW 1곳, "다른 지역"에 3곳 — 합치면 4곳(숨김 없음)', () => {
    const result = staySheetSections(
      [DENBA, JW, PARA_1, PARA_2],
      {
        jw: SEOUL_ADDR,
        denba: BUSAN_ABBR,
        'para-1': BUSAN_ADDR,
        'para-2': BUSAN_ADDR,
      },
      '서울특별시'
    );

    expect(result).not.toBeNull();
    expect(result?.map((one) => one.key)).toEqual(['here', 'other']);

    const here = section(result, 'here');
    const other = section(result, 'other');
    expect(here?.title).toBe('서울특별시 숙소');
    expect(ids(here)).toEqual(['jw']);
    expect(other?.title).toBe('다른 지역');
    // 입력 순서 보존 — denba 가 para 들보다 앞이다.
    expect(ids(other)).toEqual(['denba', 'para-1', 'para-2']);
  });
});

describe('AC-6 · 주소를 모르면 숨기지 않고 "다른 지역 · 위치 확인 안 됨" (INV-4 · 01b Q2·Q3)', () => {
  it('unknown·loading·기록 없음 숙소는 전부 "다른 지역"에 들어가고 헤더가 사실대로 바뀐다', () => {
    const noCoord = { savedStayId: 'no-coord' };
    const loading = { savedStayId: 'loading' };
    const missing = { savedStayId: 'missing' }; // 주소 맵에 항목 자체가 없다

    const result = staySheetSections(
      [JW, noCoord, loading, missing],
      {
        jw: SEOUL_ADDR,
        'no-coord': { status: 'unknown' },
        loading: { status: 'loading' },
      },
      '서울특별시'
    );

    expect(ids(section(result, 'here'))).toEqual(['jw']);
    expect(ids(section(result, 'other'))).toEqual([
      'no-coord',
      'loading',
      'missing',
    ]);
    expect(section(result, 'other')?.title).toBe('다른 지역 · 위치 확인 안 됨');
  });

  it('짝 · 다른 지역이 전부 주소 확인된 곳이면 헤더는 "다른 지역" 그대로다', () => {
    const result = staySheetSections(
      [JW, PARA_1],
      { jw: SEOUL_ADDR, 'para-1': BUSAN_ADDR },
      '서울특별시'
    );

    expect(section(result, 'other')?.title).toBe('다른 지역');
  });
});

describe('01b Q3 · 한쪽이 비면 null (헤더 없이 평면 목록)', () => {
  it('전부 그 밤 지역이면 null', () => {
    expect(
      staySheetSections(
        [JW, { savedStayId: 'jw-2' }],
        { jw: SEOUL_ADDR, 'jw-2': SEOUL_ADDR },
        '서울특별시'
      )
    ).toBeNull();
  });

  it('전부 다른 지역이면 null', () => {
    expect(
      staySheetSections(
        [PARA_1, DENBA],
        { 'para-1': BUSAN_ADDR, denba: BUSAN_ABBR },
        '서울특별시'
      )
    ).toBeNull();
  });

  it('AC-6 · 전부 조회 중이면 null — 섹션을 나누지 않은 평면 목록', () => {
    expect(
      staySheetSections(
        [JW, PARA_1],
        { jw: { status: 'loading' }, 'para-1': { status: 'loading' } },
        '서울특별시'
      )
    ).toBeNull();
  });

  it('후보 0곳이면 null', () => {
    expect(staySheetSections([], {}, '서울특별시')).toBeNull();
  });
});

describe('01b Q5 · "그 밤 지역"은 인자로 받은 한 곳이다', () => {
  it('같은 숙소들이라도 region 이 부산광역시면 부산 쪽이 첫 섹션이 된다', () => {
    const result = staySheetSections(
      [JW, PARA_1],
      { jw: SEOUL_ADDR, 'para-1': BUSAN_ADDR },
      '부산광역시'
    );

    expect(section(result, 'here')?.title).toBe('부산광역시 숙소');
    expect(ids(section(result, 'here'))).toEqual(['para-1']);
    expect(ids(section(result, 'other'))).toEqual(['jw']);
  });
});

describe('AC-4 · 속성 — 어떤 주소 상태 조합이든 숨김·중복이 없다 (PBT)', () => {
  const STATE = fc.constantFrom<StayAddressState | undefined>(
    SEOUL_ADDR,
    BUSAN_ADDR,
    BUSAN_ABBR,
    { status: 'unknown' },
    { status: 'loading' },
    undefined // 맵에 항목 없음
  );

  it('null 이 아니면 두 섹션 id 합집합 = 입력 id (순서 보존·중복 0), 둘 다 비지 않는다', () => {
    fc.assert(
      fc.property(fc.array(STATE, { maxLength: 8 }), (states) => {
        const stays = states.map((_, index) => ({
          savedStayId: `s${index}`,
        }));
        const addresses: Record<string, StayAddressState> = {};
        states.forEach((state, index) => {
          if (state !== undefined) addresses[`s${index}`] = state;
        });

        const result = staySheetSections(stays, addresses, '서울특별시');

        // 오라클 — 구현과 다른 길: "known 이고 주소가 서울로 시작" 여부로 기대 배치를 직접 만든다.
        const expectedHere = stays
          .filter((_, index) => states[index] === SEOUL_ADDR)
          .map((stay) => stay.savedStayId);
        const expectedOther = stays
          .filter((_, index) => states[index] !== SEOUL_ADDR)
          .map((stay) => stay.savedStayId);

        if (expectedHere.length === 0 || expectedOther.length === 0) {
          expect(result).toBeNull();
          return;
        }
        expect(ids(section(result, 'here'))).toEqual(expectedHere);
        expect(ids(section(result, 'other'))).toEqual(expectedOther);
      }),
      { numRuns: 300 }
    );
  });
});
