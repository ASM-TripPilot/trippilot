// 공식 FSD 구조 린터 Steiger 설정(TRIP-1158) — `pnpm fsd`(= steiger ./src --fail-on-warnings)가 읽는다.
// cwd 기준으로만 찾으므로 frontend/ 에서 실행한다(다른 곳에서 돌리면 이 파일 없이 권장 설정으로 돈다).
// 권장 설정을 그대로 쓰고, 아래 예외 블록마다 이유·다시 켤 조건·근거를 단다(README §import 경계 「린터」와 같은 목록).
// `steiger --fix` 는 쓰지 않는다 — 0.7.0 은 빈 index.js 를 만든다.
import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
  ...fsd.configs.recommended,
  // 예외 1(전역 제외 — 규칙은 끄지 않고 검사 파일만 뺀다): 테스트.
  // 이유: 테스트는 jest.mock 이 정의 모듈을 겨눠야 해서 딥 경로가 설계다(README §import 경계 「테스트」).
  //   ESLint 딥 임포트 zone 의 면제 범위와 같다(TEST_IGNORES). 개발 프리뷰(app/_dev)는 라우트 폴더라
  //   애초에 `steiger ./src` 밖이다(TRIP-1161 — 옛 `./src/app/_dev/**` 글롭은 죽어서 지웠다).
  //   전역 제외라 insignificant-slice 가 프로덕션 참조만 센다(1155 소비처 정의와 같다).
  // 다시 켤 조건: 없음(정본 설계).
  { ignores: ['./src/**/*.test.{ts,tsx}'] },
  // 예외 2(범위 끄기): features 의 excessive-slicing(슬라이스 수 > 기준 20, 기준은 바꿀 수 없다 — 지금 수는 이 블록을 빼고 `pnpm fsd` 를 돌리면 Steiger 가 낸다).
  // 이유: 공식이 features 그룹화를 "use with caution"이라 하고 자연스러운 묶음 기준이 없다. 옛 도메인 껍데기
  //   정리(TRIP-1159)가 슬라이스 수를 줄이는 정해진 경로다(1155 01d Q3). 끈 동안 features 슬라이스 수는 무감시다.
  // 다시 켤 조건: src/features 슬라이스 ≤ 20(TRIP-1159 뒤) — 이 블록을 지운다.
  { files: ['./src/features/**'], rules: { 'fsd/excessive-slicing': 'off' } },
  // 예외 3(범위 끄기): pages/itinerary·pages/onboarding 그룹의 repetitive-naming(슬라이스 이름 접두 반복).
  // 이유: 접두를 떼면 두 그룹 슬라이스 전부 개명 + onboarding/location·push 가 shared 세그먼트와 겹쳐 ambiguous-slice-names
  //   가 새로 뜬다 — 이름 짓기는 사람 판단이라 별 티켓 몫이다(1156 J8·J9). 다른 그룹은 그대로 검사한다.
  // 다시 켤 조건: 두 그룹 슬라이스 이름에서 접두를 뗀 뒤 — 해당 경로를 지운다.
  {
    files: ['./src/pages/itinerary/**', './src/pages/onboarding/**'],
    rules: { 'fsd/repetitive-naming': 'off' },
  },
  // 예외 4(범위 끄기): shared/lib 의 shared-lib-grouping(모듈 수 > 기준 15 — TRIP-1524a 가 useKeyboardVisible 을 더해 처음 넘었다).
  // 이유: 테스트 계약이 `shared/lib/useKeyboardVisible` 경로를 고정했고, 기존 모듈을 묶는 정리는 import 경로를 모두 바꾸는
  //   별 티켓 몫이다(드라이브바이 금지). 끈 동안 shared/lib 모듈 수는 무감시다.
  // 다시 켤 조건: shared/lib 를 하위 폴더로 묶어 모듈 ≤ 15 가 된 뒤 — 이 블록을 지운다.
  {
    files: ['./src/shared/lib/**'],
    rules: { 'fsd/shared-lib-grouping': 'off' },
  },
  // 예외 5(범위 끄기): features/curated-stay 의 insignificant-slice(TRIP-1579).
  // 이유: 설계(TRIP-1577 스펙 §설계 3)대로 위젯 widgets/curated-stays 하나만 조립해 참조 1 이다(이 규칙은 참조 2 미만이면
  //   실패). 끈 동안 이 슬라이스의 참조 수는 무감시다.
  //   (같은 블록에 있던 widgets/curated-stays·features/stay-outbound 경로는 다시 켤 조건 — pages 2곳 이상이 CuratedStaysSection
  //   을 문다 — 이 충족돼 TRIP-1772 에서 지웠다 — 두 슬라이스는 예외 없이 `pnpm fsd` 를 통과한다.)
  // 다시 켤 조건: 위젯 밖 소비처가 생기거나 위젯 안(model·ui 세그먼트)으로 합치면 지운다.
  {
    files: ['./src/features/curated-stay/**'],
    rules: { 'fsd/insignificant-slice': 'off' },
  },
  // 예외 6(범위 끄기): pages/trip 그룹의 repetitive-naming(슬라이스 이름에 `trip` 반복 — TRIP-1787 `trip-settings` 가 셋째).
  // 이유: 규칙은 같은 단어가 슬라이스 이름 3개 이상에 들어가면 낸다. 접두를 떼면 `trip-new-step1/2`·`trip-settings` 개명 +
  //   라우트 테스트(`routeParamMapping`)·통합 테스트의 import 경로가 모두 바뀌는 별 티켓 몫이다(드라이브바이 금지, 예외 3 과 같은 사정).
  // 다시 켤 조건: pages/trip 슬라이스 이름에서 `trip` 접두를 뗀 뒤 — 이 블록을 지운다.
  {
    files: ['./src/pages/trip/**'],
    rules: { 'fsd/repetitive-naming': 'off' },
  },
]);
