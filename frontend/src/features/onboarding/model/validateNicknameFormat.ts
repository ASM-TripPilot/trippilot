/**
 * 닉네임 **형식** 검증 (BR-U0-15 2~20자 · AC B4) — 순수 함수, UX 사본.
 *
 * 권한 경계: 금칙어(BANNED_WORD)·중복(TAKEN) 판정은 **서버 권한**이다.
 * 이 함수는 길이만 본다 — 클라가 내용을 판정하면 서버와 규칙이 갈라진다.
 *
 * 미구현 스텁: 타입만 확정해 테스트가 import 단계에서 죽지 않게 한다.
 */

export type NicknameFormatReason = 'OK' | 'TOO_SHORT' | 'TOO_LONG';

export interface NicknameFormatResult {
  valid: boolean;
  reason: NicknameFormatReason;
}

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;

export function validateNicknameFormat(value: string): NicknameFormatResult {
  // 서버 DB(V1.5 char_length)와 세는 단위를 맞춘다 — `[...value]` 는 이모지(서로게이트 쌍)를
  // 1글자로 센다(`.length` 는 2로 센다). `.length` 를 쓰면 이모지 닉네임에서 서버와 판정이 갈린다.
  const length = [...value].length;
  if (length < NICKNAME_MIN_LENGTH) {
    return { valid: false, reason: 'TOO_SHORT' };
  }
  if (length > NICKNAME_MAX_LENGTH) {
    return { valid: false, reason: 'TOO_LONG' };
  }
  return { valid: true, reason: 'OK' };
}
