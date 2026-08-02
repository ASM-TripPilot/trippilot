import type { CreateTripRequest } from '@/shared/api/generated/schemas';

/**
 * 여행 생성 폼이 채우는 입력 — 생성 계약(`CreateTripRequest`)에서 이 함수가 직접 채우지
 * 않는 필드만 뺀 나머지다(01b Seed AC-6, 02a §2-3). `budgetTotal`은 이제 **입력에 남는다**
 * — 예산의 출처가 사용자 입력(파싱된 값)으로 바뀌었기 때문이다(TRIP-207 AC-2). `Omit`은
 * **타입 선언**에서만 `preferenceSnapshot`을 지운다 — 구조적 타이핑 때문에 그 키를 실제로
 * 가진 값(예: `CreateTripRequest` 타입 변수)을 인자로 넘기는 것 자체는 막지 못한다. 그래서
 * 이 타입만으로 "결과에 안 나타난다"를 보장할 수 없고, 보장은 아래 함수 본문의 런타임
 * 제거가 한다(계약 추종은 이 타입이, 값 제거는 함수 본문이 — 역할이 나뉜다).
 */
export type CreateTripInput = Omit<CreateTripRequest, 'preferenceSnapshot'>;

/**
 * 서버로 나갈 여행 생성 본문을 조립한다(TRIP-207 AC-2 · AC-3, 02a §2-3).
 *
 * `budgetTotal`은 입력이 **숫자일 때만** 결과에 붙는다(`0` 포함, ★2) — 키가 아예 없거나,
 * 값이 `undefined`거나(파싱 결과 없음), `null`이면(계약상 nullable) 전부 키를 안 붙인다.
 * `undefined` 값을 가진 키를 `{...input}`으로 그냥 펼치면 그 키가 결과에 새어 나가므로
 * (★3), 스프레드 전에 값을 먼저 떼어내 조건부로만 다시 붙인다.
 *
 * `preferenceSnapshot`은 이 함수가 만들지 않고, **입력이 이미 갖고 있어도 결과에선
 * 걷어낸다** — 생성 시점 취향 동결은 서버 책임이다(BE TRIP-177 · BR-U1-38). 걷어내는
 * 이유는 위 타입 주석과 같다 — `...input` 스프레드 전에 실제 값에서 떼어낸다.
 */
export function buildCreateTripRequest(
  input: CreateTripInput
): CreateTripRequest {
  // `input`은 타입상 `preferenceSnapshot`이 없지만, 구조적 타이핑 때문에 실제 값은 가질 수
  // 있다(W-1). 결과에 새어 나가지 않도록 스프레드 전에 값에서 직접 떼어낸다. `budgetTotal`도
  // 함께 떼어내 조건부로만 다시 붙인다 — `undefined` 값 키가 스프레드로 새는 것을 막는다.
  const {
    budgetTotal,
    preferenceSnapshot: _droppedPreferenceSnapshot,
    ...safeInput
  } = input as CreateTripRequest;

  return {
    ...safeInput,
    ...(typeof budgetTotal === 'number' ? { budgetTotal } : {}),
  };
}
