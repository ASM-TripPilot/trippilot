import type { CreateTripRequest } from '@/shared/api/generated/schemas';

/**
 * 여행 생성 폼이 채우는 입력 — 생성 계약(`CreateTripRequest`)에서 `preferenceSnapshot`만 뺀
 * 나머지다. 뺀 이유는 **폼이 직접 입력받는 필드가 아니어서**다 — 취향 스냅숏은 프리필/여행
 * 단위 override에서 별도로 조립돼 배선(page)이 실어 넘긴다. `Omit`은 **타입 선언**일 뿐이라,
 * 구조적 타이핑 때문에 그 키를 실제로 가진 값(`CreateTripRequest` 타입 변수)을 인자로 넘기는
 * 것 자체는 막지 못한다 — 그리고 이제는 **막을 필요가 없다**(TRIP-484 정책 A: 스냅숏을 통과
 * 시킨다). `budgetTotal`은 입력에 남는다 — 출처가 사용자 입력이다(TRIP-207 AC-2).
 */
export type CreateTripInput = Omit<CreateTripRequest, 'preferenceSnapshot'>;

/**
 * 서버로 나갈 여행 생성 본문을 조립한다(TRIP-207 AC-2 · AC-3 · TRIP-484 정책 A).
 *
 * `budgetTotal`은 입력이 **숫자일 때만** 결과에 붙는다(`0` 포함, ★2) — 키가 아예 없거나,
 * 값이 `undefined`거나(파싱 결과 없음), `null`이면(계약상 nullable) 전부 키를 안 붙인다.
 *
 * `preferenceSnapshot`은 **입력이 실었으면 그대로 통과시키고, 없으면 결과에도 없다**(조건부
 * 통과, TRIP-484 정책 A). 예전엔 이 함수가 스냅숏을 런타임으로 **능동 제거**했다 — "생성
 * 시점 취향 동결은 서버 책임(BE TRIP-177)"이라는 전제였으나 그 전제가 **틀렸다**: BE
 * (`TripApiIT`)는 받은 스냅숏을 그대로 저장할 뿐, 계정 취향에서 스스로 동결값을 파생하지
 * 않는다. 여행 단위 취향 override(BR-U1-38 · G-U1-11)를 여행에 새기려면 FE가 보내야 한다.
 * 이 함수는 지어내지도 지우지도 않는다 — 무엇을 실을지는 배선(page)이 정한다.
 *
 * `undefined` 값 키를 `{...input}`으로 그냥 펼치면 그 키가 결과에 새어 나가므로(★3),
 * 두 키(`budgetTotal`·`preferenceSnapshot`)를 스프레드 전에 떼어내 조건부로만 다시 붙인다.
 */
export function buildCreateTripRequest(
  input: CreateTripInput
): CreateTripRequest {
  // `input`은 타입상 `preferenceSnapshot`이 없지만, 구조적 타이핑 때문에 실제 값은 가질 수
  // 있다(배선이 `CreateTripRequest`로 실어 넘긴다). 두 키를 스프레드 전에 떼어내 조건부로만
  // 다시 붙인다 — `undefined` 값 키가 스프레드로 새는 것을 막으면서, 입력이 실은 값은 통과.
  const { budgetTotal, preferenceSnapshot, ...safeInput } =
    input as CreateTripRequest;

  return {
    ...safeInput,
    ...(typeof budgetTotal === 'number' ? { budgetTotal } : {}),
    ...(preferenceSnapshot !== undefined ? { preferenceSnapshot } : {}),
  };
}
