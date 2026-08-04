import fc from 'fast-check';

import type { Place, SavedPlace } from '@/shared/api/generated/schemas';
import { PlaceDataStatus } from '@/shared/api/generated/schemas';

import { REMOVE_FAILURE_NOTICE } from './placeSaveGuard';
import { optimisticSavedPlaceId } from './savedPlaceIndex';
import { orderSavedPlaces, SAVED_PLACE_BADGE } from './savedPlaceList';

/**
 * A-2 · Seed Q3 · Q8 · N-1 — d02 담은 장소의 순수 판정 3종.
 *
 * 무엇을 보장하나:
 *  - **orderSavedPlaces** 가 `savedAt` 오름차순(담은 순서)으로 줄을 세우되, **낙관 표식 항목은
 *    임의의 `savedAt` 조합에서도 항상 맨 끝**에 둔다(01b Seed Q3). 낙관 항목의 `savedAt` 은
 *    서버가 아니라 **기기 시계**에서 오므로(`savedPlaces.ts:84`), 시계가 뒤로 밀린 단말에서는
 *    방금 담은 것이 목록 중간에 꽂힌다 — 그 자리를 표식으로 못박는다.
 *  - **SAVED_PLACE_BADGE** 가 `dataStatus` 4값을 전수 매핑한다(01b Seed Q8). 계약이 담기
 *    목록에 CLOSED·UNVERIFIED 도 넣는다고 적었고, 항목을 숨기는 것이 아니라 배지로 구분한다.
 *  - **REMOVE_FAILURE_NOTICE** 가 **해제** 실패 문구를 따로 갖는다. d04 의 `SAVE_FAILURE_NOTICE`
 *    는 전부 담기 기준("지금은 담을 수 없는 장소예요")이라 해제 화면에 그대로 쓰면 거짓말이다.
 *
 * 개념 두 가지만 적는다.
 *  - **PBT(속성 기반 테스트)**: 예제를 손으로 적는 대신 "어떤 입력에도 성립해야 하는 성질"을
 *    적으면 fast-check 가 임의 입력을 만들어 반례를 찾는다. 리포 CI 의 차단 게이트다.
 *  - **가짜 통과 방지 짝**: 입력을 그대로 돌려주는 항등 함수도 "낙관 항목이 일반 항목 뒤에
 *    있다" 같은 조건부 성질을 우연히 만족할 수 있다. 그래서 각 성질마다 **실제로 그 결과가
 *    나오는** 고정 입력을 역방향으로 함께 건다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **A. 영구 규칙 — 유지한다.** 정렬 축(담은 순서)과 낙관 표식 규칙은 화면이 순번 배지를 그리는
 * 한 유효하고, 모집단이 임의 입력이라 항목이 늘어도 갱신이 필요 없다.
 * **B. 이행 체크포인트 — 한시적.** §2-4·§2-5 문구를 리터럴로 고정한 TA-8·TA-9 는 문구 교체에
 * red 를 낸다. **B 카운터 = 0.** 정당한 문구 변경이 2회 red 를 내면 "키 전수 + 비어 있지 않음
 * + 담기 문구 미유입"만 남기고 리터럴 표를 뗀다.
 */

/** 계약 required 필드를 전부 채운 최소 Place — 정렬은 place 를 안 보지만 타입이 요구한다. */
function makePlace(poiId: string, overrides: Partial<Place> = {}): Place {
  return {
    poiId,
    nameKo: `장소-${poiId}`,
    category: '명소',
    lat: 35.1587,
    lng: 129.1604,
    region: '수영구',
    openingHours: null,
    imageUrl: null,
    tags: [],
    savedCount: 0,
    dataStatus: 'ACTIVE',
    ...overrides,
  };
}

function row(savedPlaceId: string, savedAt: string, poiId: string): SavedPlace {
  return { savedPlaceId, savedAt, place: makePlace(poiId) };
}

