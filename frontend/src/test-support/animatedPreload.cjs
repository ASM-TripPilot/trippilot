/**
 * RN `Animated` 모듈 그래프를 테스트 파일마다 **테스트 시작 전에** 한 번 읽어 두는 jest setupFiles (TRIP-1125).
 *
 * 왜: `react-native` 의 index 는 `Animated` 를 지연 getter 로 내준다 — 처음 `.Animated` 를 만지는 순간에야
 * Animated 모듈 수십 개를 require·babel 트랜스폼한다. 캐시가 빈 CI(냉시작)에서는 이 비용이 수백 ms 라,
 * 로딩 화면이 Skeleton(Animated 펄스)을 쓰기 시작하자 그 첫 로드가 **파일 첫 테스트의 `waitFor` 1000ms
 * 창 안**에서 일어났다. 실측(`--no-cache`, `SavedPlacesPage.select.integration` IS-1 소요):
 * develop 751~879ms · Skeleton 도입 브랜치 1123~1439ms(PR 816 CI 에서 IS-1 red) · 이 선로드 후 = develop 수준.
 * 런타임 지연이 아니라 모듈 로드 시점 문제라 테스트 timeout 을 늘리지 않고 로드를 창 밖으로 옮긴다.
 *
 * 왜 여기(setupFiles): setupFiles 는 각 테스트 파일의 모듈 레지스트리 안에서 프리셋 목 등록 뒤에 돈다 →
 * 테스트가 나중에 require 하는 `NativeAnimatedHelper` 와 **같은 인스턴스**다(`shouldUseNativeDriver`
 * 스파이 테스트들이 그대로 건다). `jest.config.js` 에 걸어 두 버킷(node·integration 상속)이 모두 받는다.
 *
 * 지우면: 기능 테스트는 안 깨지지만, 로딩 얼굴에 Animated 를 쓰는 화면의 파일 첫 테스트가 냉캐시 CI 에서
 * 다시 ~450ms 느려져 `waitFor` 기본 1000ms 경계를 넘는다(로컬 warm 캐시에선 안 보인다).
 */
void require('react-native').Animated; // 지연 getter 를 여기서 한 번 불러 그래프를 읽힌다
require('react-native/src/private/animated/NativeAnimatedHelper');
