/**
 * jest 의 글자 배율(fontScale)을 테스트 파일마다 **테스트 시작 전에** 1 로 고정하는 setupFiles (TRIP-1629).
 *
 * 왜: jest 의 RN 목(`Dimensions`)은 fontScale 이 1 이 아니라 2 로 시작한다. 그래서 배율을 따로 정하지 않은
 * 테스트가 말없이 "큰 글자 가지"(배율 ≥ 1.5 에서 갈리는 화면 분기)를 돌고 있었다(6파일). 기본을 1 로 맞춰,
 * 큰 글자를 보려는 테스트는 `fontScale.ts` 의 `setFontScale`/`describeAtFontScales` 로 명시하게 한다.
 *
 * 왜 여기(setupFiles): setupFiles 는 각 테스트 파일의 모듈 레지스트리 안에서 프리셋 목 등록 뒤에 돈다 →
 * 테스트가 나중에 읽는 `Dimensions`·`PixelRatio` 와 **같은 인스턴스**의 값을 바꾼다. `jest.config.js` 에 걸어
 * 두 버킷(node·integration 상속)이 모두 받는다.
 *
 * 지우면: 배율을 안 정한 테스트 6파일이 다시 배율 2 의 큰 글자 가지를 돌고, `fontScalePreload*.test.ts`(P1·P2)가 red 가 된다.
 */
const { Dimensions } = require('react-native');

Dimensions.set({
  window: { ...Dimensions.get('window'), fontScale: 1 },
  screen: { ...Dimensions.get('screen'), fontScale: 1 },
});
