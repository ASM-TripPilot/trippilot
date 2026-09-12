/**
 * @jest-environment node
 */
// FSD 층 방향(app → pages → widgets → features → entities → shared)을 ESLint 가
// 실제로 막는지 검사한다. `importBoundary.test.ts`(home 1탐침)의 자매 파일 —
// 13개 feature 전부 + 층 방향 매트릭스를 여기서 본다(기존 파일은 무변경).
//
// ⚠️ 단독 실행 시 `NODE_OPTIONS=--experimental-vm-modules` 필요(ESLint 의 동적 import).
//    `pnpm test:node -- <경로>` 로 돌린다 — `pnpm exec jest <경로>` 단독은 실패한다.
import fs from 'fs';
import path from 'path';

import { ESLint } from 'eslint';

const FEATURES_DIR = path.resolve('src/features');

// import **대상**은 해석돼야(실파일이어야) 한다 — 아니면 위반이 경계(no-restricted-paths)가
// 아니라 모듈 해석 실패(no-unresolved)로 잡혀 심판이 조용히 무의미해진다.
const REAL_FEATURE_HOME = '@/features/home/model/homeFixtures';
const REAL_FEATURE_ONB = '@/features/onboarding/model/preferenceStore';
const REAL_PAGE = '@/pages/place-explore/ui/PlaceExplorePage';
const REAL_SHARED = '@/shared/ui/BottomTabBar';
const REAL_APP_SHELL = '@/app-shell';

// entities 는 여전히 빈 층이라 실대상이 없다 — import 대상으로 쓰면 no-unresolved 가 뜬다(아래 허용 프로브).
const EMPTY_ENTITIES = '@/entities/__probe__/model/x';

// widgets 는 이 사이클에 처음 채워진다(TRIP-805 · D9 승격) — itinerary-edit 슬라이스가 실파일이라
// 이 딥 경로가 해석된다. 배럴(@/widgets/itinerary-edit)이 아니라 딥 파일을 쓰는 이유는 importBoundary
// 선례(배럴 해석 회피)와 같다 — no-unresolved 를 확실히 끊어 "경계 위반 vs 해석 실패"를 가른다(02a ★9).
const REAL_WIDGET = '@/widgets/itinerary-edit/ui/ManualEditShell';

const BOUNDARY_RULE = 'import/no-restricted-paths';
const UNRESOLVED_RULE = 'import/no-unresolved';

// 13개 feature 를 손으로 나열하지 않고 디렉토리에서 읽는다 — 새 feature 가 생기면 자동 편입돼
// 하드코딩 드리프트를 막는다(zone 생성도 구현부에서 같은 방식을 요구, AC-2).
function readFeatureNames(): string[] {
  return fs
    .readdirSync(FEATURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const FEATURES = readFeatureNames();

let eslint: ESLint;

beforeAll(() => {
  // 인스턴스 1개를 재사용한다(config 는 최초 1회만 로드 — 30+ 프로브가 빨라진다).
  eslint = new ESLint();
});

// filePath 위치에서 code 를 린트하고, severity=error 인 메시지의 룰 ID 배열만 뽑는다.
// 개수가 아니라 "어느 룰이 잡았는가"를 본다 — 개수만 세면 다른 룰이 대신 잡아도 통과한다.
async function lint(
  code: string,
  filePath: string
): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(filePath),
  });
  return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
}

// home 이면 onboarding 을, 그 외에는 home 을 형제 대상으로 — 같은 feature import(정당)로
// 거짓 red 가 나는 것을 피한다.
function siblingTarget(feature: string): string {
  return feature === 'home' ? REAL_FEATURE_ONB : REAL_FEATURE_HOME;
}

describe('feature 목록 앵커 — 디렉토리에서 읽어 드리프트를 막는다', () => {
  it('src/features 에 13개 이상 슬라이스가 있고 대표 이름을 포함한다', () => {
    expect(FEATURES.length).toBeGreaterThanOrEqual(13);
    expect(FEATURES).toEqual(
      expect.arrayContaining([
        'auth',
        'home',
        'onboarding',
        'stay',
        'itinerary',
      ])
    );
  });
});