/** 낙관 행은 **실제 헬퍼로** 만든다 — `'optimistic:'` 문자열을 테스트가 따로 적어 두면
 * 규약이 두 곳에 생기고, 훅이 표식을 바꿀 때 이 파일만 조용히 낡는다. */
function optimisticRow(savedAt: string, poiId: string): SavedPlace {
  return row(optimisticSavedPlaceId(poiId), savedAt, poiId);
}

function isOptimistic(entry: SavedPlace): boolean {
  return entry.savedPlaceId === optimisticSavedPlaceId(entry.place.poiId);
}

function ids(entries: SavedPlace[]): string[] {
  return entries.map((entry) => entry.savedPlaceId);
}

/**
 * `savedAt` 생성 범위를 계약이 실제로 낼 수 있는 구간으로 묶는다.
 * 근거(실측): fast-check 4.9 의 `fc.date()` 는 기본값으로 `'+275760-09-12T…'`·
 * `'-271821-04-20T…'` 같은 **확장 연도 표기**를 만든다. 그 입력에서는 `Date.parse` 비교와
 * 문자열 비교의 답이 갈리는데, RFC3339(계약의 `date-time`)는 그런 값을 만들지 못한다.
 * 범위를 묶으면 두 구현이 **둘 다 정답**이 되고, PBT 가 구현 방식이 아니라 성질을 잰다.
 * 시계 역행(Seed Q3 의 실제 관심사)은 이 범위 안에서 충분히 생성된다.
 */
const RANGE_MIN = new Date('2020-01-01T00:00:00.000Z');
const RANGE_MAX = new Date('2030-12-31T23:59:59.999Z');

const savedAtArb = fc
  .date({ min: RANGE_MIN, max: RANGE_MAX, noInvalidDate: true })
  .map((date) => date.toISOString());

const poiIdArb = fc.uuid();

const normalRowArb = fc
  .record({ savedPlaceId: fc.uuid(), savedAt: savedAtArb, poiId: poiIdArb })
  .map(({ savedPlaceId, savedAt, poiId }) => row(savedPlaceId, savedAt, poiId));

const optimisticRowArb = fc
  .record({ savedAt: savedAtArb, poiId: poiIdArb })
  .map(({ savedAt, poiId }) => optimisticRow(savedAt, poiId));

const listArb = fc.array(fc.oneof(normalRowArb, optimisticRowArb), {
  maxLength: 12,
});

describe('orderSavedPlaces — 예제 (A-2 · 01b Seed Q2·Q3)', () => {
  it('담은 순서로 세우고, 동률은 id 순이며, 낙관 항목은 맨 끝이다', () => {
    // 준비 — 뒤섞인 4행. 낙관 행의 savedAt 은 **가장 이르다**(기기 시계가 뒤로 밀린 단말).
    const given: SavedPlace[] = [
      row('sp-c', '2026-08-02T09:00:00.000Z', 'p3'),
      optimisticRow('2019-01-01T00:00:00.000Z', 'p9'),
      row('sp-a', '2026-08-01T10:00:00.000Z', 'p1'),
      row('sp-b', '2026-08-01T10:00:00.000Z', 'p2'),
    ];

    // 실행
    const ordered = orderSavedPlaces(given);

    // 단언 — sp-a·sp-b 는 savedAt 동률이라 id 사전순으로 갈리고, 낙관 행은 제일 이른
    // savedAt 을 갖고도 맨 끝이다.
    expect(ids(ordered)).toEqual([
      'sp-a',
      'sp-b',
      'sp-c',
      optimisticSavedPlaceId('p9'),
    ]);
  });
});

