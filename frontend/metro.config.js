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

module.exports = withNativeWind(config, {
  input: './src/app/styles/global.css',
});
