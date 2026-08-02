import type {
  CompanionType,
  CreateTripRequest,
  TripDestination,
} from '@/shared/api/generated/schemas';

/**
 * 여행 생성 위저드 1/2단계 드래프트를 서버로 보내도 되는지 판정하는 순수 함수 3개
 * (TRIP-204). 화면·쿼리 훅·라우터를 모르며(AC-8), 판정의 정본은 서버다 — 여기는 제출 전
 * 미리 알려 주는 UX 사본이다(INV-U1-11 · INV-U1-14, BE TRIP-177).
 */

/** 위반 코드 4종 — 티켓이 정한 그대로. 새 코드를 여기서 늘리지 않는다(01b D3). */
export type TripViolationCode =
  | 'NO_DESTINATION'
  | 'END_BEFORE_START'
  | 'NIGHTS_EXCEED_PERIOD'
  | 'PARTY_BELOW_ONE';

/** 위저드 1/2단계가 채우는 입력 — 생성 계약에서 검증이 읽는 4필드만 뽑는다. */
export type TripDraft = Pick<
  CreateTripRequest,
  'startDate' | 'endDate' | 'destinations' | 'party'
>;

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' → 에포크 일수(UTC 기준 정수). 로컬 타임존에 따라 하루가 밀리는 것을 막는다
 * (`Date.UTC`는 실행 기계의 타임존과 무관하다 — `stayDates.ts:6~7`과 같은 규칙).
 *
 * `nightsBetween`(`features/stay/model/stayDates.ts`)을 재사용하지 않는다 — 근거는 경계
 * 의미가 반대라는 것 하나다: 숙소는 같은 날/역전을 전부 `null`로 접지만, 여행은 0박이
 * 합법이고 역전은 `END_BEFORE_START`로 구별되는 판정이어야 한다. 계산식만 같은 규칙을
 * 따르고 판정은 이 모듈이 갖는다. (경계 eslint 가드 `import/no-restricted-paths`는 현재
 * `features/trip`을 대상 zone에 안 걸어 두어 이 import를 실제로는 막지 못한다 — "막혀
 * 있다"고 여기 적었던 것은 오기였다, 03b W-2.)
 *
 * 판독 불가한 입력('' 등 `YYYY-MM-DD` 형식이 아닌 문자열)은 `Date.UTC`가 조용히 `NaN`을
 * 돌려준다 — 이 함수는 그걸 막지 않는다. 막는 자리는 `validateTripDraft`다(아래 참고). */
function toEpochDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** 여행 기간(박). `endDate − startDate`(INV-U1-14) — 9/1~9/3은 2박이지 3이 아니다. 음수면
 * 종료일 역전이고, 0이면 당일치기다. */
function tripLength(draft: TripDraft): number {
  return toEpochDay(draft.endDate) - toEpochDay(draft.startDate);
}

/** 도시별 박수 합. */
export function nightsSum(destinations: TripDestination[]): number {
  return destinations.reduce((total, one) => total + one.nights, 0);
}

/**
 * 드래프트의 위반 코드를 중복 없는 배열로 돌려준다(빈 배열 = 통과). 네 판정은 서로
 * 독립이라 종료일 역전인 드래프트는 `END_BEFORE_START`와 `NIGHTS_EXCEED_PERIOD`를 함께 낼
 * 수 있다 — 역전이면 기간이 음수라 박수 합 조건도 기계적으로 깨지기 때문이다(01b 결정 D).
 * 배열 안 순서는 계약이 아니다(01b D4) — 호출부는 집합으로 비교한다.
 *
 * 날짜·박수가 판독 불가(`NaN`)일 때 페일클로즈한다(03b W-1) — `length < 0` /
 * `합 > length` 같은 "양성 비교"는 `NaN`이 끼면 늘 `false`라 조용히 통과로 무너진다.
 * 그래서 대신 "정상 통과 조건"을 부정해서 판정한다: `!(length >= 0)` 은 역전(`length < 0`)
 * 뿐 아니라 날짜를 못 읽은 경우(`length` 가 `NaN`)도 함께 잡고, `!(합 <= length)` 는
 * 박수 초과뿐 아니라 박수를 못 읽은 경우도 함께 잡는다 — 실수(NaN이 아닌 값) 입력에서는
 * 원래 식과 결과가 완전히 같다(삼분법칙).
 */
export function validateTripDraft(draft: TripDraft): TripViolationCode[] {
  const codes: TripViolationCode[] = [];
  const length = tripLength(draft);

  if (draft.destinations.length === 0) {
    codes.push('NO_DESTINATION');
  }
  if (!(length >= 0)) {
    codes.push('END_BEFORE_START');
  }
  if (!(nightsSum(draft.destinations) <= length)) {
    codes.push('NIGHTS_EXCEED_PERIOD');
  }
  // 미입력(`undefined`)은 서버 계약의 `default: 1`대로 1로 읽는다(01b D2) — 별도 기본값
  // 적용 함수를 두지 않는다.
  if ((draft.party ?? 1) < 1) {
    codes.push('PARTY_BELOW_ONE');
  }

  return codes;
}

/** 온보딩 동반 유형 → 서버 enum. `Map`을 쓰는 이유는 평범한 객체 리터럴로 두면
 * `표['toString']`이 키 부재가 아니라 `Object.prototype.toString`(함수)을 돌려주기
 * 때문이다 — 임의 문자열 입력에 `'toString'`이 실제로 나올 수 있다. 서버 enum에 대응이
 * 없는 값(`부모님` 등 미지값)은 `null`이다(BR-U1-39는 `커플 → 연인` 하나만 명시한다). */
const COMPANION_TYPE_MAP = new Map<string, CompanionType>([
  ['혼자', '혼자'],
  ['친구', '친구'],
  ['가족', '가족'],
  ['연인', '연인'],
  ['커플', '연인'],
]);

export function toCompanionType(onboardingValue: string): CompanionType | null {
  return COMPANION_TYPE_MAP.get(onboardingValue) ?? null;
}
