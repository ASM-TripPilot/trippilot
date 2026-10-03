// 공식 FSD 구조 린터 Steiger 설정(TRIP-1158) — `pnpm fsd`(= steiger ./src --fail-on-warnings)가 읽는다.
// cwd 기준으로만 찾으므로 frontend/ 에서 실행한다(다른 곳에서 돌리면 이 파일 없이 권장 설정으로 돈다).
// 권장 설정을 그대로 쓰고, 아래 예외 블록마다 이유·다시 켤 조건·근거를 단다(README §import 경계 「린터」와 같은 목록).
// `steiger --fix` 는 쓰지 않는다 — 0.7.0 은 빈 index.js 를 만든다.
import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

export default defineConfig([
  ...fsd.configs.recommended,
  // 예외 1(전역 제외 — 규칙은 끄지 않고 검사 파일만 뺀다): 테스트·개발 프리뷰.
  // 이유: 테스트는 jest.mock 이 정의 모듈을 겨눠야 해서 딥 경로가 설계다(README §import 경계 「테스트」),
  //   프리뷰는 공개 API 밖 화면 상태를 펼친다. ESLint 딥 임포트 zone 의 면제 범위와 같다(TEST_IGNORES·_dev).
  //   전역 제외라 insignificant-slice 가 프로덕션 참조만 센다(1155 소비처 정의와 같다).
  // 다시 켤 조건: 없음(정본 설계). `_dev` 글롭은 라우트가 src 밖으로 나가면 죽은 글롭이 되니 그때 지운다(TRIP-1161).
  { ignores: ['./src/**/*.test.{ts,tsx}', './src/app/_dev/**'] },
  // 예외 2(범위 끄기): features 의 excessive-slicing(슬라이스 25개 > 기준 20, 기준은 바꿀 수 없다).
  // 이유: 공식이 features 그룹화를 "use with caution"이라 하고 자연스러운 묶음 기준이 없다. 옛 도메인 껍데기
  //   정리(TRIP-1159)가 슬라이스 수를 줄이는 정해진 경로다(1155 01d Q3). 끈 동안 features 슬라이스 수는 무감시다.
  // 다시 켤 조건: src/features 슬라이스 ≤ 20(TRIP-1159 뒤) — 이 블록을 지운다.
  { files: ['./src/features/**'], rules: { 'fsd/excessive-slicing': 'off' } },
  // 예외 3(범위 끄기): pages/itinerary·pages/onboarding 그룹의 repetitive-naming(슬라이스 이름 접두 반복).
  // 이유: 접두를 떼면 16개 슬라이스 개명 + onboarding/location·push 가 shared 세그먼트와 겹쳐 ambiguous-slice-names
  //   가 새로 뜬다 — 이름 짓기는 사람 판단이라 별 티켓 몫이다(1156 J8·J9). 다른 그룹은 그대로 검사한다.
  // 다시 켤 조건: 두 그룹 슬라이스 이름에서 접두를 뗀 뒤 — 해당 경로를 지운다.
  {
    files: ['./src/pages/itinerary/**', './src/pages/onboarding/**'],
    rules: { 'fsd/repetitive-naming': 'off' },
  },
]);
