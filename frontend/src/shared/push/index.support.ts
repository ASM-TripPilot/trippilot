// 이 플랫폼에 푸시가 있는가 — 설정의 "알림" 그룹을 웹에서 숨기는 근거. 웹은 index.support.web.ts 가 false 를 준다(TRIP-1648).
// 배럴(`@/shared/push`)이 아니라 별도 진입점인 이유: SettingsPage.hookMock.test 가 배럴을 4개 이름만 남기고 통째로 목으로 바꾼다.
export function isPushSupported(): boolean {
  return true;
}
