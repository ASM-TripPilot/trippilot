import fc from 'fast-check';

import type {
  AssignBaseRequest,
  BaseAssignment,
} from '@/shared/api/generated/schemas';

import { planBaseAssign, type BaseAssignPlan } from './baseAssignPlan';

/**
 * TRIP-1011 C(#039) · 01b Q1(a) — 거점 지정을 **교체**로 계획하는 순수 함수.
 *
 * 왜 필요한가: 서버 `POST /trips/{id}/bases` 는 기존 배정을 보지 않고 행을 하나 더 만든다. 이미
 * 숙소가 정해진 밤에 다른 숙소를 POST 만 하면 그 밤이 겹침(OVERLAP)이 되고, 서버는 그 밤을 일정
 * 생성의 출발점에서 조용히 뺀다. 카드엔 옛 숙소 이름이 그대로 남는다(브리프 §2②).
 * 그래서 지정 = "그 밤을 덮는 배정 지우기 → 그 배정의 남은 구간 다시 붙이기 → 새 배정 붙이기".
 *
 * 무엇을 보장하나(속성, 임의 배정 목록·밤·숙소에 대해):
 *  - P1 계획대로 적용하면 **그 밤을 덮는 배정은 정확히 1개**이고, 그 숙소는 고른 숙소다.
 *  - P2 **다른 밤을 덮는 숙소 목록은 그대로**다(여러 밤짜리 배정을 쪼개도 남은 밤은 같은 숙소).
 *  - P3 그 밤을 이미 고른 숙소 **하나만** 덮고 있으면 계획이 비었다(요청 0건).
 *  - P4 지우는 배정은 전부 그 밤과 겹친다(상관없는 배정은 건드리지 않는다) · 같은 id 를 두 번 안 지운다.
 *  - P5 보내는 요청은 전부 빈 구간이 아니다(`dateFrom < dateTo`).
 *
 * 커버하지 않는 것: 요청을 **보내는 순서**와 실패 처리 — 그건 실제로 나간 요청을 보는 페이지 통합
 * 테스트(`TripBasesPage.integration.test.tsx`) 몫이다. 여러 밤짜리 **요청**(h15 전 기간 지정)은
 * 이 함수의 입력 타입상 가능하지만 이번 AC 밖이라 속성 생성기는 한 밤 요청만 만든다.
 *
 * 3동작: 준비(배정 목록·요청) → 실행(planBaseAssign 1회) → 단언(계획, 또는 계획을 적용한 결과).
 */

// ── 날짜 헬퍼 (테스트 쪽 오라클 — 구현과 다른 길로 만든다) ─────────────────────

/** 2026-09-20 에서 offset 일 뒤의 ISO 날짜. 9월 말 → 10월로 넘어가 월 경계도 생성기에 들어온다. */
function iso(offset: number): string {
  return new Date(Date.UTC(2026, 8, 20 + offset)).toISOString().slice(0, 10);
}

/** 한 밤 요청 — 체크아웃은 다음 날(배타). */
function night(savedStayId: string, offset: number): AssignBaseRequest {
  return { savedStayId, dateFrom: iso(offset), dateTo: iso(offset + 1) };
}

function assignment(
  baseAssignmentId: string,
  savedStayId: string,
  fromOffset: number,
  nights: number
): BaseAssignment {
  return {
    baseAssignmentId,
    savedStayId,
    dateFrom: iso(fromOffset),
    dateTo: iso(fromOffset + nights),
  };
}

/** 배정이 그 날(밤)을 덮는가 — `[dateFrom, dateTo)`. ISO 날짜는 문자열 비교가 곧 날짜 비교다. */
function covers(range: { dateFrom: string; dateTo: string }, day: string) {
  return range.dateFrom <= day && day < range.dateTo;
}

/** 계획을 서버에 적용한 뒤의 배정 목록을 흉내낸다 — 지우고, 보낸 것을 새 id 로 더한다. */
function apply(
  current: readonly BaseAssignment[],
  plan: BaseAssignPlan
): BaseAssignment[] {
  const kept = current.filter(
    (row) => !plan.deleteIds.includes(row.baseAssignmentId)
  );
  const added = plan.posts.map((post, index) => ({
    ...post,
    baseAssignmentId: `new-${index}`,
  }));
  return [...kept, ...added];
}

