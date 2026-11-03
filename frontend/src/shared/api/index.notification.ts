// 태그 하나만 내는 진입점 — 부팅 경로가 12태그 배럴(index.hooks)을 통째로 끌지 않게(TRIP-1716). 그 밖의 소비처는 index.hooks.
// 단수 notification = 알림함(/me/notifications). 복수 notifications(푸시 토큰)는 shared/push 가 정의 모듈을 직접 문다.

export * from './generated/notification/notification';
