import { Dimensions, PixelRatio } from 'react-native';

/**
 * TRIP-1629 AC1-a — 설정만으로 글자 배율이 1 이다(integration 버킷).
 * 두 버킷은 설정 파일이 달라(`jest.integration.config.js` 는 `...base` 상속) 각자 한 건씩 둔다.
 * 사정은 `fontScalePreload.test.ts` 머리 주석과 같다.
 */
it('P2 아무것도 안 하고 읽으면 Dimensions 와 PixelRatio 의 글자 배율이 1 이다', () => {
  expect(Dimensions.get('window').fontScale).toBe(1);
  expect(PixelRatio.getFontScale()).toBe(1);
});
