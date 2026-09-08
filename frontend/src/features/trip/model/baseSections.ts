import type {
  BaseAssignment,
  SavedStay,
  Trip,
  TripDestination,
} from '@/shared/api/generated/schemas';

// 에포크 일수 → 'YYYY-MM-DD' 역변환 + 요일. 같은 feature(`features/trip/model`)에 이미 있는 순수
// 정수 산술(`new Date` 미사용, civil_from_days)이라 재구현 대신 재사용한다 — `dayOfWeek`도
// 같은 파일이 export 하는 순수 요일 계산기다(TRIP-664 `tripSummary`가 이미 재사용).
import { dayOfWeek, fromEpochDay } from './tripWizardStep1';

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

/**
 * g02 박별(1박=1행) 거점 행 — 다박=1행인 `BaseSection[]`을 밤 단위로 펼친다
 * (TRIP-664 · US-TRIP-07). 원 `toBaseSections`는 불변(BR-U1-28의 "N박 체류" 묶음 표시).
 * 이쪽은 신 g02 카드가 요구하는 반대 방향(밤별 개별 카드, 사전 확정 결정 D6).
 *
 * `nightNumber`는 방출된 행의 1-기반 통번호다 — `nightLabel`(여행 시작일 고정 기준, 공백에
 * 번호 건너뜀)과 다른 축이다. `nights ≤ 0` 구간은 0행을 낳고, 동일 숙소 여러 날 중복을 허용한다
 * (dedup 없음). 입력은 이미 `dateFrom` 오름차순(`toBaseSections` 출력)이라고 본다.
 */
export interface NightlyBase {
  date: string;
  stayName: string;
  nightNumber: number;
}

export function toNightlyBases(sections: BaseSection[]): NightlyBase[] {
  const rows: NightlyBase[] = [];
  let nightNumber = 0;

  for (const section of sections) {
    // `nights ≤ 0` 구간은 이 루프가 0번 돌아 0행을 낸다 — 거르는 게 아니라 산식상 비는 것이다
    // (INV-2 · D6). 통번호는 방출한 행에서만 증가하므로 0박 구간은 번호를 소비하지 않는다.
    const from = toEpochDay(section.dateFrom);
    for (let night = 0; night < section.nights; night += 1) {
      nightNumber += 1;
      // 필드 셋만 담는다(INV-3) — `{ ...section, … }` 스프레드면 BaseSection의 7필드가 새 나온다.
      rows.push({
        date: fromEpochDay(from + night),
        stayName: section.stayName,
        nightNumber,
      });
    }
  }

  return rows;
}

/** 0=일 … 6=토 → 한글 요일 한 글자. `dayOfWeek`(tripWizardStep1)의 반환 인덱스와 짝이다
 * (에포크 0 = 목요일 기준이라 `new Date().getUTCDay()`와 같은 순서). `tripSummary.ts`가 같은
 * 배열을 내부 전용으로 쓰지만 export 하지 않는 관례라 이 파일이 사본을 둔다 — 요일 배열
 * 리터럴은 고유 판정이 아니라 표준 대응표일 뿐이다. */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * g02 신 default 얼굴이 그릴 **박별(1박=1행) 거점 카드**(TRIP-672 · D1). 원 `toBaseSections`·
 * `toNightlyBases`는 불변 — 이쪽은 신 화면이 요구하는 다른 방향의 파생이다(밤 목록·지역은
 * `destinations`에서, 숙소명은 `sections`를 날짜로 조인).
 *
 * 세 파생을 이 함수 하나가 소유한다:
 *  1. **밤 목록·지역** — `destinations`를 seq 순서로 nights만큼 펼친 타임라인. 트립 전체 밤
 *     (옵션 A)이라 배정이 하나도 없어도 카드는 Σnights 장이 뜬다(전부 stayName 없음 →
 *     화면이 "숙소 미정"으로 그린다).
 *  2. **날짜 라벨** — `startDate`부터 하루씩 더한 `"M/D(요일)"`(예 `6/10(수)`). 요일은
 *     `dayOfWeek`(에포크 산술)로 구해 시계를 안 읽는다.
 *  3. **숙소명** — `sections`(toBaseSections 출력)를 그 밤 날짜로 조인. 그 날짜를 덮는 배정이
 *     있고 이름이 비어 있지 않으면 그 이름, 아니면 `stayName` 키를 아예 안 단다(미배정).
 *     날짜 조인이라 배정 공백에도 밤↔숙소가 어긋나지 않는다.
 *
 * 출력 필드는 `{ nightNumber, dateLabel, region, stayName? }` 정확히 이 넷(INV-3 — 소요시간·거리 없음).
 */
export interface NightlyBaseCard {
  nightNumber: number;
  dateLabel: string;
  region: string;
  stayName?: string;
}

/** 그 밤 날짜를 덮는 배정의 숙소명. `dateTo`는 체크아웃(배타)이라 `[dateFrom, dateTo)` 안이면
 * 덮는다. 빈 이름은 미부착으로 본다 — `toBaseSections`가 짝 없는 저장 숙소에 빈 문자열을 낸다. */
function stayNameForNight(
  sections: BaseSection[],
  nightEpoch: number
): string | undefined {
  for (const section of sections) {
    const from = toEpochDay(section.dateFrom);
    const to = toEpochDay(section.dateTo);
    if (from <= nightEpoch && nightEpoch < to) {
      return section.stayName === '' ? undefined : section.stayName;
    }
  }
  return undefined;
}

export function nightlyBaseCards({
  destinations,
  startDate,
  sections,
}: {
  destinations: TripDestination[];
  startDate: string;
  sections: BaseSection[];
}): NightlyBaseCard[] {
  // destinations를 seq 순서로 nights만큼 펼쳐 밤별 지역 타임라인을 만든다. 입력을 안 뒤집으려
  // 사본을 정렬한다 — 정렬 소유는 이 model 파일 몫이다(화면·배선 소스엔 `.sort(` 0건, ★7).
  const regionByNight: string[] = [];
  [...destinations]
    .sort((a, b) => a.seq - b.seq)
    .forEach((destination) => {
      for (let night = 0; night < destination.nights; night += 1) {
        regionByNight.push(destination.region);
      }
    });

  const startEpoch = toEpochDay(startDate);
  return regionByNight.map((region, index) => {
    const nightEpoch = startEpoch + index;
    const [, month, day] = fromEpochDay(nightEpoch).split('-').map(Number);
    const card: NightlyBaseCard = {
      nightNumber: index + 1,
      dateLabel: `${month}/${day}(${WEEKDAYS[dayOfWeek(nightEpoch)]})`,
      region,
    };
    // 미배정 밤은 `stayName` 키 자체를 안 단다 — N5가 `Object.keys`로 3키/4키를 가른다.
    const stayName = stayNameForNight(sections, nightEpoch);
    if (stayName !== undefined) card.stayName = stayName;
    return card;
  });
}
