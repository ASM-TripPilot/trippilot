import fc from 'fast-check';

import type {
  ItineraryUnplacedMustVisitsItem,
  ItineraryUnplacedMustVisitsItemReasonCode,
  Place,
  SavedPlace,
} from '@/shared/api/generated/schemas';

import { MUST_VISIT_NAME_PLACEHOLDER } from './mustVisitList';
import { resolveUnplacedNames } from './unplacedMustVisits';

/**
 * TRIP-1094 · 서버가 보낸 "넣지 못한 꼭 갈 곳"(`unplacedMustVisits`)에 **담은 장소의 이름**을 붙이는 순수 함수.
 *
 * 무엇을 보장하나:
 *  - 조인 키는 `unplaced.poiId === SavedPlace.place.poiId` 하나다(Seed Q1).
 *  - 이름을 못 찾아도 항목을 빼지 않고 `name: null` 로 둔다 — 대체 이름을 지어내지 않는다(결정 3 · INV-4).
 *  - 서버 문구(`message`)는 한 글자도 안 바꾼다. 행에는 `reasonCode` 가 없다 — 화면이 사유로 분기할
 *    통로가 자료형 단계에서 없다(AC-8, `joinMustVisits` 가 `dwellMin` 을 빼는 것과 같은 수법).
 *
 * 3동작 뼈대: 준비=서버 응답 모양 → 실행=함수 호출 → 단언=돌아온 행.
 */

/** 서버 `UnplacedText.kt` 원문 — 테스트가 문구를 지어내지 않는다. */
const MSG = {
  OUT_OF_RANGE:
    '여행 기간 밖 날짜로 지정돼 있어 넣지 못했어요. 날짜를 여행 기간 안으로 바꿔 주세요.',
  WINDOW_CONFLICT:
    '다른 필수 방문지와 시간이 겹쳐 넣지 못했어요. 한쪽 시각을 옮겨 주세요.',
  NO_FEASIBLE_SLOT:
    '남은 시간과 이동을 고려하면 넣을 자리가 없었어요. 시각 고정을 풀거나 일정을 줄여 보세요.',
  UNKNOWN: '넣지 못했어요. 사유를 확인하지 못했습니다.',
} as const;

/** openapi `Place.required` 를 그대로 채운다. */
function place(poiId: string, nameKo: string): Place {
  return {
    poiId,
    nameKo,
    category: '명소',
    lat: 33.458,
    lng: 126.942,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
  };
}

function saved(poiId: string, nameKo: string): SavedPlace {
  return {
    savedPlaceId: `sp-${poiId}`,
    savedAt: '2026-08-01T10:00:00.000Z',
    place: place(poiId, nameKo),
  };
}

function unplaced(
  poiId: string,
  reasonCode: ItineraryUnplacedMustVisitsItemReasonCode
): ItineraryUnplacedMustVisitsItem {
  return { poiId, reasonCode, message: MSG[reasonCode] };
}

describe('M1 · AC-2 — 담은 장소에 있으면 그 이름이 붙고, 행은 poiId·name·message 세 키뿐이다', () => {
  it('두 건 모두 이름이 해소되고 입력 순서·서버 문구가 그대로다', () => {
    // 준비
    const input = {
      unplaced: [
        unplaced('poi-1', 'NO_FEASIBLE_SLOT'),
        unplaced('poi-2', 'WINDOW_CONFLICT'),
      ],
      savedPlaces: [saved('poi-2', '우도'), saved('poi-1', '성산일출봉')],
    };

    // 실행
    const rows = resolveUnplacedNames(input);

    // 단언 — toStrictEqual 은 여분 키(예: reasonCode)가 있으면 실패한다(02a ★14).
    expect(rows).toStrictEqual([
      { poiId: 'poi-1', name: '성산일출봉', message: MSG.NO_FEASIBLE_SLOT },
      { poiId: 'poi-2', name: '우도', message: MSG.WINDOW_CONFLICT },
    ]);
  });
});