/** 그 날을 덮는 숙소 id 목록(정렬) — "덮개가 그대로인가"를 비교하는 단위. */
function stayIdsCovering(rows: readonly BaseAssignment[], day: string) {
  return rows
    .filter((row) => covers(row, day))
    .map((row) => row.savedStayId)
    .sort();
}

/** 보낸 요청을 순서와 상관없이 비교하려고 문자열 키로 바꾼다. */
function postKeys(posts: readonly AssignBaseRequest[]): string[] {
  return posts
    .map((post) => `${post.savedStayId}|${post.dateFrom}|${post.dateTo}`)
    .sort();
}

// ── 예시 (AC-C6 의 세 장면을 그대로) ──────────────────────────────────────────

describe('예시 · AC-C6 장면 그대로', () => {
  it('아무 배정도 없는 밤이면 새 배정 하나만 보낸다 (지울 것 없음)', () => {
    const plan = planBaseAssign([], night('stay-b', 1));

    expect(plan).toEqual({ deleteIds: [], posts: [night('stay-b', 1)] });
  });

  it('1박짜리 A 가 있는 밤을 B 로 바꾸면 — A 를 지우고 B 를 보낸다', () => {
    const current = [assignment('a1', 'stay-a', 0, 1)];

    const plan = planBaseAssign(current, night('stay-b', 0));

    expect(plan).toEqual({ deleteIds: ['a1'], posts: [night('stay-b', 0)] });
  });

  it('A 가 1–3박을 한 배정으로 덮을 때 2박만 B 로 바꾸면 — A 를 지우고 A[1박]·A[3박]·B[2박] 을 보낸다', () => {
    // 밤 0·1·2 = 1·2·3박. 2박 = offset 1.
    const current = [assignment('a', 'stay-a', 0, 3)];

    const plan = planBaseAssign(current, night('stay-b', 1));

    expect(plan.deleteIds).toEqual(['a']);
    // 보내는 순서는 계약이 아니다(브리프 AC-C6 "또는 같은 결과를 내는 순서") — 집합으로 잰다.
    expect(postKeys(plan.posts)).toEqual(
      postKeys([night('stay-a', 0), night('stay-a', 2), night('stay-b', 1)])
    );
  });

  it('같은 숙소를 다시 고르면 계획이 비었다 (요청 0건)', () => {
    const current = [assignment('a1', 'stay-a', 0, 1)];

    expect(planBaseAssign(current, night('stay-a', 0))).toEqual({
      deleteIds: [],
      posts: [],
    });
  });

  it('여러 밤짜리 A 의 가운데 밤에 A 를 다시 골라도 계획이 비었다 (쪼개지 않는다)', () => {
    const current = [assignment('a', 'stay-a', 0, 3)];

    expect(planBaseAssign(current, night('stay-a', 1))).toEqual({
      deleteIds: [],
      posts: [],
    });
  });

  it('다른 밤의 배정은 건드리지 않는다 — 1박 A·2박 C 에서 1박만 B 로 바꾸면 C 는 그대로', () => {
    const current = [
      assignment('a1', 'stay-a', 0, 1),
      assignment('c1', 'stay-c', 1, 1),
    ];

    const plan = planBaseAssign(current, night('stay-b', 0));

    expect(plan).toEqual({ deleteIds: ['a1'], posts: [night('stay-b', 0)] });
  });
});

// ── 속성 ──────────────────────────────────────────────────────────────────────

const STAY_ARB = fc.constantFrom('stay-a', 'stay-b', 'stay-c');

/** 임의 배정 목록 — 겹침(OVERLAP)·같은 숙소 여러 줄·여러 밤짜리가 다 나온다. id 는 유일. */
const CURRENT_ARB = fc
  .array(
    fc.record({
      savedStayId: STAY_ARB,
      fromOffset: fc.integer({ min: 0, max: 8 }),
      nights: fc.integer({ min: 1, max: 4 }),
    }),
    { maxLength: 6 }
  )
  .map((rows) =>
    rows.map((row, index) =>
      assignment(`ba-${index}`, row.savedStayId, row.fromOffset, row.nights)
    )
  );