describe('AC-3(a) · features/<x> → 다른 feature import 는 13개 전부에서 경계 위반', () => {
  it.each(FEATURES)(
    'features/%s 가 형제 feature 를 import 하면 no-restricted-paths 로 잡힌다',
    async (feature) => {
      const ruleIds = await lint(
        `import '${siblingTarget(feature)}';\n`,
        `src/features/${feature}/__layer_probe__.ts`
      );

      expect(ruleIds).toContain(BOUNDARY_RULE);
      expect(ruleIds).not.toContain(UNRESOLVED_RULE);
    }
  );
});

describe('AC-3(b) · features/<x> → @/pages import 는 13개 전부에서 역방향 위반', () => {
  it.each(FEATURES)(
    'features/%s 가 pages 를 import 하면 no-restricted-paths 로 잡힌다',
    async (feature) => {
      const ruleIds = await lint(
        `import '${REAL_PAGE}';\n`,
        `src/features/${feature}/__layer_probe__.ts`
      );

      expect(ruleIds).toContain(BOUNDARY_RULE);
      expect(ruleIds).not.toContain(UNRESOLVED_RULE);
    }
  );
});

describe('AC-3 · 나머지 층 방향 탐침 — 상위 층 참조 금지', () => {
  it('shared/** 가 features 를 import 하면 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_FEATURE_HOME}';\n`,
      'src/shared/__probe__/x.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  it('entities/** 가 features 를 import 하면 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_FEATURE_HOME}';\n`,
      'src/entities/x/model/probe.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  it('widgets/** 가 pages 를 import 하면 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_PAGE}';\n`,
      'src/widgets/x/ui/probe.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  it('pages/** 가 app-shell 을 import 하면 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_APP_SHELL}';\n`,
      'src/pages/__probe__/x.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  // 🔴 D9 — features/<x> 는 widgets(위층)를 역참조 못 한다. 실대상이라 red(미해석) → green(경계 발화).
  it('features/** 가 @/widgets 를 import 하면 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_WIDGET}';\n`,
      'src/features/home/__layer_probe__.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });
});

describe('AC-3 · 허용 방향은 경계 룰이 침묵한다', () => {
  it('features/** → @/shared 는 위반 0 (해석 가능한 실대상)', async () => {
    const ruleIds = await lint(
      `import '${REAL_SHARED}';\n`,
      'src/features/home/__probe__/x.ts'
    );

    expect(ruleIds).toEqual([]);
  });

  // 같은 feature 안의 import(자기참조)는 except 로 허용된다 — except 가 상대 glob 이면
  // eslint-plugin-import 가 resolve 하지 않아 이 정당한 import 가 전부 위반으로 잡힌다
  // (5-b 뮤테이션 실측: 상대 glob 복귀 시 이 프로브만 red, 나머지 프로브는 전부 green 유지).
  it('features/home → 같은 feature 내부 import 는 위반 0', async () => {
    const ruleIds = await lint(
      `import '${REAL_FEATURE_HOME}';\n`,
      'src/features/home/ui/__probe__.tsx'
    );

    expect(ruleIds).toEqual([]);
  });

  it('widgets/** → @/features 는 위반 0 (해석 가능한 실대상)', async () => {
    const ruleIds = await lint(
      `import '${REAL_FEATURE_HOME}';\n`,
      'src/widgets/x/ui/probe.ts'
    );

    expect(ruleIds).toEqual([]);
  });

  // 빈 층(entities·widgets)은 실대상이 없어 no-unresolved 가 뜬다(D2) — error 0 은 원리적으로
  // 불가하고, "경계 룰이 이 허용 방향을 막지 않는다"만 단언한다. error 0 확인은 층 입주 후 별건.
  it('features/** → @/entities 는 경계 룰이 막지 않는다', async () => {
    const ruleIds = await lint(
      `import '${EMPTY_ENTITIES}';\n`,
      'src/features/home/__probe__/x.ts'
    );

    expect(ruleIds).not.toContain(BOUNDARY_RULE);
  });

  // 🔴 D9 승격 — widgets 가 실파일이라 이제 error 0 을 단언한다(구 EMPTY_WIDGETS "경계 미발화"보다 강함).
  it('pages/** → @/widgets 는 위반 0 (해석 가능한 실대상)', async () => {
    const ruleIds = await lint(
      `import '${REAL_WIDGET}';\n`,
      'src/pages/__probe__/x.ts'
    );

    expect(ruleIds).toEqual([]);
  });
});
