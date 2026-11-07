// 탭 레이아웃(부팅 경로)이 쓰는 퇴장 호스트 진입점 — index.ts 를 물면 기록 바 프리셋·출발 탭 훅까지 함께 평가된다(TRIP-1716 의 `index.action` 선례).
// 리셋은 pages 층 테스트가 딥 경로 없이 쓰려고 여기에 둔다.
export { resetBarExitForTests, useBarExit } from './model/barExitHandoff';
export type { BarExitProps } from './model/barExitHandoff';
export { BarExitHost } from './ui/BarExitHost';
