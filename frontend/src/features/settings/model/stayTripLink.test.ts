import type {
  BaseAssignment,
  SavedStay,
  Trip,
} from '@/shared/api/generated/schemas';

import { buildStayTripLink } from './stayTripLink';

/**
 * TRIP-605 · AC-1(BR-U6-20 연결 여행 역참조) — `buildStayTripLink`: SavedStay 목록·여행 목록·
 * 여행별 거점 목록에서 "이 숙소가 어느 여행에 연결됐나"를 거꾸로 찾아 Map 으로 접는 순수 함수.
 *
 * 무엇을 보장하나(계약):
 *  - 어떤 여행의 거점(`bases[].savedStayId`)이 이 숙소면 그 여행이 연결 여행 → `{tripId, tripName(=Trip.title),
 *    baseAssignmentId}` 엔트리를 만든다. 연결이 없으면 Map 에서 부재(페이지가 부재→'연결된 여행 없음').
 *  - **savedStays 가 구동자** — 거점에만 있고 savedStays 엔 없는 유령 savedStayId 는 엔트리를 안 만든다.
 *  - **한 숙소가 여러 여행의 거점이면 `trips` 순서상 첫 여행이 이긴다**(first-wins, 결정론 — Map 이 강제).
 *
 * 커버하지 않는 것: 화면 표시 문자열('연결 여행 · X')·정렬은 페이지/화면 몫(순수 함수는 값만 낸다).
 *
 * (개념) 순수 함수 = 입출력만, 조회·부수효과·시계 없음. 반환은 `Map<savedStayId, StayTripLink>`.
 */

/** 최소 SavedStay — 이 함수는 savedStayId 만 본다(나머지는 shape 만족용). */
function stay(savedStayId: string): SavedStay {
  return {
    savedStayId,
    name: `숙소 ${savedStayId}`,
    coordConfirmed: true,
    registerRoute: 'MAP_SEARCH',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** 최소 Trip — 역참조는 tripId·title 만 쓴다. */
function trip(tripId: string, title: string): Trip {
  return {
    tripId,
    title,
    startDate: '2026-06-10',
    endDate: '2026-06-12',
    party: 2,
    preferenceSnapshot: {},
    destinations: [{ seq: 1, region: '부산', nights: 2 }],
    status: 'PLANNED',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** 최소 BaseAssignment. */
function base(baseAssignmentId: string, savedStayId: string): BaseAssignment {
  return {
    baseAssignmentId,
    savedStayId,
    dateFrom: '2026-06-10',
    dateTo: '2026-06-12',
  };
}

describe('🔴 TRIP-605 · buildStayTripLink — 연결 여행 역참조', () => {
  it('연결된 숙소는 {tripId, tripName(=title), baseAssignmentId} 로 매핑된다', () => {
    const result = buildStayTripLink([stay('s1')], [trip('t1', '부산 여행')], {
      t1: [base('ba1', 's1')],
    });

    expect(result.get('s1')).toEqual({
      tripId: 't1',
      tripName: '부산 여행',
      baseAssignmentId: 'ba1',
    });
  });

  it('연결이 없는 숙소는 Map 에 부재한다', () => {
    const result = buildStayTripLink([stay('s2')], [trip('t1', '부산 여행')], {
      t1: [base('ba1', 's1')], // s2 는 거점이 아니다
    });

    expect(result.has('s2')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('혼합 목록에서 연결된 숙소만 엔트리를 갖는다', () => {
    const result = buildStayTripLink(
      [stay('s1'), stay('s2')],
      [trip('t1', '부산 여행')],
      { t1: [base('ba1', 's1')] }
    );

    expect(result.size).toBe(1);
    expect(result.has('s1')).toBe(true);
    expect(result.has('s2')).toBe(false);
  });

  it('한 숙소가 두 여행의 거점이면 trips 순서상 첫 여행이 이긴다(first-wins)', () => {
    const result = buildStayTripLink(
      [stay('s1')],
      [trip('t1', '첫 여행'), trip('t2', '둘째 여행')],
      { t1: [base('baA', 's1')], t2: [base('baB', 's1')] }
    );

    expect(result.size).toBe(1);
    expect(result.get('s1')).toEqual({
      tripId: 't1',
      tripName: '첫 여행',
      baseAssignmentId: 'baA',
    });
  });

  it('거점에만 있고 savedStays 엔 없는 유령 savedStayId 는 엔트리를 안 만든다', () => {
    const result = buildStayTripLink([], [trip('t1', '부산 여행')], {
      t1: [base('ba1', 'ghost')],
    });

    expect(result.size).toBe(0);
    expect(result.has('ghost')).toBe(false);
  });

  it('빈 입력은 빈 Map', () => {
    expect(buildStayTripLink([], [], {}).size).toBe(0);
  });
});
