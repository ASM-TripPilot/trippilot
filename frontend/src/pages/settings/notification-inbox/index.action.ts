// 알림 행·푸시 탭의 목적지 순수 함수만 내는 진입점 — 부팅 경로(usePushRouting)가 index.ts 를 물면 알림함 화면 전체가 함께 평가된다(TRIP-1716).
export { notificationAction } from './model/notificationAction';
