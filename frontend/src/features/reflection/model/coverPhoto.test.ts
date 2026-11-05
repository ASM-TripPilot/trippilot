import * as fc from 'fast-check';

import type { ActualVisit, VisitPhoto } from '@/shared/api/index.schemas';

import {
  COVER_CANDIDATE_LIMIT,
  coverCandidates,
  firstDevicePhotoId,
} from './coverPhoto';

/**
 * TRIP-1781 · 여행 표지 사진 후보 고르기 — 순수 함수 두 개의 계약(j04·j06 이 같은 사진을 쓰는 근거).
 * 초심자용: "후보"는 사진을 실제로 찾아볼 방문(최대 3곳)이다. `photoCount` 는 서버가 방문마다 주는 사진 **개수**(주소 아님).
 *
 * 무엇을 보장하나:
 *  - AC-1 건너뛴 방문·사진 0장 방문은 후보가 아니다. 사진이 많은 방문이 먼저, 같으면 목록(= 도착) 순서가 앞선 방문. 최대 3곳. 입력은 바뀌지 않는다.
 *  - AC-2(PBT) 어떤 입력이든 길이 ≤ 3, 결과는 전부 자격 있는 방문, 같은 입력은 같은 출력.
 *  - 방문 하나의 사진 목록에서는 `sortOrder` 가 가장 앞선 **이 기기** 사진 한 장의 앨범 id 를 고른다(다른 기기 사진은 건너뜀).
 *
 * 3동작: 준비(방문·사진 메타 목록) → 실행(순수 함수 호출) → 단언(고른 id 열).
 */

type VisitLike = Pick<
  ActualVisit,
  'visitCheckId' | 'poiId' | 'photoCount' | 'skippedAt'
>;

const visit = (
  id: string,
  photoCount: number,
  skippedAt?: string | null
): VisitLike => ({
  visitCheckId: id,
  poiId: `poi-${id}`,
  photoCount,
  ...(skippedAt !== undefined ? { skippedAt } : {}),
});

/** 깊게 얼린 사본 — 함수가 입력을 바꾸면(제자리 정렬 등) 얼린 객체 때문에 던진다. */
function frozen<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(frozen);
  else if (value && typeof value === 'object')
    Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

const ids = (list: readonly VisitLike[]) => list.map((v) => v.visitCheckId);

/** AC-1 입력: 사진 0·2·5·5·1·3장, 넷째(d)는 건너뜀. */
const AC1: VisitLike[] = [
  visit('a', 0),
  visit('b', 2),
  visit('c', 5),
  visit('d', 5, '2026-06-11T12:00:00Z'),
  visit('e', 1),
  visit('f', 3),
];

