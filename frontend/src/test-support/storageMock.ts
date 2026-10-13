/**
 * `@/shared/storage`(토큰 저장소 배럴) 의 테스트 대역(TRIP-1350). 기기 저장소를 건드리지 않게 배럴만 바꾼다 — 리포 56파일이
 * 같은 10줄 `jest.mock` 블록을 복사해 쓰던 것이다.
 *
 * 쓰는 법(`jest.mock` 은 호이스트되므로 인라인 팩토리 대신 이 모듈을 `require` 한다):
 *
 *   // eslint-disable-next-line @typescript-eslint/no-require-imports
 *   jest.mock('@/shared/storage', () => require('@/test-support/storageMock'));
 *
 * 저장된 토큰이 있는 로그인 상태(`old-access`/`old-refresh`)가 기본이다. 다른 모양이 필요한 파일은 이 모듈을 펼쳐 그 키만 덮어쓴다:
 *   `jest.mock('@/shared/storage', () => ({ ...require('@/test-support/storageMock'), getTokens: jest.fn()… }))`.
 */

export const saveTokens = jest.fn().mockResolvedValue(undefined);
export const getTokens = jest.fn().mockResolvedValue({
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
});
export const clearTokens = jest.fn().mockResolvedValue(undefined);
export const hasStoredToken = jest.fn().mockResolvedValue(true);
