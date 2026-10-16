/**
 * TRIP-1422 · 설정 내보내기에서 expo-sharing 을 정적으로 import 하는 유일한 파일(어댑터).
 * `shareExportFile.ts` 가 `await import` 로만 부른다 — 정적으로 끌면 재빌드 전 빌드가 부팅에서 죽는다
 * (eslint `no-restricted-imports` 가 강제). 파일 쓰기는 여기 두지 않는다(공유 카드 G2 스캔이 이 파일을 본다).
 */
export { shareAsync } from 'expo-sharing';
