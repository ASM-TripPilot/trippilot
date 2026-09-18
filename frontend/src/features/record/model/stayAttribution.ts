import type {
  BaseAssignment,
  SavedStay,
  VisitCheck,
} from '@/shared/api/generated/schemas';

/**
 * TRIP-569 · US-REC-05 · BR-U5-25·26·27 — 방문 기록을 등록 숙소·날짜에 귀속하되 **저장하지
 * 않고 조회 시점에 파생**한다. 숙소(bases)가 나중에 바뀌면 다음 파생에서 귀속이 저절로 따라
 * 움직인다.
 *
 * ★미저장 구조봉쇄(AC-5): 반환 타입에 "저장된 귀속" 자리를 두지 않는다 — `baseStay` 는 매
 * 호출 `bases` 로 새로 계산하는 파생값일 뿐이다(`visitStatus.ts` 가 `status` 컬럼을 안 두는
 * 것과 같은 수법). 그래서 이 함수는 시계·서버·스토어를 건드리지 않는 순수 함수다.
 *
 * ★타임존(AC-6): 날짜 경계를 다룰 때 기기 `new Date(...)` 로 파싱하지 않는다 — 자정 근처
 * 시각이 기기 타임존만큼 밀려 엉뚱한 날에 묶이기 때문이다. 여기선 시각을 **문자열 접두
 * 'YYYY-MM-DD' 로만** 다룬다(`arrivedAt.slice(0, 10)`). 그 형식은 사전식 비교가 곧 날짜 순서와
 * 일치해서 `dateFrom <= D < dateTo` 를 문자열 비교로 그대로 잴 수 있다 — epoch-day 정수 산술
 * (`baseSections.ts` 선례)도 같은 답을 내지만 여기선 문자열 비교가 더 짧고 `Date.UTC` 조차
 * 필요 없다.
 */

export interface AttributedStay {
  savedStayId: string;
  /** `savedStays` 로 해소한 숙소명. 못 찾으면 undefined(귀속 자체는 살아남는다). */
  name?: string;
}

export interface DayAttribution {
  date: string; // 'YYYY-MM-DD'
  /** 그날(dateFrom ≤ date < dateTo)을 덮는 base 가 있을 때만 존재 — 없으면 날짜만 그룹. */
  baseStay?: AttributedStay;
  visits: VisitCheck[];
}

/** 방문의 귀속 날짜 — 계획 방문은 slotKey('YYYY-MM-DD#poi') 접두, 즉석 방문(slotKey==null)은
 * arrivedAt 접두. 둘 다 없으면 귀속 불가(그룹에서 제외). */
function attributionDate(visit: VisitCheck): string | null {
  if (visit.slotKey != null) return visit.slotKey.slice(0, 10);
  if (visit.arrivedAt != null) return visit.arrivedAt.slice(0, 10);
  return null;
}

export function deriveStayAttribution(input: {
  visits: VisitCheck[];
  bases: BaseAssignment[];
  savedStays?: SavedStay[];
}): DayAttribution[] {
  const { visits, bases, savedStays } = input;
  const nameById = new Map(
    (savedStays ?? []).map((stay) => [stay.savedStayId, stay.name] as const)
  );

  // 같은 귀속 날짜의 방문을 한 그룹으로 모은다(귀속 불가 방문은 버린다).
  const byDate = new Map<string, VisitCheck[]>();
  for (const visit of visits) {
    const date = attributionDate(visit);
    if (date === null) continue;
    const bucket = byDate.get(date);
    if (bucket) bucket.push(visit);
    else byDate.set(date, [visit]);
  }

  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, dayVisits]): DayAttribution => {
      // dateFrom 포함·dateTo 배제(체크아웃일은 안 잠). 여러 base 가 덮으면 입력 순서상 첫
      // 매치 — 판정·거르기는 서버 몫이라 정렬하지 않는다(baseSections INV-2 규율 계승).
      const cover = bases.find((b) => b.dateFrom <= date && date < b.dateTo);
      if (!cover) return { date, visits: dayVisits };
      return {
        date,
        visits: dayVisits,
        baseStay: {
          savedStayId: cover.savedStayId,
          name: nameById.get(cover.savedStayId),
        },
      };
    });
}
