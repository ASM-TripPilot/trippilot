import { AxiosHeaders, isAxiosError } from 'axios';

/**
 * 429 = "요청 한도를 넘었다". `isNotFound`(404)·`isAlreadyRegistered`(409)와 같은 자리·같은 형태다.
 * 상태 코드로만 판정한다 — `error.code` 로 가르면 서버가 코드명을 바꾸는 순간 한도에 걸린 사용자가 일반
 * 실패 얼굴을 본다(INV-4). 네트워크 오류(`response` 없음)는 false — 응답을 못 받은 것은 한도가 아니다.
 */
export function isRateLimited(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 429;
}

/**
 * 429 응답의 `Retry-After`(초) — 풀릴 때까지 남은 시간. 헤더가 없거나 음이 아닌 정수가 아니면(HTTP-date 꼴
 * 포함) null 이다: 호출부는 시각 없이 안내만 한다(헤더 부재로 안내가 깨지면 안 된다).
 * 헤더 대소문자는 axios 가 정규화한다(`AxiosHeaders`) — 목·실응답 모두 같은 읽기.
 */
export function retryAfterSeconds(error: unknown): number | null {
  if (!isAxiosError(error) || error.response === undefined) return null;
  const raw = AxiosHeaders.from(
    error.response.headers as ConstructorParameters<typeof AxiosHeaders>[0]
  ).get('retry-after');
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}
