import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
}

/**
 * 토큰은 OS 보안 저장소(secure-store)에만 둔다 — AsyncStorage/Zustand/Query 캐시로 복사하지 않는다.
 */
export async function saveTokens({
  accessToken,
  refreshToken,
}: TokenBundle): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export async function getTokens(): Promise<TokenBundle | null> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (accessToken == null || refreshToken == null) {
    return null;
  }
  return { accessToken, refreshToken };
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export async function hasStoredToken(): Promise<boolean> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  return accessToken != null;
}
