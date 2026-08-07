import type {
  BaseAssignment,
  SavedStay,
  Trip,
} from '@/shared/api/generated/schemas';

/**
 * g02 거점 구간 행 — 배정·저장 숙소·여행을 화면이 그릴 행으로 합치는 순수 함수
 * (TRIP-224 · US-TRIP-07 · BR-U1-28). 네트워크·시계·저장소를 건드리지 않는다.
 *
 * 여행 기간 밖 배정(0박·음수 박 번호)도 거르지 않고 산식 그대로 낸다 — 거르는 것은 판정이고
 * 판정은 서버 몫이다(INV-2 · 01b D3). 다박 배정은 날짜 수만큼 쪼개지 않고 한 행이다.
 */

/** 구간 라벨의 구분자 — **en dash U+2013**. 티켓 AC·`frontend-components.md` §4의 ASCII 물결
 * `~`는 라이브 Figma(`1861:2317` = `1–2박`)를 문서로 옮기며 잃은 문자다(01b D2). 눈으로는
 * 구분되지 않아 상수로 이름을 붙여 둔다. */
const EN_DASH = '–';

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준이라 실행 기계의 타임존과 무관하다). 리포에 이미 세 벌
 * 있지만(`stayDates.ts`·`tripWizardStep1.ts`·`tripDraft.ts`) 전부 private이라 가져올 수 없고,
 * 고유 판정이 아니라 날짜 산술의 표준 규칙일 뿐이라 이 파일이 따로 갖는 것이 더 단순하다
 * (`tripWizardStep1.ts:42-45` 선례 · 01b D4). `features/trip → features/stay` 직접 import도
 * 이렇게 피한다. */
function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export interface BaseSection {
  baseAssignmentId: string;
  savedStayId: string;
  /** 짝 맞는 저장 숙소가 없으면 빈 문자열. 정본에 없는 대체 문구를 이 함수가 발명하지
   * 않는다(01b D5) — 빈 이름을 어떻게 그릴지는 화면(TRIP-225) 몫이다. */
  stayName: string;
  dateFrom: string;
  dateTo: string;
  nights: number;
  nightLabel: string;
}

/**
 * 세 번째 인자는 **이 함수가 실제로 읽는 만큼**이다(TRIP-225 02a §1-1b). g02의 조회는 셋이고
 * (01b D7·D14가 그 셋으로 실패 규칙을 짰다) 여행 상세는 그 셋에 없다 — 배선이 가진 것은
 * 위저드 스토어의 `startDate` 하나다. `Trip` 전체를 요구하면 넷째 조회를 붙이거나 `as Trip`
 * 캐스팅으로 얼버무리게 되는데, 후자는 이 파일의 승인 테스트가 명시적으로 거부한 수법이다.
 * `Trip`은 `Pick<Trip, 'startDate'>`에 그대로 대입되므로 기존 호출·테스트는 그대로 통과한다.
 */
export function toBaseSections(
  assignments: BaseAssignment[],
  savedStays: SavedStay[],
  trip: Pick<Trip, 'startDate'>
): BaseSection[] {
  const nameById = new Map(
    savedStays.map((stay) => [stay.savedStayId, stay.name] as const)
  );
  const tripStart = toEpochDay(trip.startDate);

  return (
    assignments
      .map((assignment) => {
        const from = toEpochDay(assignment.dateFrom);
        const nights = toEpochDay(assignment.dateTo) - from;
        // 박 번호는 언제나 여행 시작일 기준이다 — 앞 배정을 이어 세는 누적 카운터가 아니라서
        // 배정 사이가 비면 번호가 건너뛴다(01b §1 산식).
        const firstNight = from - tripStart + 1;
        const lastNight = firstNight + nights - 1;

        // 필드를 하나씩 적는다 — `{ ...assignment, … }` 스프레드로 줄이면 서버가 나중에 덧붙이는
        // 필드(`region`·`duration`)까지 그대로 화면에 실려 나간다. orval 타입에 없어 타입 검사도,
        // 입력을 픽스처로 만드는 승인 테스트도 그 변경을 못 잡는다(줄여도 13/13 green — 03b W-1 실측).
        // 이 나열이 D1(`region` 출력 금지)·INV-3(소요 시간 금지)을 잠그는 유일한 자리다.
        return {
          baseAssignmentId: assignment.baseAssignmentId,
          savedStayId: assignment.savedStayId,
          stayName: nameById.get(assignment.savedStayId) ?? '',
          dateFrom: assignment.dateFrom,
          dateTo: assignment.dateTo,
          nights,
          nightLabel:
            firstNight === lastNight
              ? `${firstNight}박`
              : `${firstNight}${EN_DASH}${lastNight}박`,
        };
      })
      // 입력이 아니라 `map`이 만들어 낸 배열을 정렬한다 — 호출자의 배열을 뒤집지 않는다.
      // 2차 키는 두지 않는다(01b D6): `sort`가 ES2019부터 안정 정렬이라 같은 `dateFrom`은
      // 입력 순서를 지킨다.
      .sort((a, b) =>
        a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0
      )
  );
}
