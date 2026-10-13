import fc from 'fast-check';

import {
  type StayAddressState,
  type StaySheetSection,
  staySheetRegionNotice,
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
 *  - **null = 평면 목록** 전부 그 밤 지역이거나, 후보가 0곳이거나, 그 밤 지역이 0곳인데 아직 조회 중인
 *    숙소(`loading` 또는 맵에 항목 없음)가 있을 때다 — "없다"를 아직 단정할 수 없다(TRIP-1273 01b Q5).
 *  - **그 밤 지역 0곳이면 "다른 지역" 한 섹션**(TRIP-1273 결정 1) 조회가 끝났으면 전부를 "다른 지역"
 *    섹션 하나로 묶는다 — 서울 숙소가 "2박 · 부산광역시" 시트에 구분 없이 나열되던 B-14 를 고친다.
 *    이때 주소가 전부 확인됐으면 `staySheetRegionNotice` 가 `{지역}에 저장한 숙소가 없어요` 를 낸다
 *    (모름이 섞이면 그 숙소가 실제로 그 지역일 수 있어 안내를 안 낸다 — 거짓 "없어요" 금지).
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

describe('01b Q3 · 평면 목록(null)이 되는 경우', () => {
  it('전부 그 밤 지역이면 null', () => {
    expect(
      staySheetSections(
        [JW, { savedStayId: 'jw-2' }],
        { jw: SEOUL_ADDR, 'jw-2': SEOUL_ADDR },
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

// TRIP-1273(B-14 · 결정 1 · 01b Q2·Q5) — 그 밤 지역 숙소가 0곳일 때. 옛 사양("전부 다른 지역이면 null")을
// 뒤집었다: 평면으로 접으면 다른 도시 숙소가 그 밤 숙소처럼 보인다(INV-4 성격의 침묵).
describe('그 밤 지역 숙소가 0곳이면 "다른 지역" 한 섹션으로 구분한다 (결정 1 · AC-B1·B5·B6)', () => {
  it('AC-B1 · 주소가 전부 확인됐고 전부 다른 지역이면 "다른 지역" 섹션 하나에 전부, 순서 그대로', () => {
    const result = staySheetSections(
      [PARA_1, DENBA],
      { 'para-1': BUSAN_ADDR, denba: BUSAN_ABBR },
      '서울특별시'
    );

    expect(result?.map((one) => one.key)).toEqual(['other']);
    expect(section(result, 'other')?.title).toBe('다른 지역');
    expect(ids(section(result, 'other'))).toEqual(['para-1', 'denba']);
  });

  it('AC-B6 · 조회는 끝났고 주소 모름이 섞이면 섹션은 나누되 제목이 "다른 지역 · 위치 확인 안 됨"', () => {
    const noCoord = { savedStayId: 'no-coord' };

    const result = staySheetSections(
      [PARA_1, noCoord],
      { 'para-1': BUSAN_ADDR, 'no-coord': { status: 'unknown' } },
      '서울특별시'
    );

    expect(result?.map((one) => one.key)).toEqual(['other']);
    expect(section(result, 'other')?.title).toBe('다른 지역 · 위치 확인 안 됨');
    expect(ids(section(result, 'other'))).toEqual(['para-1', 'no-coord']);
  });

  it('AC-B5 · 아직 조회 중인 숙소가 하나라도 있으면 null(평면) — "없다"를 단정하지 않는다', () => {
    expect(
      staySheetSections(
        [PARA_1, JW],
        { 'para-1': BUSAN_ADDR, jw: { status: 'loading' } },
        '서울특별시'
      )
    ).toBeNull();
  });

  it('AC-B5 · 주소 맵에 항목이 없는 숙소(판정 재료 없음)도 조회 중과 같이 null', () => {
    expect(
      staySheetSections([PARA_1, JW], { 'para-1': BUSAN_ADDR }, '서울특별시')
    ).toBeNull();
  });
});

describe('staySheetRegionNotice — 그 밤 지역 숙소 0곳 안내 문구 (01b Q2·Q5 · AC-B1·B3~B6)', () => {
  it('AC-B1 · 부산 밤에 서울 숙소만(주소 전부 확인) → "부산광역시에 저장한 숙소가 없어요"', () => {
    expect(
      staySheetRegionNotice(
        [JW, { savedStayId: 'jw-2' }],
        { jw: SEOUL_ADDR, 'jw-2': SEOUL_ADDR },
        '부산광역시'
      )
    ).toBe('부산광역시에 저장한 숙소가 없어요');
  });

  it.each<[string, Stay[], Record<string, StayAddressState>]>([
    // AC-B3 — 그 밤 지역 숙소가 있으면 안내 없음(무회귀).
    [
      '그 밤 지역 숙소가 1곳 이상',
      [JW, PARA_1],
      { jw: SEOUL_ADDR, 'para-1': BUSAN_ADDR },
    ],
    // AC-B4 — 전부 그 밤 지역.
    ['전부 그 밤 지역', [JW], { jw: SEOUL_ADDR }],
    // AC-B5 — 조회 중이 섞이면 아직 단정 못 한다.
    [
      '0곳이지만 조회 중이 섞임',
      [PARA_1, DENBA],
      { 'para-1': BUSAN_ADDR, denba: { status: 'loading' } },
    ],
    // AC-B5 — 맵에 항목 없음도 조회 중과 같다.
    [
      '0곳이지만 주소 맵에 항목 없음',
      [PARA_1, DENBA],
      { 'para-1': BUSAN_ADDR },
    ],
    // AC-B6 — 모름 숙소가 실제로 서울일 수 있다(거짓 "없어요" 금지).
    [
      '0곳이지만 주소 모름이 섞임',
      [PARA_1, DENBA],
      { 'para-1': BUSAN_ADDR, denba: { status: 'unknown' } },
    ],
    // 후보 0곳은 시트의 빈 상태가 따로 말한다.
    ['후보 0곳', [], {}],
  ])('%s → null', (_, stays, addresses) => {
    expect(staySheetRegionNotice(stays, addresses, '서울특별시')).toBeNull();
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

  // TRIP-1273 — 오라클을 새 사양으로 바꿨다(옛 오라클은 "here 0 → null"). 섹션 배치·제목·안내 문구를
  // 한 오라클로 함께 본다 — 두 함수가 같은 입력에서 서로 어긋나면(안내는 "없어요"인데 here 섹션이 있다 등) red.
  it('섹션 배치·제목·안내 문구가 오라클과 같고, 섹션 id 합집합 = 입력 id (순서 보존·중복 0)', () => {
    const LOADING: StayAddressState = { status: 'loading' };
    const UNKNOWN: StayAddressState = { status: 'unknown' };
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
        const notice = staySheetRegionNotice(stays, addresses, '서울특별시');

        // 오라클 — 구현과 다른 길: 상수 객체의 정체(=== SEOUL_ADDR 등)로 숙소마다 처지를 직접 센다.
        const idsWhere = (
          pick: (state: StayAddressState | undefined) => boolean
        ) =>
          stays
            .filter((_, index) => pick(states[index]))
            .map((stay) => stay.savedStayId);
        const expectedHere = idsWhere((state) => state === SEOUL_ADDR);
        const expectedOther = idsWhere((state) => state !== SEOUL_ADDR);
        const pending = idsWhere(
          (state) => state === undefined || state?.status === 'loading'
        );
        const notKnown = idsWhere((state) => state?.status !== 'known');
        const otherTitle = expectedOther.some((id) => notKnown.includes(id))
          ? '다른 지역 · 위치 확인 안 됨'
          : '다른 지역';

        // 안내 — 후보가 있고, 전부 주소 확인이고, 서울이 0곳일 때만.
        const expectedNotice =
          stays.length > 0 && notKnown.length === 0 && expectedHere.length === 0
            ? '서울특별시에 저장한 숙소가 없어요'
            : null;
        expect(notice).toBe(expectedNotice);

        if (expectedHere.length === 0) {
          if (stays.length === 0 || pending.length > 0) {
            expect(result).toBeNull();
            return;
          }
          // 결정 1 — "다른 지역" 한 섹션에 전부.
          expect(result?.map((one) => one.key)).toEqual(['other']);
          expect(section(result, 'other')?.title).toBe(otherTitle);
          expect(ids(section(result, 'other'))).toEqual(expectedOther);
          return;
        }
        if (expectedOther.length === 0) {
          expect(result).toBeNull();
          return;
        }
        expect(result?.map((one) => one.key)).toEqual(['here', 'other']);
        expect(ids(section(result, 'here'))).toEqual(expectedHere);
        expect(ids(section(result, 'other'))).toEqual(expectedOther);
        expect(section(result, 'other')?.title).toBe(otherTitle);
      }),
      {
        numRuns: 300,
        // 확률에 맡기지 않는 경계(README PBT 규칙) — here 0 의 네 갈래와 후보 0곳.
        examples: [
          [[BUSAN_ADDR, BUSAN_ABBR]], // 전부 확인 → other 한 섹션 + 안내
          [[BUSAN_ADDR, UNKNOWN]], // 모름 섞임 → other(위치 확인 안 됨) · 안내 없음
          [[BUSAN_ADDR, LOADING]], // 조회 중 → null · 안내 없음
          [[BUSAN_ADDR, undefined]], // 항목 없음 → null · 안내 없음
          [[]], // 후보 0곳 → null · 안내 없음
        ],
      }
    );
  });
});
