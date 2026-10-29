import type { AuthorizeResult } from '../model/useSocialLogin';

/**
 * 웹 빌드가 `kakaoAuthorize.ts` 대신 집는 스텁(번들러가 `X.web.ts` 를 먼저 고른다). 카카오 네이티브 SDK 는 웹에서
 * 못 쓰고, 웹 카카오는 makeAuthorize 가 브라우저 OAuth 로 보내므로 여기에 올 일이 없다 — 오면 조용히 넘어가지 않고
 * 실패를 알린다(INV-4). SDK 를 import 하지 않아 웹 번들에 SDK 코드가 실리지 않는다.
 */
export async function kakaoAuthorize(): Promise<AuthorizeResult> {
  throw new Error('카카오 SDK 로그인은 웹에서 지원하지 않습니다.');
}

// 네이티브본과 이름·모양이 어긋나면 tsc 가 잡는다(타입만 참조 — 정적 import 가 아니다).
void ({ kakaoAuthorize } satisfies typeof import('./kakaoAuthorize'));