/** 한 밤 요청 — 배정이 없는 밤·겹친 밤·처음 보는 숙소(stay-d)까지. */
const REQUEST_ARB = fc.record({
  savedStayId: fc.constantFrom('stay-a', 'stay-b', 'stay-c', 'stay-d'),
  offset: fc.integer({ min: 0, max: 12 }),
});

/** 비교할 날의 창 — 생성기가 만드는 모든 배정·요청을 덮는다. */
const DAY_WINDOW = Array.from({ length: 16 }, (_, index) => iso(index - 1));

describe('속성 · 적용 후 그 밤을 덮는 배정은 1개, 다른 밤은 그대로 (01b Q1(a) PBT)', () => {
  it('P1 · 그 밤을 덮는 배정은 정확히 1개이고 고른 숙소다', () => {
    fc.assert(
      fc.property(CURRENT_ARB, REQUEST_ARB, (current, req) => {
        const request = night(req.savedStayId, req.offset);

        const after = apply(current, planBaseAssign(current, request));

        expect(stayIdsCovering(after, request.dateFrom)).toEqual([
          req.savedStayId,
        ]);
      }),
      { numRuns: 500 }
    );
  });

  it('P2 · 다른 밤을 덮는 숙소 목록은 바뀌지 않는다', () => {
    fc.assert(
      fc.property(CURRENT_ARB, REQUEST_ARB, (current, req) => {
        const request = night(req.savedStayId, req.offset);

        const after = apply(current, planBaseAssign(current, request));

        DAY_WINDOW.filter((day) => day !== request.dateFrom).forEach((day) =>
          expect(stayIdsCovering(after, day)).toEqual(
            stayIdsCovering(current, day)
          )
        );
      }),
      { numRuns: 500 }
    );
  });

  it('P3 · 그 밤을 고른 숙소 하나만 덮고 있으면 계획이 비었다 (같은 숙소 재선택 = 요청 0건)', () => {
    fc.assert(
      fc.property(CURRENT_ARB, REQUEST_ARB, (current, req) => {
        const request = night(req.savedStayId, req.offset);
        const coveringNow = stayIdsCovering(current, request.dateFrom);
        // 전제 — "그 숙소 하나만 덮는다"인 경우만 본다(나머지는 P1·P2 가 잰다).
        fc.pre(coveringNow.length === 1 && coveringNow[0] === req.savedStayId);

        expect(planBaseAssign(current, request)).toEqual({
          deleteIds: [],
          posts: [],
        });
      }),
      { numRuns: 500 }
    );
  });

  it('P4 · 지우는 배정은 전부 그 밤과 겹치고, 같은 id 를 두 번 지우지 않는다', () => {
    fc.assert(
      fc.property(CURRENT_ARB, REQUEST_ARB, (current, req) => {
        const request = night(req.savedStayId, req.offset);

        const { deleteIds } = planBaseAssign(current, request);

        expect(new Set(deleteIds).size).toBe(deleteIds.length);
        deleteIds.forEach((id) => {
          const row = current.find((item) => item.baseAssignmentId === id);
          // 없는 id 를 지우면 서버가 404 — 목록에 실재해야 한다.
          expect(row).toBeDefined();
          expect(covers(row as BaseAssignment, request.dateFrom)).toBe(true);
        });
      }),
      { numRuns: 500 }
    );
  });

  it('P5 · 보내는 요청은 전부 빈 구간이 아니다 (dateFrom < dateTo)', () => {
    fc.assert(
      fc.property(CURRENT_ARB, REQUEST_ARB, (current, req) => {
        const request = night(req.savedStayId, req.offset);

        const { posts } = planBaseAssign(current, request);

        posts.forEach((post) => expect(post.dateFrom < post.dateTo).toBe(true));
      }),
      { numRuns: 500 }
    );
  });
});
