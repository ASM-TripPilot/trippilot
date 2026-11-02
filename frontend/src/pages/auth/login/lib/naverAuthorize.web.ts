import type { AuthorizeResult } from '../model/useSocialLogin';

/**
 * 웹 빌드가 `naverAuthorize.ts` 대신 집는 스텁. 네이버 SDK 는 웹에서 못 쓰고, 이 스텁이 있어야 네이티브본이 읽는
 * 클라이언트 시크릿 env 가 공개 웹 번들에 인라인되지 않는다(SEC-AUTH). 웹 네이버(implicit 토큰 갈래, TRIP-1650)가
 * 이 파일을 대체·확장한다.
 */
export async function naverAuthorize(): Promise<AuthorizeResult> {
  throw new Error('네이버 SDK 로그인은 웹에서 지원하지 않습니다.');
}

void ({ naverAuthorize } satisfies typeof import('./naverAuthorize'));
