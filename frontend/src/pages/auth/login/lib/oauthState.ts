/**
 * OAuth `state`(CSRF 방어용 일회용 난수) 생성·대조 — 앱이 직접 만들고 직접 확인한다.
 * 라이브러리가 몰래 만들어 주는 값에 기대지 않으려고 realAuthorize 가 이 둘을 쓴다(웹 구글·카카오,
 * 이후 웹 네이버도 같은 헬퍼를 재사용한다). 네이티브 모듈을 import 하지 않아
 * makeAuthorize 의 정적 그래프에 실려도 안전하다.
 */

/** 암호학적 난수(128비트)를 16진수 문자열로. 난수원이 없으면 약한 값으로 때우지 않고 던진다(INV-4). */
export function generateOAuthState(): string {
  const rng = globalThis.crypto;
  if (!rng?.getRandomValues) {
    throw new Error(
      'OAuth state 를 만들 안전한 난수원이 없어 로그인을 시작할 수 없습니다.'
    );
  }
  const bytes = rng.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 돌아온 state 가 보낸 것과 정확히 같지 않으면(없는 경우 포함) 던진다 — 호출부는 success 를 내지 않는다. */
export function assertOAuthStateMatches(
  expected: string,
  returned: string | undefined
): void {
  if (!returned || returned !== expected) {
    throw new Error(
      '소셜 로그인 인가 실패: 돌아온 state 가 요청과 달라 응답을 버립니다(CSRF 방어).'
    );
  }
}
