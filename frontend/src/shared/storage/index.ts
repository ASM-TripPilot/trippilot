import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// 웹에는 SecureStore 가 없다(네이티브 전용 — 호출 시 reject). 개발용 웹 실행에 한해
// localStorage 로 대체한다. 배포 대상은 네이티브뿐이라 SEC-09(OS 보안 저장소)의 예외가 아니다.
const isWeb = Platform.OS === 'web';
const getItemAsync = (k: string): Promise<string | null> =>
  isWeb
    ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null)
    : SecureStore.getItemAsync(k);
const setItemAsync = (k: string, v: string): Promise<void> =>
  isWeb
    ? Promise.resolve(globalThis.localStorage?.setItem(k, v))
    : SecureStore.setItemAsync(k, v);
const deleteItemAsync = (k: string): Promise<void> =>
  isWeb
    ? Promise.resolve(globalThis.localStorage?.removeItem(k))
    : SecureStore.deleteItemAsync(k);

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
