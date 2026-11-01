import fc from 'fast-check';

import {
  type StayAddressState,
  type StaySheetSection,
  staySheetCandidates,
  staySheetRegionNotice,
  staySheetSections,
} from './staySheetSections';

/**
 * TRIP-1011(#036) 숙소 선택 시트의 후보를 "그 밤 지역" / "위치 확인 안 됨" 두 섹션으로 가르는 순수 함수와,
 * TRIP-1703 이 더한 후보 거르기(`staySheetCandidates`).
 *
 * TRIP-1703 이 TRIP-1011 D8("숨기지 않는다")의 **known·밖 부분을 뒤집었다**: 주소가 확인되고 그 밤 지역 밖인 숙소는
 * 후보에서 빠진다. 주소를 모르거나(좌표 없음·주소 null·조회 실패) 조회 중인 숙소는 여전히 숨기지 않는다(fail-open · INV-4).
 *
 * 무엇을 보장하나:
 *  - **밖 제외(AC1)** `staySheetCandidates` 는 known·밖만 뺀다 — unknown·loading·맵에 항목 없음은 남는다. 순서 보존.
 *    `staySheetSections` 는 입력에 known·밖이 섞여 있어도 어느 섹션에도 담지 않는다(두 길이 어긋나지 않게).
 *  - **둘째 묶음 = 「위치 확인 안 됨」(AC3)** 제목에 「다른 지역」 글자가 없다.
 *  - **null = 평면 목록** 둘째 묶음이 0이거나(전부 here·후보 0곳), here 가 0인데 조회 중(`loading`·항목 없음)이
 *    섞였을 때(AC4).
 *  - **밤별(AC2)** "그 밤 지역"은 인자로 받은 한 곳이다.
 *  - **안내 문구(AC5)** `staySheetRegionNotice` 는 무변경 — 거르기 **전** 전체 목록을 받아 "단정할 수 있을 때만" 낸다.
 *
 * "그 밤 지역"의 판정 자체(정식·약칭 접기)는 `regionMatch.test.ts`가 잠근다. 여기서는 주소 상태 → 배치만 본다.
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

describe('AC1 · QA 재현(#036) — 서울 밤에 서울 1곳 / 부산 3곳 → 부산은 후보에서 빠진다 (TRIP-1703)', () => {
  const ADDRESSES: Record<string, StayAddressState> = {
    jw: SEOUL_ADDR,
    denba: BUSAN_ABBR,
    'para-1': BUSAN_ADDR,
    'para-2': BUSAN_ADDR,
  };
  const STAYS = [DENBA, JW, PARA_1, PARA_2];

  it('후보는 서울 1곳뿐이고, 섹션 함수는 전부 그 밤 지역이라 평면(null)이다', () => {
    const candidates = staySheetCandidates(STAYS, ADDRESSES, '서울특별시');

    expect(candidates.map((stay) => stay.savedStayId)).toEqual(['jw']);
    expect(staySheetSections(candidates, ADDRESSES, '서울특별시')).toBeNull();
  });

  it('M3 · 거르기 전 전체를 그대로 넘겨도 섹션 어디에도 부산이 없다 (두 길이 어긋나지 않는다)', () => {
    const result = staySheetSections(
      [...STAYS, { savedStayId: 'unk' }],
      { ...ADDRESSES, unk: { status: 'unknown' } },
      '서울특별시'
    );

    expect(ids(section(result, 'here'))).toEqual(['jw']);
    expect(ids(section(result, 'other'))).toEqual(['unk']);
  });
});

describe('AC3 · 주소를 모르면 숨기지 않고 「위치 확인 안 됨」 (INV-4 · D3)', () => {
  const noCoord = { savedStayId: 'no-coord' };
  const loading = { savedStayId: 'loading' };
  const missing = { savedStayId: 'missing' }; // 주소 맵에 항목 자체가 없다
  const addresses: Record<string, StayAddressState> = {
    jw: SEOUL_ADDR,
    'no-coord': { status: 'unknown' },
    loading: { status: 'loading' },
  };

  it('M2 · unknown·loading·기록 없음 숙소는 후보에 남고 둘째 묶음에 들어가며 제목은 「위치 확인 안 됨」이다', () => {
    const stays = [JW, noCoord, loading, missing];

    expect(
      staySheetCandidates(stays, addresses, '서울특별시').map(
        (stay) => stay.savedStayId
      )
    ).toEqual(['jw', 'no-coord', 'loading', 'missing']);
    const result = staySheetSections(stays, addresses, '서울특별시');
    expect(ids(section(result, 'here'))).toEqual(['jw']);
    expect(ids(section(result, 'other'))).toEqual([
      'no-coord',
      'loading',
      'missing',
    ]);
    // 완전 일치 — 「다른 지역」이 붙으면 red.
    expect(section(result, 'other')?.title).toBe('위치 확인 안 됨');
  });

  it('짝 · 지역 밖 known 하나가 섞여도 그것만 빠지고 나머지는 그대로다', () => {
    const stays = [JW, PARA_1, noCoord];

    expect(
      staySheetCandidates(
        stays,
        { ...addresses, 'para-1': BUSAN_ADDR },
        '서울특별시'
      ).map((stay) => stay.savedStayId)
    ).toEqual(['jw', 'no-coord']);
  });

  it('M4 · 그 밤 지역이 0곳이고 조회가 끝났으면(unknown 만) 「위치 확인 안 됨」 한 섹션이다', () => {
    const result = staySheetSections(
      [noCoord],
      { 'no-coord': { status: 'unknown' } },
      '서울특별시'
    );

    expect(result?.map((one) => one.key)).toEqual(['other']);
    expect(section(result, 'other')?.title).toBe('위치 확인 안 됨');
    expect(ids(section(result, 'other'))).toEqual(['no-coord']);
  });
});

describe('평면 목록(null)이 되는 경우', () => {
  it('전부 그 밤 지역이면 null', () => {
    expect(
      staySheetSections(
        [JW, { savedStayId: 'jw-2' }],
        { jw: SEOUL_ADDR, 'jw-2': SEOUL_ADDR },
        '서울특별시'
      )
    ).toBeNull();
  });

  it('AC4 · 전부 조회 중이면 null — 섹션을 나누지 않은 평면 목록', () => {
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

  it('M5 · 아직 조회 중인 숙소가 하나라도 있고 그 밤 지역이 0곳이면 null — "없다"를 단정하지 않는다', () => {
    expect(
      staySheetSections(
        [PARA_1, JW],
        { 'para-1': BUSAN_ADDR, jw: { status: 'loading' } },
        '서울특별시'
      )
    ).toBeNull();
  });

  it('M5 · 주소 맵에 항목이 없는 숙소(판정 재료 없음)도 조회 중과 같이 null', () => {
    expect(
      staySheetSections([PARA_1, JW], { 'para-1': BUSAN_ADDR }, '서울특별시')
    ).toBeNull();
  });
});

describe('AC5 · 전부 지역 밖 known 이면 후보 0곳이고 안내 문구가 말한다', () => {
  const ADDRESSES: Record<string, StayAddressState> = {
    'para-1': BUSAN_ADDR,
    denba: BUSAN_ABBR,
  };
  const STAYS = [PARA_1, DENBA];

  it('M6 · 후보 [] · 섹션 null · 안내 "서울특별시에 저장한 숙소가 없어요" (안내는 거르기 전 목록으로 만든다)', () => {
    expect(staySheetCandidates(STAYS, ADDRESSES, '서울특별시')).toEqual([]);
    expect(staySheetSections(STAYS, ADDRESSES, '서울특별시')).toBeNull();
    expect(staySheetRegionNotice(STAYS, ADDRESSES, '서울특별시')).toBe(
      '서울특별시에 저장한 숙소가 없어요'
    );
  });

  it('짝 · 걸러진 뒤의 빈 목록으로는 안내를 못 만든다 — 호출부가 전체 목록을 넘겨야 하는 이유', () => {
    const filtered = staySheetCandidates(STAYS, ADDRESSES, '서울특별시');

    expect(staySheetRegionNotice(filtered, ADDRESSES, '서울특별시')).toBeNull();
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

describe('AC2 · "그 밤 지역"은 인자로 받은 한 곳이다 (밤별)', () => {
  it('M7 · 같은 숙소들이라도 region 이 부산광역시면 부산 숙소만 후보이고 서울 숙소가 빠진다', () => {
    const addresses = { jw: SEOUL_ADDR, 'para-1': BUSAN_ADDR };
    const stays = [JW, PARA_1];

    const candidates = staySheetCandidates(stays, addresses, '부산광역시');

    expect(candidates.map((stay) => stay.savedStayId)).toEqual(['para-1']);
    expect(staySheetSections(candidates, addresses, '부산광역시')).toBeNull();
    // 반대 밤 — 서울이면 서울만.
    expect(
      staySheetCandidates(stays, addresses, '서울특별시').map(
        (stay) => stay.savedStayId
      )
    ).toEqual(['jw']);
  });
});

describe('속성 — 어떤 주소 상태 조합이든 지역 밖 known 만 빠지고 나머지는 숨김·중복이 없다 (PBT)', () => {
  const STATE = fc.constantFrom<StayAddressState | undefined>(
    SEOUL_ADDR,
    BUSAN_ADDR,
    BUSAN_ABBR,
    { status: 'unknown' },
    { status: 'loading' },
    undefined // 맵에 항목 없음
  );

  // TRIP-1703 — 오라클을 새 사양으로 교체했다(옛: 합집합 = 입력 전부). 후보·섹션·안내 문구를 한 오라클로 함께 본다.
  it('후보 = 입력 − known·밖, 섹션 배치·제목·안내가 오라클과 같고, 섹션 합집합 = 후보 (순서 보존·중복 0)', () => {
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

        const candidates = staySheetCandidates(stays, addresses, '서울특별시');
        const result = staySheetSections(stays, addresses, '서울특별시');
        const filteredResult = staySheetSections(
          candidates,
          addresses,
          '서울특별시'
        );
        const notice = staySheetRegionNotice(stays, addresses, '서울특별시');

        // 오라클 — 구현과 다른 길: 상수 객체의 정체(=== SEOUL_ADDR 등)로 숙소마다 처지를 직접 센다.
        const idsWhere = (
          pick: (state: StayAddressState | undefined) => boolean
        ) =>
          stays
            .filter((_, index) => pick(states[index]))
            .map((stay) => stay.savedStayId);
        const isOutside = (state: StayAddressState | undefined) =>
          state === BUSAN_ADDR || state === BUSAN_ABBR;
        const expectedHere = idsWhere((state) => state === SEOUL_ADDR);
        const expectedOther = idsWhere(
          (state) => state !== SEOUL_ADDR && !isOutside(state)
        );
        const expectedCandidates = idsWhere((state) => !isOutside(state));
        const pending = idsWhere(
          (state) => state === undefined || state?.status === 'loading'
        );
        const notKnown = idsWhere((state) => state?.status !== 'known');

        // 후보 — known·밖만 빠진다(입력 순서 부분열).
        expect(candidates.map((stay) => stay.savedStayId)).toEqual(
          expectedCandidates
        );

        // 안내 — 후보가 있고, 전부 주소 확인이고, 서울이 0곳일 때만(무변경).
        const expectedNotice =
          stays.length > 0 && notKnown.length === 0 && expectedHere.length === 0
            ? '서울특별시에 저장한 숙소가 없어요'
            : null;
        expect(notice).toBe(expectedNotice);

        // 섹션 — 거르기 전/후 입력에서 같은 결과(두 길이 어긋나지 않는다).
        expect(filteredResult).toEqual(result);
        if (expectedOther.length === 0) {
          expect(result).toBeNull();
          return;
        }
        if (expectedHere.length === 0) {
          if (pending.length > 0) {
            expect(result).toBeNull();
            return;
          }
          expect(result?.map((one) => one.key)).toEqual(['other']);
        } else {
          expect(result?.map((one) => one.key)).toEqual(['here', 'other']);
          expect(section(result, 'here')?.title).toBe('서울특별시 숙소');
          expect(ids(section(result, 'here'))).toEqual(expectedHere);
        }
        expect(section(result, 'other')?.title).toBe('위치 확인 안 됨');
        expect(ids(section(result, 'other'))).toEqual(expectedOther);
      }),
      {
        numRuns: 300,
        // 확률에 맡기지 않는 경계(README PBT 규칙) — 전부 밖 / 밖+모름 / 밖+조회 중 / 밖+항목 없음 / 후보 0곳.
        examples: [
          [[BUSAN_ADDR, BUSAN_ABBR]], // 전부 known·밖 → 후보 [] · 섹션 null · 안내
          [[BUSAN_ADDR, UNKNOWN]], // 밖+모름 → other(unknown) 한 섹션 · 안내 없음
          [[BUSAN_ADDR, LOADING]], // 밖+조회 중 → null(평면, 후보는 조회 중 하나) · 안내 없음
          [[BUSAN_ADDR, undefined]], // 밖+항목 없음 → null · 안내 없음
          [[]], // 후보 0곳 → null · 안내 없음
        ],
      }
    );
  });
});
