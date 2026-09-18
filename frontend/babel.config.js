module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // react-native-worklets/plugin(Reanimated 4)은 반드시 마지막 plugin 이어야 한다.
    plugins: ['react-native-worklets/plugin'],
  };
};
