const HANGUL_FIRST = 0xac00; // 가
const HANGUL_LAST = 0xd7a3; // 힣
/** 한 초성·중성 조합이 가질 수 있는 종성 칸 수(받침 없음 0 + 받침 27). */
const JONG_COUNT = 28;

/**
 * 목적격 조사 을/를을 붙인다(TRIP-800 h15 CTA `{숙소}을/를 거점으로`).
 *
 * 끝 글자가 한글 음절이면 종성 번호(`(코드 − 0xAC00) % 28`)가 0 일 때 받침이 없어 `를`, 아니면 `을`.
 * 한글 음절이 아니면(영문·숫자·기호·호환 자모) 읽는 법을 알 수 없어 `을(를)` 병기 — 틀린 조사보다 안전하다.
 */
export function withObjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    const hasFinal = (code - HANGUL_FIRST) % JONG_COUNT !== 0;
    return word + (hasFinal ? '을' : '를');
  }
  return `${word}을(를)`;
}
