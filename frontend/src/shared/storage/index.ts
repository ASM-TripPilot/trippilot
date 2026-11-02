import { deleteSecureItem, getSecureItem, setSecureItem } from './secureKv';

/**
 * 토큰 저장소 — SEC-09: 클라 토큰은 `./secureKv` 어댑터로만 읽고 쓴다(네이티브는 OS 보안 저장소,
 * 웹은 localStorage — 웹은 보안 저장소가 없어 의도적으로 약화된 예외다).
 * AsyncStorage·Zustand·Query 캐시로 복사하지 않는다. 키는 accessToken·refreshToken 둘뿐이다.
 */

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

/** 푸시 "이미 서버에 올린 토큰|권한" 기억의 키(TRIP-1348, 값은 `shared/push` 가 쓴다). 세션이 끝나면 함께 지워야
 * 해서 여기 둔다 — 세션 만료(401)는 로그아웃 경로를 안 타고 `clearTokens` 만 부른다. */
export const PUSH_REGISTERED_KEY = 'pushTokenRegistered';

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(tokens: TokenBundle): Promise<void> {
  await Promise.all([
    setSecureItem(ACCESS_TOKEN_KEY, tokens.accessToken),
    setSecureItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

/** 하나라도 없으면 null — 부분 저장 상태를 유효한 세션으로 오인하지 않는다. */
export async function getTokens(): Promise<TokenBundle | null> {
  const [accessToken, refreshToken] = await Promise.all([
    getSecureItem(ACCESS_TOKEN_KEY),
    getSecureItem(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

/** 로그아웃·401 확정(세션 만료) 시 즉시 호출된다(BR-U0-09). */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    deleteSecureItem(ACCESS_TOKEN_KEY),
    deleteSecureItem(REFRESH_TOKEN_KEY),
    deleteSecureItem(PUSH_REGISTERED_KEY),
  ]);
}

/** 부트스트랩 타임아웃 폴백(BR-U0-27)의 "로그인했나" 판정 입력 — accessToken 존재만 본다(부분 저장이어도 true). */
export async function hasStoredToken(): Promise<boolean> {
  return (await getSecureItem(ACCESS_TOKEN_KEY)) != null;
}

export { readIdSet, writeIdSet } from './idSet';
export { getInstallId } from './installId';
export { readStringValue, writeStringValue } from './stringValue';
export { readInstallFlag, writeInstallFlag } from './installFlag';
