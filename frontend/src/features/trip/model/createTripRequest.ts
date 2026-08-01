import type {
  CreateTripRequest,
  PreferenceView,
} from '@/shared/api/generated/schemas';

/**
 * 여행 생성 폼이 채우는 입력 — 생성 계약(`CreateTripRequest`)에서 이 함수가 직접 채우는
 * 두 필드(`budgetTotal`·`preferenceSnapshot`)를 뺀 나머지다(01b Seed AC-5·AC-6, 02a §2).
 * `Omit`은 **타입 선언**에서만 두 키를 지운다 — 구조적 타이핑 때문에 그 키를 실제로 가진
 * 값(예: `CreateTripRequest` 타입 변수)을 인자로 넘기는 것 자체는 막지 못한다. 그래서 이
 * 타입만으로 "두 필드가 결과에 안 나타난다"를 보장할 수 없고, 보장은 아래 함수 본문의
 * 런타임 제거가 한다(계약 추종은 이 타입이, 값 제거는 함수 본문이 — 역할이 나뉜다).
 */
export type CreateTripInput = Omit<
  CreateTripRequest,
  'budgetTotal' | 'preferenceSnapshot'
>;

/**
 * 서버로 나갈 여행 생성 본문을 조립한다(TRIP-203 AC-5 · AC-6).
 *
 * `preferenceSnapshot`은 이 함수가 만들지 않고, **입력이 이미 갖고 있어도 결과에선 걷어낸다**
 * — 생성 시점 취향 동결은 서버 책임이다(BE TRIP-177 · BR-U1-38). 걷어내는 이유: 위 타입은
 * 컴파일 타임 안내일 뿐, 호출부가 `CreateTripRequest` 타입 변수를 그대로 넘기면(구조적
 * 타이핑) 그 값을 타입 검사가 막지 못하기 때문이다 — 그래서 `...input` 스프레드 전에 두
 * 키를 실제 값에서 떼어낸다. `budgetTotal`은 취향의 예산 러프값(`budget.rawAmount`)이
 * **숫자일 때만** 붙인다 — 값이 없으면(`budget` 축 자체가 없거나, 있어도 `rawAmount`가
 * `null`이거나, 취향 조회가 아직 안 끝나 `preference` 자체가 `undefined`인 세 갈래 전부) 키를
 * 아예 붙이지 않는다. `null`을 실어 보내면 서버가 거부한다 — 선례
 * `buildStayRegisterRequest`(TRIP-198 AC-5)가 날짜에 대해 세운 "키 부재 ≠ null 전송" 규칙과
 * 같은 성질이다.
 */
export function buildCreateTripRequest(
  input: CreateTripInput,
  preference: PreferenceView | undefined
): CreateTripRequest {
  const rawAmount = preference?.budget?.rawAmount;

  // `input`은 타입상 이 두 키가 없지만, 구조적 타이핑 때문에 실제 값은 가질 수 있다(W-1).
  // 결과에 새어 나가지 않도록 스프레드 전에 값에서 직접 떼어낸다.
  const {
    budgetTotal: _droppedBudgetTotal,
    preferenceSnapshot: _droppedPreferenceSnapshot,
    ...safeInput
  } = input as CreateTripRequest;

  return {
    ...safeInput,
    ...(typeof rawAmount === 'number' ? { budgetTotal: rawAmount } : {}),
  };
}
