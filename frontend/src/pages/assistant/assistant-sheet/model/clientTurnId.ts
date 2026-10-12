import * as Crypto from 'expo-crypto';

/** 턴 멱등 키(INV-U8-05) — 보내기 직전 1회 만들고 재전송에 재사용한다(frontend-components §3). */
export function newClientTurnId(): string {
  return Crypto.randomUUID();
}