describe('coverCandidates (AC-1)', () => {
  it('CP-1 · 건너뜀·0장은 빠지고, 장수 내림차순으로 최대 3곳만 남는다 (c·f·b — e 는 잘린다)', () => {
    expect(ids(coverCandidates(AC1))).toEqual(['c', 'f', 'b']);
  });

  it('CP-2 · 장수가 같으면 목록(도착) 순서가 앞선 방문이 먼저다 — 입력 순서를 바꾸면 결과도 따라 바뀐다', () => {
    const list = [visit('c', 5), visit('d', 5), visit('f', 3)];
    expect(ids(coverCandidates(list))).toEqual(['c', 'd', 'f']);
    expect(ids(coverCandidates([list[1], list[0], list[2]]))).toEqual([
      'd',
      'c',
      'f',
    ]);
  });

  it.each([
    ['방문 0건', []],
    ['전부 0장', [visit('a', 0), visit('b', 0)]],
    ['장수가 음수', [visit('a', -1)]],
    ['전부 건너뜀', [visit('a', 4, 'x'), visit('b', 2, 'y')]],
  ])('CP-3 · %s → 후보가 없다(빈 배열)', (_name, list) => {
    expect(coverCandidates(list)).toEqual([]);
  });

  it('CP-4 · 입력을 바꾸지 않는다 — 깊게 얼린 입력에도 던지지 않고, 호출 뒤 내용이 그대로다', () => {
    const input = frozen(AC1.map((v) => ({ ...v })));
    const before = JSON.stringify(input);

    expect(() => coverCandidates(input)).not.toThrow();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('CP-5 · 후보 상한은 3곳이다', () => {
    expect(COVER_CANDIDATE_LIMIT).toBe(3);
  });
});

describe('coverCandidates · 속성 (AC-2, CI 차단 게이트)', () => {
  const skippedArb = fc.constantFrom<string | null | undefined>(
    null,
    undefined,
    '2026-06-11T09:00:00Z'
  );
  // 방문 id 가 겹치지 않게 위치를 붙인다(결과가 "어느 방문인가"를 id 로 말할 수 있도록).
  const visitsArb = fc
    .array(
      fc.record({
        photoCount: fc.integer({ min: -2, max: 9 }),
        skippedAt: skippedArb,
      }),
      {
        maxLength: 12,
      }
    )
    .map((rows) =>
      rows.map((row, i) => ({
        visitCheckId: `v${i}`,
        poiId: `poi-${i}`,
        photoCount: row.photoCount,
        ...(row.skippedAt === undefined ? {} : { skippedAt: row.skippedAt }),
      }))
    );

  const eligible = (v: VisitLike) => v.photoCount > 0 && v.skippedAt == null;

  it('AC-2 · 길이 ≤ 3 · 전부 자격 있는 방문 · 순서 규칙 · 안 뽑힌 자격 방문은 뽑힌 것보다 나쁘다 · 결정적 · 입력 불변', () => {
    fc.assert(
      fc.property(visitsArb, (list) => {
        const input = frozen(list.map((v) => ({ ...v })));
        const out = coverCandidates(input);
        const pos = (v: VisitLike) =>
          input.findIndex((x) => x.visitCheckId === v.visitCheckId);
        const pool = input.filter(eligible);

        expect(out.length).toBe(Math.min(COVER_CANDIDATE_LIMIT, pool.length));
        expect(out.every(eligible)).toBe(true);
        // 결과 사이: 장수 내림차순, 같으면 입력 위치 오름차순.
        out.slice(1).forEach((cur, i) => {
          const prev = out[i];
          expect(
            prev.photoCount > cur.photoCount ||
              (prev.photoCount === cur.photoCount && pos(prev) < pos(cur))
          ).toBe(true);
        });
        // 뽑히지 않은 자격 방문은 마지막으로 뽑힌 것보다 (장수가 적거나, 같고 더 뒤에 있다).
        const last = out[out.length - 1];
        pool
          .filter((v) => !ids(out).includes(v.visitCheckId))
          .forEach((rest) => {
            expect(
              last.photoCount > rest.photoCount ||
                (last.photoCount === rest.photoCount && pos(last) < pos(rest))
            ).toBe(true);
          });
        // 같은 입력은 같은 출력.
        expect(ids(coverCandidates(input))).toEqual(ids(out));
      }),
      { examples: [[AC1.map((v) => ({ ...v }))]] }
    );
  });
});

describe('firstDevicePhotoId', () => {
  const photo = (
    localAssetId: string,
    deviceId: string,
    sortOrder: number
  ): VisitPhoto => ({
    visitPhotoMetaId: `meta-${localAssetId}`,
    localAssetId,
    deviceId,
    sortOrder,
  });

  it('FD-1 · sortOrder 가 가장 앞선 이 기기 사진의 앨범 id — 앞선 다른 기기 사진은 건너뛴다', () => {
    const items = [
      photo('x', 'other', 0),
      photo('z', 'me', 1),
      photo('y', 'me', 2),
    ];
    expect(firstDevicePhotoId(items, 'me')).toBe('z');
  });

  it('FD-2 · 목록에 담긴 순서가 아니라 sortOrder 로 고른다', () => {
    const items = [
      photo('late', 'me', 2),
      photo('first', 'me', 0),
      photo('mid', 'me', 1),
    ];
    expect(firstDevicePhotoId(items, 'me')).toBe('first');
  });

  it.each([
    ['빈 목록', []],
    ['전부 다른 기기', [photo('x', 'other', 0), photo('y', 'other', 1)]],
  ])('FD-3 · %s → null', (_name, items) => {
    expect(firstDevicePhotoId(items, 'me')).toBeNull();
  });

  it('FD-4 · 속성: 내 기기 사진이 없으면 null, 있으면 그중 sortOrder 최솟값의 id 이며 입력은 그대로다', () => {
    const itemsArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 8 })
      .chain((orders) =>
        fc.tuple(
          fc.constant(orders),
          fc.array(fc.constantFrom('me', 'other'), {
            minLength: orders.length,
            maxLength: orders.length,
          })
        )
      )
      .map(([orders, devices]) =>
        orders.map((order, i) => photo(`asset-${i}`, devices[i], order))
      );

    fc.assert(
      fc.property(itemsArb, (list) => {
        const input = frozen(list.map((p) => ({ ...p })));
        const mine = input.filter((p) => p.deviceId === 'me');
        const got = firstDevicePhotoId(input, 'me');

        if (mine.length === 0) expect(got).toBeNull();
        else {
          const min = mine.reduce((a, b) =>
            b.sortOrder < a.sortOrder ? b : a
          );
          expect(got).toBe(min.localAssetId);
        }
      })
    );
  });
});
