import type {
  AssignBaseRequest,
  BaseAssignment,
} from '@/shared/api/index.schemas';

/**
 * TRIP-1011 C — 거점 지정을 "교체"로 바꾸는 계획(순수 함수). 서버 `POST /bases` 는 기존 배정을
 * 안 보고 행을 하나 더 만든다 — 그래서 이미 지정된 밤을 다시 지정하려면 그 밤을 덮는 배정을 지우고
 * (DELETE) 그 배정의 나머지 구간을 다시 붙인 뒤(POST) 새 배정을 붙여야 한다.
 *
 * 구간은 전부 `[dateFrom, dateTo)`(체크아웃 배타)이고 ISO 날짜라 문자열 비교가 곧 날짜 비교다.
 */
export interface BaseAssignPlan {
  /** 지울 기존 배정 id. */
  deleteIds: string[];
  /** 보낼 배정 요청(남은 구간 재지정 + 새 지정). */
  posts: AssignBaseRequest[];
}

export function planBaseAssign(
  current: readonly BaseAssignment[],
  request: AssignBaseRequest
): BaseAssignPlan {
  const overlapping = current.filter(
    (row) => row.dateFrom < request.dateTo && request.dateFrom < row.dateTo
  );

  // 이미 그 숙소 한 배정이 요청 구간을 통째로 덮고 있으면 할 일이 없다(같은 숙소 재선택 = 0건).
  const [only] = overlapping;
  if (
    overlapping.length === 1 &&
    only.savedStayId === request.savedStayId &&
    only.dateFrom <= request.dateFrom &&
    request.dateTo <= only.dateTo
  ) {
    return { deleteIds: [], posts: [] };
  }

  // 겹친 배정의 요청 구간 앞·뒤 자투리는 같은 숙소로 다시 붙인다(다른 밤의 덮개 보존).
  const remainders = overlapping.flatMap((row) => [
    ...(row.dateFrom < request.dateFrom
      ? [
          {
            savedStayId: row.savedStayId,
            dateFrom: row.dateFrom,
            dateTo: request.dateFrom,
          },
        ]
      : []),
    ...(request.dateTo < row.dateTo
      ? [
          {
            savedStayId: row.savedStayId,
            dateFrom: request.dateTo,
            dateTo: row.dateTo,
          },
        ]
      : []),
  ]);

  return {
    deleteIds: overlapping.map((row) => row.baseAssignmentId),
    posts: [...remainders, request],
  };
}