describe('M2~M4 · AC-3 — 이름을 못 찾아도 항목은 빠지지 않고 name 이 null 이다 (INV-4)', () => {
  it('M2 · 가운데 것만 담겨 있으면 앞뒤는 null, 길이·순서·문구는 보존된다', () => {
    const rows = resolveUnplacedNames({
      unplaced: [
        unplaced('poi-1', 'OUT_OF_RANGE'),
        unplaced('poi-2', 'NO_FEASIBLE_SLOT'),
        unplaced('poi-3', 'UNKNOWN'),
      ],
      savedPlaces: [saved('poi-2', '한라산'), saved('poi-9', '다른 곳')],
    });

    expect(rows).toStrictEqual([
      { poiId: 'poi-1', name: null, message: MSG.OUT_OF_RANGE },
      { poiId: 'poi-2', name: '한라산', message: MSG.NO_FEASIBLE_SLOT },
      { poiId: 'poi-3', name: null, message: MSG.UNKNOWN },
    ]);
  });

  it('M3 · 담은 장소가 빈 배열이면(조회 실패·대기 중·게스트) 전 항목 null 로 남는다', () => {
    const rows = resolveUnplacedNames({
      unplaced: [
        unplaced('poi-1', 'NO_FEASIBLE_SLOT'),
        unplaced('poi-2', 'WINDOW_CONFLICT'),
      ],
      savedPlaces: [],
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.name)).toEqual([null, null]);
    expect(rows.map((row) => row.message)).toEqual([
      MSG.NO_FEASIBLE_SLOT,
      MSG.WINDOW_CONFLICT,
    ]);
  });

  it('M4 · 이름 자리에 대체 이름(h02 의 「이름을 불러오지 못한 곳」 포함)을 넣지 않는다', () => {
    const [row] = resolveUnplacedNames({
      unplaced: [unplaced('poi-1', 'NO_FEASIBLE_SLOT')],
      savedPlaces: [],
    });

    // h02 목록은 대체 이름을 쓰지만(사용자 동결), 이 칸의 결정 3 은 반대다 — 이웃 선례를 따라가면 여기서 red.
    expect(row.name).toBeNull();
    expect(row.name).not.toBe(MUST_VISIT_NAME_PLACEHOLDER);
    expect(row.name).not.toBe('알 수 없는 장소');
  });
});

describe('M5 · AC-7 — 미배치가 없으면(빈 배열 · 필드 없음) 빈 목록이다 (계약 M2)', () => {
  it.each([
    ['필드 없음(undefined)', undefined],
    ['빈 배열', []],
  ])('%s → []', (_label, input) => {
    expect(
      resolveUnplacedNames({
        unplaced: input,
        savedPlaces: [saved('poi-1', '성산일출봉')],
      })
    ).toEqual([]);
  });
});

describe('M6 · AC-9 — 목록 밖 reasonCode 가 와도 던지지 않고 message 를 그대로 둔다', () => {
  it('reasonCode "SOMETHING_NEW" → throw 없음, 문구 보존', () => {
    const item = {
      poiId: 'poi-1',
      reasonCode: 'SOMETHING_NEW',
      message: MSG.UNKNOWN,
    } as unknown as ItineraryUnplacedMustVisitsItem;

    const run = () =>
      resolveUnplacedNames({ unplaced: [item], savedPlaces: [] });

    expect(run).not.toThrow();
    expect(run()).toStrictEqual([
      { poiId: 'poi-1', name: null, message: MSG.UNKNOWN },
    ]);
  });
});

// ── AC-4 · 속성 기반 테스트(fast-check) ─────────────────────────────────────────────────────
// fast-check 는 무작위 입력을 수백 개 만들어 "어떤 입력에도 성립해야 하는 규칙"을 검사한다. 한 번이라도
// 깨지면 가장 작은 반례로 줄여 보여 준다. poiId 를 작은 풀에서 뽑는 이유는 02a ★13.

