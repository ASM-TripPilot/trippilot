const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// 운영 번들에서 개발·테스트 전용 파일을 뺀다(__DEV__ 번들은 그대로). blockList = Metro 가 "없는 파일"로 취급할 경로 정규식 목록이라
// 운영 코드가 정적 import 뿐 아니라 require()·import() 로 끌어와도 `expo export` 가 "모듈을 못 찾는다"며 실패한다(TRIP-1616).
// - app/_dev: 프리뷰(화면 7천 줄·jpg·픽스처)·실패 주입 딥링크(`_dev/fault`)
// - src/shared/dev-fault: 실패 주입(개발 빌드 전용 — 운영 코드는 `if (__DEV__) require()` 로만 문다)
// - src/mocks · src/test-support: msw 목·테스트 헬퍼
// - src·app 아래 __fixtures__/ 폴더와 *.test.[jt]sx? 파일
// 프로젝트 루트(__dirname)에 앵커를 박아 node_modules 속 같은 이름 파일(의존성 업데이트)은 막지 않는다.
// 이 목록과 scripts/bundle-report.cjs 의 FORBIDDEN_PATTERNS 가 짝이다(막는 쪽 / 번들에 섞였는지 확인하는 쪽).
if (process.env.NODE_ENV === 'production') {
  // 경로를 정규식 문자열에 넣기 전에 특수문자(. + ( 등)를 이스케이프한다.
  const root = __dirname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prev = config.resolver.blockList;
  config.resolver.blockList = [
    ...(Array.isArray(prev) ? prev : prev ? [prev] : []),
    /app[\\/]_dev[\\/].*/,
    new RegExp(`^${root}[\\\\/]src[\\\\/](mocks|test-support)[\\\\/]`),
    new RegExp(`^${root}[\\\\/]src[\\\\/]shared[\\\\/]dev-fault[\\\\/]`),
    new RegExp(
      `^${root}[\\\\/](src|app)[\\\\/](.*[\\\\/])?__fixtures__[\\\\/]`
    ),
    new RegExp(`^${root}[\\\\/](src|app)[\\\\/].*\\.test\\.[jt]sx?$`),
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
    const prev = prevGetTransformOptions
      ? await prevGetTransformOptions(...args)
      : {};
    return { ...prev, transform: { ...prev.transform, inlineRequires: true } };
  };
}

module.exports = withNativeWind(config, {
  input: './src/app/styles/global.css',
});
