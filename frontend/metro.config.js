const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// 운영 번들에서 개발 전용 프리뷰(app/_dev: 화면 7천 줄·jpg·픽스처)를 뺀다. __DEV__ 번들은 그대로.
if (process.env.NODE_ENV === 'production') {
  const prev = config.resolver.blockList;
  config.resolver.blockList = [
    ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
    /app[\\/]_dev[\\/].*/,
  ];
}

// TRIP-1362 — inlineRequires 실험 스위치(기본 꺼짐). 켜면 require 가 사용 시점으로 미뤄져 시작 때 평가하는 모듈 수가
// 줄 수 있으나, 모듈 평가 순서가 바뀌는 실험이라 측정(콜드스타트·Hermes 모듈 평가 수)과 6-b 전 화면 스모크 뒤에만 기본값으로 올린다.
// 켜기: `EXPO_INLINE_REQUIRES=1 pnpm expo export …` 또는 Metro 를 `EXPO_INLINE_REQUIRES=1 pnpm start --clear` 로 띄운다
// (변환 캐시가 옵션을 키로 삼지만 의심되면 `--clear`). 최상위 부작용(preventAutoHideAsync·initSentry)은 app/_layout.tsx 의
// 부작용 import 로 고정해 지연 평가에서 뺀다.
if (process.env.EXPO_INLINE_REQUIRES === '1') {
  const prevGetTransformOptions = config.transformer.getTransformOptions;
  config.transformer.getTransformOptions = async (...args) => {
    const prev = prevGetTransformOptions ? await prevGetTransformOptions(...args) : {};
    return { ...prev, transform: { ...prev.transform, inlineRequires: true } };
  };
}

module.exports = withNativeWind(config, {
  input: './src/app/styles/global.css',
});
