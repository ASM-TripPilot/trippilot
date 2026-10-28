import { Dimensions, PixelRatio } from 'react-native';

/**
 * TRIP-1629 AC1-a — 설정만으로 글자 배율이 1 이다(node 버킷).
 *
 * jest 의 RN 목 기본은 2 라서, `fontScalePreload.cjs`(setupFiles)가 없으면 배율을 안 정한 모든 테스트가
 * 큰 글자 가지를 그린다. 이 파일은 일부러 이 한 건뿐이다 — `Dimensions.set` 을 하는 다른 테스트가 같은 파일에 있으면
 * 그 값이 싱글턴으로 남아 "설정만으로"를 증명하지 못한다.
 * 3동작: 준비(없음 — 설정만) → 실행(두 길로 읽기) → 단언(둘 다 1).
 */
it('P1 아무것도 안 하고 읽으면 Dimensions 와 PixelRatio 의 글자 배율이 1 이다', () => {
  expect(Dimensions.get('window').fontScale).toBe(1);
  expect(PixelRatio.getFontScale()).toBe(1);
});