const POI_POOL = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const REASONS = Object.keys(MSG) as ItineraryUnplacedMustVisitsItemReasonCode[];

const unplacedArb = fc.array(
  fc.record({
    poiId: fc.constantFrom(...POI_POOL),
    reasonCode: fc.constantFrom(...REASONS),
    message: fc.string(),
  }),
  { maxLength: 8 }
);

/** 담은 장소는 poiId 가 유일하다(같은 장소를 두 번 담지 않는다). */
const savedArb = fc
  .uniqueArray(
    fc.record({
      poiId: fc.constantFrom(...POI_POOL),
      nameKo: fc.string({ minLength: 1 }),
    }),
    { selector: (entry) => entry.poiId, maxLength: POI_POOL.length }
  )
  .map((entries) => entries.map((entry) => saved(entry.poiId, entry.nameKo)));

describe('P1~P4 · AC-4 — 어떤 입력에도 성립하는 규칙 (차단 게이트)', () => {
  it('P1 · 출력 길이 = 입력 unplaced 길이 (하나도 빠지거나 늘지 않는다)', () => {
    fc.assert(
      fc.property(unplacedArb, savedArb, (items, savedPlaces) => {
        const rows = resolveUnplacedNames({ unplaced: items, savedPlaces });
        expect(rows).toHaveLength(items.length);
      })
    );
  });

  it('P2 · 같은 인덱스끼리 poiId·message 가 동일하다 (순서 보존 · 문구 무가공)', () => {
    fc.assert(
      fc.property(unplacedArb, savedArb, (items, savedPlaces) => {
        const rows = resolveUnplacedNames({ unplaced: items, savedPlaces });
        rows.forEach((row, index) => {
          expect(row.poiId).toBe(items[index].poiId);
          expect(row.message).toBe(items[index].message);
        });
      })
    );
  });

  it('P3 · name 은 null 이거나, 같은 poiId 담은 장소의 nameKo 와 정확히 같다 (지어낸 이름 0 · INV-1)', () => {
    fc.assert(
      fc.property(unplacedArb, savedArb, (items, savedPlaces) => {
        const rows = resolveUnplacedNames({ unplaced: items, savedPlaces });
        rows.forEach((row) => {
          if (row.name === null) return;
          const match = savedPlaces.find(
            (entry) => entry.place.poiId === row.poiId
          );
          expect(match).toBeDefined();
          expect(row.name).toBe(match?.place.nameKo);
        });
      })
    );
  });

  it('P4 · 담은 장소에 그 poiId 가 있으면 name 은 null 이 아니다 (해소 누락 0)', () => {
    fc.assert(
      fc.property(unplacedArb, savedArb, (items, savedPlaces) => {
        const rows = resolveUnplacedNames({ unplaced: items, savedPlaces });
        rows.forEach((row) => {
          const isSaved = savedPlaces.some(
            (entry) => entry.place.poiId === row.poiId
          );
          if (isSaved) expect(row.name).not.toBeNull();
        });
      })
    );
  });
});

describe('P5 · AC-4·AC-9 — reasonCode 가 아무 문자열이어도 던지지 않고 P1·P2 가 성립한다', () => {
  it('임의 문자열 reasonCode → throw 없음 · 길이·poiId·message 보존', () => {
    const wildArb = fc.array(
      fc.record({
        poiId: fc.constantFrom(...POI_POOL),
        reasonCode: fc.string(),
        message: fc.string(),
      }),
      { maxLength: 8 }
    );

    fc.assert(
      fc.property(wildArb, savedArb, (items, savedPlaces) => {
        const rows = resolveUnplacedNames({
          unplaced: items as unknown as ItineraryUnplacedMustVisitsItem[],
          savedPlaces,
        });
        expect(rows).toHaveLength(items.length);
        rows.forEach((row, index) => {
          expect(row.poiId).toBe(items[index].poiId);
          expect(row.message).toBe(items[index].message);
        });
      })
    );
  });
});