describe('orderSavedPlaces — 성질 (PBT · A-2 · 01b Seed Q3)', () => {
  it('원소를 잃거나 만들지 않고, 같은 입력은 같은 순서를 낸다', () => {
    fc.assert(
      fc.property(listArb, (given) => {
        const first = orderSavedPlaces(given);
        const second = orderSavedPlaces(given);

        expect(first).toHaveLength(given.length);
        // 다중집합 비교 — 순서를 빼고 "같은 원소들인가"만 본다. 한 항목을 두 번 넣거나
        // 슬쩍 흘리는 구현을 잡는다.
        expect([...ids(first)].sort()).toEqual([...ids(given)].sort());
        // 결정론 — 같은 입력에서 순서가 흔들리면 화면의 순번 배지가 깜빡인다.
        expect(ids(second)).toEqual(ids(first));
      }),
      { numRuns: 500 }
    );
  });

  it('입력 배열을 제자리에서 바꾸지 않는다', () => {
    fc.assert(
      fc.property(listArb, (given) => {
        const before = ids(given);

        orderSavedPlaces(given);

        // TanStack Query 캐시가 준 배열을 제자리에서 흔들면 참조가 그대로라 리렌더 통지가
        // 새고, 화면이 옛 순서로 남는다(`visiblePlaces` 가 세운 리포 관례).
        expect(ids(given)).toEqual(before);
      }),
      { numRuns: 500 }
    );
  });

  it('낙관 표식 항목은 임의의 savedAt 조합에서도 일반 항목보다 뒤에 있다', () => {
    fc.assert(
      fc.property(listArb, (given) => {
        const ordered = orderSavedPlaces(given);

        const optimisticIdx = ordered.flatMap((entry, index) =>
          isOptimistic(entry) ? [index] : []
        );
        const normalIdx = ordered.flatMap((entry, index) =>
          isOptimistic(entry) ? [] : [index]
        );
        if (optimisticIdx.length === 0 || normalIdx.length === 0) return;

        expect(Math.min(...optimisticIdx)).toBeGreaterThan(
          Math.max(...normalIdx)
        );
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 — 낙관 항목이 **가장 이른** savedAt 을 가져도 실제로 맨 끝에 온다.
    // 위 성질만 두면 "입력을 그대로 돌려주는" 항등 함수가 우연히 통과할 수 있다.
    fc.assert(
      fc.property(
        fc.array(normalRowArb, { minLength: 1, maxLength: 6 }),
        poiIdArb,
        (normals, optimisticPoiId) => {
          const marked = optimisticRow(
            RANGE_MIN.toISOString(),
            optimisticPoiId
          );

          const ordered = orderSavedPlaces([marked, ...normals]);

          expect(ordered[ordered.length - 1].savedPlaceId).toBe(
            marked.savedPlaceId
          );
        }
      ),
      { numRuns: 500 }
    );
  });

  it('일반 항목 구간이 savedAt 오름차순이다', () => {
    fc.assert(
      fc.property(listArb, (given) => {
        const normals = orderSavedPlaces(given).filter(
          (entry) => !isOptimistic(entry)
        );

        normals.slice(1).forEach((entry, index) => {
          expect(Date.parse(normals[index].savedAt)).toBeLessThanOrEqual(
            Date.parse(entry.savedAt)
          );
        });
      }),
      { numRuns: 500 }
    );

    // 가짜 통과 방지 짝 ① — 내림차순으로 넣으면 **실제로 뒤집힌다**(항등 함수 차단).
    const descending: SavedPlace[] = [
      row('sp-3', '2026-08-03T00:00:00.000Z', 'p3'),
      row('sp-2', '2026-08-02T00:00:00.000Z', 'p2'),
      row('sp-1', '2026-08-01T00:00:00.000Z', 'p1'),
    ];
    expect(ids(orderSavedPlaces(descending))).toEqual(['sp-1', 'sp-2', 'sp-3']);
  });

  it('savedAt 이 같으면 savedPlaceId 사전순으로 결정적으로 갈린다', () => {
    fc.assert(
      fc.property(
        // 숫자 접미사만 다른 id — 코드유닛 비교와 로캘 비교의 답이 갈리지 않는 모양으로
        // 만든다(하이픈이 섞인 uuid 는 비교기마다 순서가 달라질 수 있다).
        fc.uniqueArray(fc.integer({ min: 100000, max: 999999 }), {
          minLength: 2,
          maxLength: 6,
        }),
        (numbers) => {
          const sameMoment = '2026-08-01T00:00:00.000Z';
          const given = numbers.map((n) =>
            row(`sp-${n}`, sameMoment, `p-${n}`)
          );

          const ordered = orderSavedPlaces(given);

          expect(ids(ordered)).toEqual([...ids(given)].sort());
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('SAVED_PLACE_BADGE — dataStatus 전수 (01b Seed Q8 · A-7)', () => {
  it('4값을 빠짐없이 매핑하고, ACTIVE 만 배지가 없다', () => {
    // 계약 enum 전수 — `Record<PlaceDataStatus, …>` 라 값이 늘면 tsc 가 먼저 깨지지만,
    // 그 전에 이 단언이 "표가 낡았다"를 읽을 수 있는 diff 로 남긴다.
    expect(Object.keys(SAVED_PLACE_BADGE).sort()).toEqual(
      Object.values(PlaceDataStatus).sort()
    );

    expect(SAVED_PLACE_BADGE).toEqual({
      ACTIVE: null,
      CLOSED: '폐업',
      UNVERIFIED: '미확인',
      LOST: '미확인',
    });

    // 긍정 짝 — 표 전체를 null 로 채워 배지를 없애 버리는 구현을 잡는다.
    const labelled = Object.entries(SAVED_PLACE_BADGE).filter(
      ([, label]) => label !== null
    );
    expect(labelled).toHaveLength(3);
    labelled.forEach(([status, label]) => {
      expect({ status, empty: label === '' }).toEqual({ status, empty: false });
    });
  });
});

describe('REMOVE_FAILURE_NOTICE — 해제 실패 4갈래 (N-1 · INV-4)', () => {
  it('갈래를 빠짐없이 덮고, 문구가 §2-4 표 그대로다', () => {
    // 키 전수 — `useSavedPlaces` 의 실패 갈래가 늘면 여기서 먼저 빨개진다.
    expect(Object.keys(REMOVE_FAILURE_NOTICE).sort()).toEqual([
      'network',
      'not-found',
      'saved-id-unknown',
      'unauthenticated',
    ]);

    expect(REMOVE_FAILURE_NOTICE).toEqual({
      unauthenticated: {
        message: '로그인이 풀렸어요. 다시 로그인해 주세요',
        action: 'login',
      },
      'saved-id-unknown': {
        message: '담기 처리 중이에요. 잠시 후 다시 시도해 주세요',
        action: null,
      },
      'not-found': {
        message: '지금은 해제할 수 없는 장소예요',
        action: null,
      },
      network: {
        message: '연결이 불안정해 해제하지 못했어요',
        action: 'retry',
      },
    });
  });

  it('담기 문구를 해제 화면에 재사용하지 않고, 404 의 원인을 단정하지 않는다', () => {
    const notFound = REMOVE_FAILURE_NOTICE['not-found'].message;
    const network = REMOVE_FAILURE_NOTICE.network.message;

    // 긍정 짝 — 문구가 실제로 채워져 있다(빈 문자열이면 아래 부정 단언이 공짜로 통과한다).
    expect(notFound.length).toBeGreaterThan(0);
    expect(network.length).toBeGreaterThan(0);

    // 부정 ① — d04 의 `SAVE_FAILURE_NOTICE` 를 그대로 가져다 쓰면 해제 실패인데 "담지
    // 못했다"가 떠서 화면이 거짓말한다. 이 칸의 가장 현실적인 결함 경로다.
    expect(notFound).not.toMatch(/담을 수 없|담지 못|담을 수 있/);
    expect(network).not.toMatch(/담을 수 없|담지 못|담을 수 있/);

    // 부정 ② — 계약은 404 하나로 "없음"과 "타 계정"을 준다. 구분해 주지 않는 원인을
    // 단정하면 사용자가 존재하지 않는 사실을 믿는다(TRIP-222 AC-G6 계승 · INV-1).
    expect(notFound).not.toMatch(/폐업|삭제|사라진|없어진|타 계정|권한/);
  });
});
