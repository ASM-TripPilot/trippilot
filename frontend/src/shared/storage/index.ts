import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

/**
 * 토큰 저장소 — SEC-09: 클라 토큰은 OS 보안 저장소(expo-secure-store)에만 둔다.
 * AsyncStorage·Zustand·Query 캐시로 복사하지 않는다. 키는 accessToken·refreshToken 둘뿐이다.
 */

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(tokens: TokenBundle): Promise<void> {
  await Promise.all([
    setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken),
    setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

/** 하나라도 없으면 null — 부분 저장 상태를 유효한 세션으로 오인하지 않는다. */
export async function getTokens(): Promise<TokenBundle | null> {
  const [accessToken, refreshToken] = await Promise.all([
    getItemAsync(ACCESS_TOKEN_KEY),
    getItemAsync(REFRESH_TOKEN_KEY),
  ]);
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

/** 로그아웃·401 확정(세션 만료) 시 즉시 호출된다(BR-U0-09). */
export async function clearTokens(): Promise<void> {
  await Promise.all([
    deleteItemAsync(ACCESS_TOKEN_KEY),
    deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

/** 부트스트랩 타임아웃 폴백(BR-U0-27)의 "로그인했나" 판정 입력 — accessToken 존재만 본다(부분 저장이어도 true). */
export async function hasStoredToken(): Promise<boolean> {
  return (await getItemAsync(ACCESS_TOKEN_KEY)) != null;
}
