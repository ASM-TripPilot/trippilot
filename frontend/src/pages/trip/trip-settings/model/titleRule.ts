/** 여행 이름 최대 길이 — 서버 규칙의 UX 사본(권위는 서버). 단위는 코드포인트다. */
const MAX_TITLE_LENGTH = 120;

/**
 * 이름 위반 판정. 빈·공백뿐이면 서버가 `{첫 목적지} 여행` 으로 바꿔 버리므로 막고, 길이는 서버처럼 **원문을 코드포인트로**
 * 센다(이모지 하나는 한 글자 — `.length` 가 아니라 `[...s].length`).
 */
export function titleViolation(s: string): 'EMPTY' | 'TOO_LONG' | null {
  if (s.trim() === '') return 'EMPTY';
  return [...s].length > MAX_TITLE_LENGTH ? 'TOO_LONG' : null;
}
