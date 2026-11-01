/**
 * @jest-environment node
 */

/**
 * TRIP-1616 · 운영 번들 잠금 — `metro.config.js` 의 blockList 값 계약.
 *
 * 무엇을 보장하나: 운영(`NODE_ENV=production`) 번들에서만 `src/mocks`·`src/test-support`·`__fixtures__`·`*.test.*` 와
 * `app/_dev` 를 Metro 가 "없는 파일"로 취급한다 → 운영 코드가 정적 import 뿐 아니라 `require()`·`import()` 로 끌어와도
 * `expo export` 가 "모듈을 못 찾는다"며 실패한다. 개발 번들(`NODE_ENV=development`)은 이 패턴이 하나도 없다.
 * 반례도 잠근다: 운영 상수 파일(`homeFixtures.ts`)·node_modules 속 같은 이름 파일은 막지 않는다(앵커 근거: 의존성 업데이트가
 * 이유 없이 운영 export 를 깨뜨리지 않게).
 *
 * 어떻게 읽나(개념 — 자식 프로세스): `metro.config.js` 는 `process.env.NODE_ENV` 를 **파일을 읽는 순간** 본다. jest 안에서
 * 같은 프로세스로 `require` 하면 NODE_ENV 가 이미 'test' 로 박혀 있고 모듈 캐시도 한 번뿐이라 두 값을 못 비교한다.
 * 그래서 `node -e` 자식 프로세스를 NODE_ENV 별로 띄워 blockList 를 JSON 으로 받아 온다(정규식은 {source, flags} 로 직렬화).
 * 이 파일이 `bundleReport.test.ts` 와 따로인 이유: 그 파일은 child_process 를 막아 두는 가드가 있다.
 *
 * 한계: 실제 `expo export` 가 막힌 파일 import 에서 실패하는지는 jest 가 아니라 뮤테이션 실행(02a §7)이 본다.
 * 3동작 뼈대: 준비=NODE_ENV 별 blockList 읽기 → 실행=샘플 절대경로를 정규식에 대 본다 → 단언=막힘/안 막힘.
 */
import { spawnSync } from 'child_process';
import path from 'path';

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const MARK = '__BLOCKLIST_JSON__';

type Serialized = { source: string; flags: string };

// 자식 프로세스에서 metro.config.js 를 읽어 blockList(배열이든 단일 RegExp 든)를 RegExp[] 로 돌려준다.
function readBlockList(nodeEnv: 'production' | 'development'): RegExp[] {
  const script = `
    const config = require('./metro.config.js');
    const list = config.resolver.blockList;
    const arr = Array.isArray(list) ? list : [list];
    process.stdout.write('${MARK}' + JSON.stringify(arr.map((r) => ({ source: r.source, flags: r.flags }))));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: FRONTEND_ROOT,
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `metro.config.js 읽기 실패(NODE_ENV=${nodeEnv}, exit ${result.status}): ${result.error?.message ?? result.stderr}`
    );
  }
  const at = result.stdout.lastIndexOf(MARK);
  if (at < 0) throw new Error(`blockList 출력이 없다: ${result.stdout}`);
  const parsed = JSON.parse(
    result.stdout.slice(at + MARK.length)
  ) as Serialized[];
  return parsed.map(({ source, flags }) => new RegExp(source, flags));
}

const at = (relative: string) => path.join(FRONTEND_ROOT, relative);
const isBlocked = (list: RegExp[], file: string) =>
  list.some((pattern) => pattern.test(file));

// 새 패턴이 막아야 하는 것(+ 기존 app/_dev).
const MUST_BLOCK: [string, string][] = [
  ['src/mocks 서버 목', 'src/mocks/server.ts'],
  ['src/test-support 헬퍼', 'src/test-support/freezeDate.ts'],
  [
    '__fixtures__ 폴더 속 픽스처',
    'src/pages/auth/login/model/__fixtures__/socialLogin.ts',
  ],
  [
    '새 홈 단계 픽스처',
    'src/pages/home/model/__fixtures__/homePhaseFixtures.ts',
  ],
  ['src 아래 단위 테스트', 'src/pages/home/ui/HomeScreen.test.tsx'],
  ['src 아래 통합 테스트', 'src/a/b.integration.test.tsx'],
  ['app 아래 테스트', 'app/(tabs)/index.test.tsx'],
  ['app 아래 __fixtures__ 폴더 속 픽스처', 'app/(tabs)/__fixtures__/a.ts'],
  ['기존 app/_dev 프리뷰', 'app/_dev/preview.tsx'],
  ['실패 주입 딥링크 라우트', 'app/_dev/fault.tsx'],
  ['실패 주입 모듈(개발 빌드 전용)', 'src/shared/dev-fault/interceptor.ts'],
];

// 막으면 안 되는 것.
const MUST_PASS: [string, string][] = [
  ['운영 홈 기본값 파일', 'src/pages/home/model/homeFixtures.ts'],
  ['운영 매거진 데이터', 'src/pages/magazine/model/magazineFixtures.ts'],
  ['운영 라우트', 'app/(tabs)/_layout.tsx'],
  ['node_modules 속 __fixtures__', 'node_modules/x/__fixtures__/a.js'],
  ['node_modules 속 .test. 파일', 'node_modules/x/b.test.js'],
  ['node_modules 속 src/mocks 모양', 'node_modules/x/src/mocks/a.js'],
  ['접두만 같은 폴더 src/mocksmith', 'src/mocksmith/a.ts'],
  ['접두만 같은 폴더 src/test-supporter', 'src/test-supporter/a.ts'],
  ['.test. 가 아닌 파일명', 'src/pages/home/model/latest.tsx'],
  ['운영 API 계층(실패 주입을 require 로만 문다)', 'src/shared/api/index.ts'],
];

describe('운영 번들(NODE_ENV=production) blockList', () => {
  let list: RegExp[];
  beforeAll(() => {
    list = readBlockList('production');
  }, 30000);

  it('읽기가 공허하지 않다 — Expo 기본(.expo/types·__tests__)과 기존 app/_dev 가 그대로 들어 있다', () => {
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(isBlocked(list, at('.expo/types/router.d.ts'))).toBe(true);
    expect(isBlocked(list, at('src/__tests__/x.test.ts'))).toBe(true);
    expect(isBlocked(list, at('app/_dev/preview.tsx'))).toBe(true);
  });

  it.each(MUST_BLOCK)('막는다 — %s', (_name, relative) => {
    expect(isBlocked(list, at(relative))).toBe(true);
  });

  it.each(MUST_PASS)('막지 않는다 — %s', (_name, relative) => {
    expect(isBlocked(list, at(relative))).toBe(false);
  });
});

describe('개발 번들(NODE_ENV=development) blockList', () => {
  let list: RegExp[];
  beforeAll(() => {
    list = readBlockList('development');
  }, 30000);

  it('읽기가 공허하지 않다 — Expo 기본 패턴은 개발에도 있다', () => {
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(isBlocked(list, at('.expo/types/router.d.ts'))).toBe(true);
  });

  it.each(MUST_BLOCK)(
    '운영 전용 잠금이 없다 — %s 를 막지 않는다',
    (_name, relative) => {
      expect(isBlocked(list, at(relative))).toBe(false);
    }
  );
});
