/**
 * TRIP-1071 · 캡처 3종 패키지를 정적으로 import 하는 유일한 파일(어댑터).
 * `shareCapture.ts` 가 `await import` 로만 부른다 — 여기를 정적으로 import 하면 재빌드 전 빌드가
 * 부팅 그래프에서 네이티브 모듈 부재로 죽는다(`shareCardStructure` G5 가 강제).
 */
export { captureRef } from 'react-native-view-shot';
export {
  requestPermissionsAsync,
  saveToLibraryAsync,
} from 'expo-media-library';
export { shareAsync } from 'expo-sharing';
