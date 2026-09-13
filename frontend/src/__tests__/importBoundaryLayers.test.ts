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

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-806 · 0단계 — 같은 층 형제 슬라이스 격리(pages·widgets·entities) + entities @x 창구
//
// 지금까지 층 zone 은 "층 전체가 상위 층을 못 본다"만 강제했다(features 슬라이스 격리는 있었음).
// 이 사이클은 pages·widgets·entities 도 **형제 슬라이스끼리** 서로 못 보게 하고, entities 만
// 교차가 꼭 필요하면 `@x` 창구(`entities/<제공자>/@x/<소비자>/**`)로만 열게 한다.
//
// 프로브 대상 규약(★2·★3, 02a §3-A):
//  - pages·widgets 형제 프로브: **실파일** 딥 경로 → 경계 포함 ∧ no-unresolved 불포함까지 단언.
//  - entities 형제/`@x` 프로브: `no-restricted-paths`(eslint-plugin-import 2.32.0)는 `resolve(importPath)`가
//    실패하면 **조기 반환**해 경계 룰이 아예 안 뜬다(no-unresolved 만). entities 엔 이번 사이클에 `place`
//    하나만 입주해 **실파일 형제가 없으므로**, 합성 경로로는 경계 발화를 원리적으로 관측할 수 없다 —
//    형제 프로브는 영구 red, `@x` 프로브는 teeth 없는 공허 green이 된다(implementer 실측, 03 0단계 절).
//    → 두 케이스를 `it.todo` 로 보류하고 TRIP-807(entities/stay 입주) 시 실파일 딥 경로로 활성화한다.
//    zone 자체가 정확함은 implementer 가 임시 stub(`entities/stay/model/x.ts`)으로 뮤테이션(zone 제거 →
//    red · `@x` except 제거 → red)을 green→red 실측해 확인 후 stub 을 지웠다(2026-09-13, 03 0단계 절).

// 본 단계 실파일(입주 후) — features → entities 하향 허용 프로브 대상.
const REAL_ENTITY_PLACE = '@/entities/place/ui/PlaceRailCard';

describe('AC-P0-3 · 같은 층 형제 슬라이스는 서로 import 하지 못한다', () => {
  // 🔴 pages 슬라이스 간 직접 import → 경계 위반(실파일이라 no-unresolved 아님).
  it('pages/stay-search → 형제 pages/place-explore import 는 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_PAGE}';\n`,
      'src/pages/stay-search/__slice_probe__.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  // 🔴 widgets 슬라이스 간 직접 import → 경계 위반(실파일).
  it('widgets/time-sheet → 형제 widgets/itinerary-edit import 는 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_WIDGET}';\n`,
      'src/widgets/time-sheet/__slice_probe__.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  // entities 형제 프로브는 실파일 형제(entities/stay)가 없어 no-restricted-paths 가 원리적으로
  // 안 뜬다(resolve 실패 → 조기 반환). TRIP-807 입주 시 실파일 딥 경로로 활성화(위 규약 블록·03 0단계 절).
  it.todo(
    'entities/place → 형제 entities/stay 직접 import 는 경계 위반 — TRIP-807 entities/stay 입주 시 실파일 딥 경로로 활성화 · 2026-09-13 stub 뮤테이션 실측 green→red 확인(03 0단계 절)'
  );
});

describe('AC-P0-2 · entities 교차는 @x 창구로만 허용된다', () => {
  // @x 창구 프로브도 같은 뿌리(합성 경로 resolve 실패)로 teeth 없는 공허 green이라 보류한다.
  // TRIP-807 입주 후 실파일 딥 경로로 활성화하면 "형제는 막히고 @x 창구는 통과"를 실제로 가른다.
  it.todo(
    'entities/place → entities/stay/@x/place 창구는 경계 룰이 막지 않는다 — TRIP-807 entities/stay 입주 시 실파일 딥 경로로 활성화 · 2026-09-13 stub 뮤테이션 실측 green→red 확인(03 0단계 절)'
  );
});

describe('AC-M8 · [본 단계] entities 입주 후 하향 허용 방향은 error 0 이다', () => {
  // 🔴 features/** → @/entities/place/ui/* 는 실파일 딥 경로라 이제 error 0 을 단언한다
  //    (구 EMPTY_ENTITIES "경계 미발화"보다 강함, widgets D9 승격 선례). place 파일 생성 전엔
  //    no-unresolved 로 red → 생성 후 green.
  it('features/** → @/entities/place/ui 실파일은 위반 0', async () => {
    const ruleIds = await lint(
      `import '${REAL_ENTITY_PLACE}';\n`,
      'src/features/home/__layer_probe__.ts'
    );

    expect(ruleIds).toEqual([]);
  });
});
