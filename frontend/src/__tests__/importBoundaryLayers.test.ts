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
const REAL_FEATURE_HOME = '@/features/home/ui/HomeGlyphs';
const REAL_FEATURE_ONB = '@/features/edit-preferences/model/preferenceStore';
const REAL_PAGE = '@/pages/trip/trip-new-step1/ui/TripNewStep1Page';
const REAL_SHARED = '@/shared/ui/BottomTabBar';
const REAL_APP_SHELL = '@/app-shell';

// entities 는 여전히 빈 층이라 실대상이 없다 — import 대상으로 쓰면 no-unresolved 가 뜬다(아래 허용 프로브).
const EMPTY_ENTITIES = '@/entities/__probe__/model/x';

// widgets 는 TRIP-805 로 처음 채워졌다(D9 승격) — 대상이 실파일이어야 이 딥 경로가 해석된다. 배럴이
// 아니라 딥 파일을 쓰는 이유는 importBoundary 선례(배럴 해석 회피)와 같다 — no-unresolved 를 확실히
// 끊어 "경계 위반 vs 해석 실패"를 가른다(02a ★9). TRIP-753: 옛 대상(itinerary-edit/ManualEditShell)이
// 슬라이스째 삭제돼 실재 위젯 파일(map-sheet-shell/SheetHeader)로 옮겼다.
const REAL_WIDGET = '@/widgets/map-sheet-shell/ui/SheetHeader';

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

// 본 단계 실파일(입주 후) — features → entities 하향 허용 프로브 대상. TRIP-1157 부터 슬라이스 밖 하향은 공개 API(index)로만
// 허용되므로 딥 실파일이 아니라 index 를 겨눈다(딥이면 딥 zone 위반).
const REAL_ENTITY_PLACE = '@/entities/place';

// TRIP-807 입주 실파일 — 806 이 it.todo 로 보류한 entities 형제 차단·하향 프로브를 이 실파일로 활성화한다.
// stay 슬라이스가 생기면 eslint 층 zone(readSlices('entities'))이 자동 편입해 place→stay 가 경계 위반이 된다.
const REAL_ENTITY_STAY = '@/entities/stay/ui/StaySearchCard';

// TRIP-1157 공개 API — 하향 허용 프로브는 index 를 겨눈다(딥 실파일은 딥 zone 위반). 형제 차단 프로브는 위 딥 실파일 그대로.
const ENTITY_STAY_API = '@/entities/stay';

describe('AC-P0-3 · 같은 층 형제 슬라이스는 서로 import 하지 못한다', () => {
  // 🔴 pages 슬라이스 간 직접 import → 경계 위반(실파일이라 no-unresolved 아님).
  // 같은 그룹 형제를 고른다 — 그룹은 탐색용 폴더일 뿐 격리는 그대로다. 다른 그룹 쌍은 readSlices 가 그룹을
  // 슬라이스로 잘못 봐도 error 라 그 회귀를 못 잡는다(TRIP-1156).
  it('pages/trip/trip-new-step2 → 같은 그룹 형제 pages/trip/trip-new-step1 import 는 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_PAGE}';\n`,
      'src/pages/trip/trip-new-step2/__slice_probe__.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  // 🔴 widgets 슬라이스 간 직접 import → 경계 위반(실파일).
  it('widgets/time-sheet → 형제 widgets/map-sheet-shell import 는 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_WIDGET}';\n`,
      'src/widgets/time-sheet/__slice_probe__.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  // 🔴 TRIP-807 활성화 — entities/stay/ui/StaySearchCard 실파일이 생겨 resolve 되므로, 이제
  //    place→stay 직접 import 가 no-restricted-paths 로 잡힌다(before: 미해석 no-unresolved red →
  //    after: 실파일 생성 후 boundary green). 806 이 it.todo 로 보류했던 자리.
  it('entities/place → 형제 entities/stay 직접 import 는 경계 위반', async () => {
    const ruleIds = await lint(
      `import '${REAL_ENTITY_STAY}';\n`,
      'src/entities/place/__slice_probe__.ts'
    );

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });
});

describe('AC-P0-2 · entities 교차는 @x 창구로만 허용된다', () => {
  // @x 창구 프로브는 여전히 it.todo — 실제 교차 필요가 0 이라 프로브용 빈 `entities/stay/@x/place/**`
  // 창구 파일을 만드는 것은 layer-entities.md "@x 는 필요할 때 만든다" 규약 위반 = 게이밍이다(TRIP-807
  // 3-a·01b §가정). 첫 실제 entities 교차(@x 창구)가 필요한 티켓에서 그 실폴더 딥 경로로 활성화한다.
  it.todo(
    'entities/place → entities/stay/@x/place 창구는 경계 룰이 막지 않는다 — 실제 교차 0(프로브용 빈 창구는 게이밍), 첫 @x 창구 도입 티켓에서 실폴더 딥 경로로 활성화'
  );
});

describe('AC-M8 · [본 단계] entities 입주 후 하향 허용 방향은 error 0 이다', () => {
  // 🔴 features/** → @/entities/place/ui/* 는 실파일 딥 경로라 이제 error 0 을 단언한다
  //    (구 EMPTY_ENTITIES "경계 미발화"보다 강함, widgets D9 승격 선례). place 파일 생성 전엔
  //    no-unresolved 로 red → 생성 후 green.
  // TRIP-1157: 슬라이스 밖 하향 import 는 공개 API(index)로만 — 딥 실파일 대상은 이제 딥 zone 위반이라 index 로 겨눈다.
  it('features/** → @/entities/place 공개 API 는 위반 0', async () => {
    const ruleIds = await lint(
      `import '${REAL_ENTITY_PLACE}';\n`,
      'src/features/home/__layer_probe__.ts'
    );

    expect(ruleIds).toEqual([]);
  });

  // 🔴 TRIP-807 — features → @/entities/stay/ui 하향(허용 방향)도 실파일 생성 후 error 0.
  //    생성 전엔 no-unresolved 로 red → 생성 후 green(place 프로브 동형).
  it('features/** → @/entities/stay 공개 API 는 위반 0', async () => {
    const ruleIds = await lint(
      `import '${ENTITY_STAY_API}';\n`,
      'src/features/home/__layer_probe__.ts'
    );

    expect(ruleIds).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-1145 · 출시·보안 소스 스캔을 eslint 규칙으로 옮긴 뒤 그 규칙이 실제로 발동하는지 본다
// (원 스캔: noMswInStaticGraph · deleteAccountDialogGate · noDeadHandlers 전체, recordPhotoBinaryGuard G3 ·
// shareCardStructure G5 · stayRecommendStructure 프리뷰 데이터 · itineraryCoPickStructure 콘솔 일부).
//
// ⚠️ flat config 는 같은 규칙을 거는 블록이 여럿이면 **뒤 블록 옵션이 앞 블록을 통째로 덮는다**(합쳐지지
//    않는다). StateNotice·shareCaptureNative 예외 블록은 공통 금지 목록을 펼쳐 다시 선언해야 한다 —
//    아래 "덮어쓰기" describe 가 양쪽 목록이 함께 살아 있는지 본다(02a ★1, 실측으로 useState 금지 소실 확인).
// ⚠️ `no-restricted-imports` 는 정적 import·export-from 만 본다 — require()·import() 는 안 본다(02a ★2).
//    그래서 shared/photo 의 호출 시점 require 와 shareCapture.ts 의 동적 import 는 예외 블록 없이 허용된다.
// 정상 탐침은 import 대상을 실파일로, JSX 는 실컴포넌트(Pressable)로 써야 `[]` 를 단언할 수 있다(★3·★7).

const RESTRICTED_IMPORTS = 'no-restricted-imports';
const RESTRICTED_SYNTAX = 'no-restricted-syntax';
const NO_CONSOLE = 'no-console';

const PROD_PROBE = 'src/features/home/__release_probe__.ts';
const PHOTO_PROBE = 'src/shared/photo/__release_probe__.ts';
const REFLECTION_UI_PROBE =
  'src/features/share-trip-card/ui/__release_probe__.ts';
const REFLECTION_MODEL_PROBE =
  'src/features/share-trip-card/model/__release_probe__.ts';
// 캡처 어댑터 자신의 경로 — 예외 블록이 이 파일에만 걸린다.
const CAPTURE_ADAPTER =
  'src/features/share-trip-card/model/shareCaptureNative.ts';
const STATE_NOTICE = 'src/shared/ui/StateNotice.tsx';
const ROUTE_PROBE = 'src/app/trips/__release_probe__.tsx';
const PAGE_PROBE = 'src/pages/__release_probe__/x.tsx';
const SETTINGS_UI_PROBE =
  'src/pages/settings/settings/ui/__release_probe__.tsx';
const DEV_PREVIEW_PROBE = 'src/app/_dev/__release_probe__.tsx';

describe('msw·목은 앱 코드에 들어오지 않는다 (noMswInStaticGraph 이관)', () => {
  it.each([
    ['msw', "import { http } from 'msw';\nexport const probe = http;\n"],
    [
      'msw/node',
      "import { setupServer } from 'msw/node';\nexport const probe = setupServer;\n",
    ],
    [
      '@/mocks',
      "import { server } from '@/mocks/server';\nexport const probe = server;\n",
    ],
  ])('프로덕션 파일이 %s 를 import 하면 error', async (_label, code) => {
    const ruleIds = await lint(code, PROD_PROBE);

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it.each([
    [
      '통합 테스트 파일',
      'src/features/home/__release_probe__.integration.test.ts',
    ],
    ['src/mocks 안', 'src/mocks/__release_probe__.ts'],
  ])(
    '%s 에서 msw import 는 error 0 (테스트 오라클 자리)',
    async (_label, filePath) => {
      const ruleIds = await lint(
        "import { http } from 'msw';\nexport const probe = http;\n",
        filePath
      );

      expect(ruleIds).toEqual([]);
    }
  );

  // 5-b B1 — 원 스캔은 별칭만이 아니라 상대경로 `../mocks/…` 도 잡았다(src/mocks/server → msw/node 부팅 크래시).
  it.each([
    ['두 칸 위', PROD_PROBE, '../../mocks/server'],
    ['한 칸 위', 'src/app/__release_probe__.ts', '../mocks/handlers'],
  ])(
    '프로덕션 파일이 src/mocks 를 상대경로(%s)로 import 하면 error',
    async (_label, filePath, spec) => {
      const ruleIds = await lint(
        `import * as mocks from '${spec}';\nexport const probe = mocks;\n`,
        filePath
      );

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  // 짝 — `__mocks__`(jest 수동 목 폴더)는 `mocks` 와 다른 경로 조각이라 같은 패턴에 걸리지 않는다.
  it('이름에 mocks 가 들어가도 __mocks__ 경로는 이 금지에 걸리지 않는다', async () => {
    const ruleIds = await lint(
      "import * as notifications from '../../../__mocks__/expo-notifications';\nexport const probe = notifications;\n",
      PROD_PROBE
    );

    expect(ruleIds).toEqual([]);
  });
});

describe('네이티브 사진·캡처 모듈은 정적으로 끌지 않는다 (recordPhotoBinaryGuard G3 · shareCardStructure G5 이관)', () => {
  it('shared/photo 입구도 expo-image-picker 를 정적 import 하면 error', async () => {
    const ruleIds = await lint(
      "import * as ImagePicker from 'expo-image-picker';\nexport const probe = ImagePicker;\n",
      PHOTO_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it('shared/photo 입구가 함수 안에서 require 로 여는 것은 error 0', async () => {
    const ruleIds = await lint(
      "export const probe = () =>\n  // eslint-disable-next-line @typescript-eslint/no-require-imports\n  require('expo-image-picker') as typeof import('expo-image-picker');\n",
      PHOTO_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  it.each([
    [
      'import',
      "import { captureRef } from 'react-native-view-shot';\nexport const probe = captureRef;\n",
    ],
    ['export-from', "export { captureRef } from 'react-native-view-shot';\n"],
  ])(
    '어댑터 밖 feature 가 캡처 패키지를 %s 로 끌면 error',
    async (_label, code) => {
      const ruleIds = await lint(code, REFLECTION_UI_PROBE);

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  it.each([
    ['같은 폴더 상대경로', REFLECTION_MODEL_PROBE, './shareCaptureNative'],
    ['상위 상대경로', REFLECTION_UI_PROBE, '../model/shareCaptureNative'],
    [
      '@ 별칭',
      REFLECTION_UI_PROBE,
      '@/features/share-trip-card/model/shareCaptureNative',
    ],
  ])(
    '캡처 어댑터를 %s 로 정적 import 하면 error',
    async (_label, filePath, spec) => {
      const ruleIds = await lint(
        `import { shareAsync } from '${spec}';\nexport const probe = shareAsync;\n`,
        filePath
      );

      expect(ruleIds).toContain(RESTRICTED_IMPORTS);
    }
  );

  it('캡처 어댑터를 동적 import() 로 부르는 것은 error 0', async () => {
    const ruleIds = await lint(
      "export const probe = () => import('./shareCaptureNative');\n",
      REFLECTION_MODEL_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  it('어댑터 파일은 캡처 3종을 정적으로 다시 내보내도 error 0', async () => {
    const ruleIds = await lint(
      [
        "export { captureRef } from 'react-native-view-shot';",
        "export { saveToLibraryAsync } from 'expo-media-library';",
        "export { shareAsync } from 'expo-sharing';",
        '',
      ].join('\n'),
      CAPTURE_ADAPTER
    );

    expect(ruleIds).toEqual([]);
  });

  it('어댑터 파일이라도 사진 피커는 error (캡처 3종만 허용)', async () => {
    const ruleIds = await lint(
      "import * as ImagePicker from 'expo-image-picker';\nexport const probe = ImagePicker;\n",
      CAPTURE_ADAPTER
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  // 5-b W4 — 원 스캔은 하위 경로 import 도 잡았다(패키지 루트 이름만 막으면 `pkg/build/X` 로 샌다).
  it.each([
    ['expo-image-picker/build/ImagePicker'],
    ['expo-media-library/build/MediaLibrary'],
    ['react-native-view-shot/src/index'],
    ['expo-sharing/build/Sharing'],
  ])('네이티브 모듈의 하위 경로 %s 를 정적 import 하면 error', async (spec) => {
    const ruleIds = await lint(
      `import * as nativeModule from '${spec}';\nexport const probe = nativeModule;\n`,
      'src/features/record/__release_probe__.ts'
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });
});

describe('★ 덮어쓰기 함정 — 예외 블록이 있는 파일에서도 공통 금지와 자기 금지가 함께 산다', () => {
  // 선제 green — 지금 있는 StateNotice 금지가 새 전역 블록에 덮여 사라지지 않는지(덮이면 red).
  it('StateNotice.tsx 의 기존 금지(useState)가 계속 error', async () => {
    const ruleIds = await lint(
      "import { useState } from 'react';\nexport const probe = useState;\n",
      STATE_NOTICE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it.each([
    ['StateNotice.tsx', STATE_NOTICE],
    ['캡처 어댑터', CAPTURE_ADAPTER],
  ])('%s 에서도 공통 금지(msw)가 error', async (_label, filePath) => {
    const ruleIds = await lint(
      "import { http } from 'msw';\nexport const probe = http;\n",
      filePath
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });
});

describe('개발 프리뷰의 가짜 데이터는 앱 코드가 끌지 않는다 (stayRecommendStructure 일부 이관)', () => {
  it.each([
    ['@ 별칭', '@/app/_dev/preview'],
    ['상대경로', '../_dev/preview'],
  ])('라우트 파일이 프리뷰를 %s 로 import 하면 error', async (_label, spec) => {
    const ruleIds = await lint(
      `import Preview from '${spec}';\nexport const probe = Preview;\n`,
      ROUTE_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_IMPORTS);
  });

  it('라우트 파일이 page 를 import 하는 것은 error 0', async () => {
    const ruleIds = await lint(
      "import { HomePage } from '@/pages/home';\nexport const probe = HomePage;\n",
      ROUTE_PROBE
    );

    expect(ruleIds).toEqual([]);
  });
});

describe('디버그 콘솔 출력은 앱 코드에 남지 않는다 (itineraryCoPickStructure 일부 이관)', () => {
  const CONSOLE_CODE =
    "export function probe() {\n  console.log('PROBE');\n}\n";

  it('프로덕션 파일의 console.log 는 error', async () => {
    const ruleIds = await lint(CONSOLE_CODE, PAGE_PROBE);

    expect(ruleIds).toContain(NO_CONSOLE);
  });

  it('테스트 파일의 console.log 는 이 규칙 대상이 아니다', async () => {
    const ruleIds = await lint(
      CONSOLE_CODE,
      'src/pages/__release_probe__/x.test.tsx'
    );

    expect(ruleIds).not.toContain(NO_CONSOLE);
  });
});

describe('계정 삭제 다이얼로그는 1단계부터만 열린다 (deleteAccountDialogGate 이관)', () => {
  const dialogTag = (props: string, importPath = './DeleteAccountDialog') =>
    [
      `import { DeleteAccountDialog } from '${importPath}';`,
      'declare const noop: () => void;',
      'declare const rest: { onCancel: () => void; onConfirmDeletion: () => void };',
      `export const Probe = () => <DeleteAccountDialog ${props} />;`,
      '',
    ].join('\n');

  it('features 에서 onCancel·onConfirmDeletion 밖 prop(initialStep)을 넘기면 error', async () => {
    const ruleIds = await lint(
      dialogTag('initialStep="final" onCancel={noop} onConfirmDeletion={noop}'),
      SETTINGS_UI_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  // ★ no-restricted-syntax 도 tsx 전역 블록과 pages·app 블록이 겹친다 — pages 쪽이 게이트를 덮어 지우면 red.
  it('pages 에서 initialStep 을 넘겨도 error', async () => {
    const ruleIds = await lint(
      dialogTag(
        'initialStep="final" onCancel={noop} onConfirmDeletion={noop}',
        '@/pages/settings/settings/ui/DeleteAccountDialog'
      ),
      PAGE_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  it('props 를 펼쳐 넘기면(숨은 initialStep 통로) error', async () => {
    const ruleIds = await lint(dialogTag('{...rest}'), SETTINGS_UI_PROBE);

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  // 5-b W3 — 다른 이름으로 들여오면 태그 이름 검사(`<DeleteAccountDialog`)를 통째로 비켜 간다.
  it('다른 이름으로 import 하면(별칭) 넘기는 prop 과 무관하게 error', async () => {
    const ruleIds = await lint(
      [
        "import { DeleteAccountDialog as Dialog } from './DeleteAccountDialog';",
        'declare const noop: () => void;',
        'export const Probe = () => <Dialog onCancel={noop} onConfirmDeletion={noop} />;',
        '',
      ].join('\n'),
      SETTINGS_UI_PROBE
    );

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  it('onCancel·onConfirmDeletion 두 prop 만 넘기면 error 0', async () => {
    const ruleIds = await lint(
      dialogTag('onCancel={noop} onConfirmDeletion={noop}'),
      SETTINGS_UI_PROBE
    );

    expect(ruleIds).toEqual([]);
  });

  it('개발 프리뷰(app/_dev)는 2단계 얼굴을 보여 주려 initialStep 을 넘겨도 error 0', async () => {
    const ruleIds = await lint(
      dialogTag(
        'initialStep="final" onCancel={noop} onConfirmDeletion={noop}',
        '@/pages/settings/settings/ui/DeleteAccountDialog'
      ),
      DEV_PREVIEW_PROBE
    );

    expect(ruleIds).toEqual([]);
  });
});

describe('pages·app 은 아무것도 안 하는 핸들러를 넘기지 않는다 (noDeadHandlers 이관, 심사 2.1)', () => {
  const pressable = (attr: string) =>
    [
      "import { Pressable } from 'react-native';",
      'declare function go(): void;',
      'declare const onPressTab: (() => void) | undefined;',
      `export const Probe = () => (\n  <Pressable\n${attr}\n  />\n);`,
      '',
    ].join('\n');

  it.each([
    ['빈 본문', PAGE_PROBE, '    onPress={() => {}}'],
    [
      '줄주석만 있는 본문',
      PAGE_PROBE,
      '    onPress={() => {\n      // 후속 티켓 } 에서 배선\n    }}',
    ],
    [
      '블록주석만 있는 본문',
      PAGE_PROBE,
      '    onPress={() => { /* 준비 중 */ }}',
    ],
    ['명시적 undefined', ROUTE_PROBE, '    onLongPress={undefined}'],
  ])('%s 핸들러는 error', async (_label, filePath, attr) => {
    const ruleIds = await lint(pressable(attr), filePath);

    expect(ruleIds).toContain(RESTRICTED_SYNTAX);
  });

  it.each([
    ['실제 호출 본문', '    onPress={() => {\n      go();\n    }}'],
    ['옵셔널 콜백의 기본값', '    onPress={onPressTab ?? (() => {})}'],
    [
      'eslint-disable 사유가 붙은 허용 자리',
      '    // eslint-disable-next-line no-restricted-syntax -- 화면이 편집을 로컬로 연다(BR-U5-36)\n    onPress={() => {}}',
    ],
  ])('%s 는 error 0', async (_label, attr) => {
    const ruleIds = await lint(pressable(attr), PAGE_PROBE);

    expect(ruleIds).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRIP-1157 · 공개 API 강제 — 슬라이스(·shared 세그먼트) 밖에서는 index*(공개 API)로만 import 한다.
//
// 딥 zone 은 층 zone 과 같은 규칙(import/no-restricted-paths)이라 룰 ID 로는 못 가른다 → 메시지의
// TRIP-1157 표식으로 센다. 대상은 전부 실파일(해석돼야 경계 규칙이 뜬다 — 미해석이면 no-unresolved 로 샌다).
// 프로브 위치(filePath)도 실슬라이스여야 한다 — zone target 은 readSlices 가 읽은 슬라이스뿐이라
// `src/pages/__probe__` 같은 가짜 폴더에서는 딥 zone 이 원리적으로 안 뜬다.
// 테스트·_dev 는 zone 밖이다(jest.mock 은 정의 모듈을 겨눠야 index 소비처까지 가로챈다 — 01 §5 실측 A·C).

const DEEP_TAG = 'TRIP-1157';
async function deepHits(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, {
    filePath: path.resolve(filePath),
  });
  return result.messages.filter(
    (m) =>
      m.severity === 2 &&
      m.ruleId === BOUNDARY_RULE &&
      m.message.includes(DEEP_TAG)
  ).length;
}

const HOME_PAGE_PROBE = 'src/pages/home/ui/__deep_probe__.tsx';

describe('TRIP-1157 · 슬라이스 밖 딥 import 는 공개 API 위반이다', () => {
  it.each([
    [
      'pages → features 내부(import)',
      HOME_PAGE_PROBE,
      `import '@/features/home/ui/HomeGlyphs';\n`,
    ],
    [
      'pages → features 내부(export-from)',
      HOME_PAGE_PROBE,
      `export { HomeGlyph } from '@/features/home/ui/HomeGlyphs';\n`,
    ],
    [
      'pages → features 내부(import())',
      HOME_PAGE_PROBE,
      `export const load = () => import('@/features/home/ui/HomeGlyphs');\n`,
    ],
    [
      'pages → features 내부(함수 안 require)',
      HOME_PAGE_PROBE,
      `export const load = () => require('@/features/home/ui/HomeGlyphs');\n`,
    ],
    [
      'widgets → entities 내부',
      'src/widgets/time-sheet/ui/__deep_probe__.tsx',
      `import '@/entities/itinerary-slot/lib/endsNextDay';\n`,
    ],
    [
      'features → entities 내부',
      'src/features/home/ui/__deep_probe__.tsx',
      `import '@/entities/place/ui/PlaceRailCard';\n`,
    ],
    [
      'features → entities 의 model 폴더 index(슬라이스 루트 아님)',
      'src/features/home/ui/__deep_probe__.tsx',
      `import '@/entities/place/model';\n`,
    ],
    [
      'entities → shared 세그먼트 내부',
      'src/entities/place/ui/__deep_probe__.tsx',
      `import '@/shared/date/seoulDate';\n`,
    ],
    [
      'pages → shared/ui 하위 폴더 내부',
      HOME_PAGE_PROBE,
      `import '@/shared/ui/pref/PrefChip';\n`,
    ],
    [
      'features → 생성 스키마 내부(진입점은 index.schemas)',
      'src/features/home/ui/__deep_probe__.tsx',
      `import '@/shared/api/generated/schemas';\n`,
    ],
    [
      '라우트(app) → features 내부',
      'src/app/(tabs)/__deep_probe__.tsx',
      `import '@/features/home/ui/HomeGlyphs';\n`,
    ],
    [
      'app-shell → shared 세그먼트 내부',
      'src/app-shell/ui/__deep_probe__.tsx',
      `import '@/shared/date/seoulDate';\n`,
    ],
  ])('%s 는 딥 zone(TRIP-1157) error', async (_label, filePath, code) => {
    const ruleIds = await lint(code, filePath);

    expect(await deepHits(code, filePath)).toBeGreaterThan(0);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });
});

describe('TRIP-1157 · 공개 API·자기 슬라이스·테스트·_dev 는 딥 zone 이 침묵한다', () => {
  it.each([
    ['슬라이스 index', HOME_PAGE_PROBE, `import '@/features/home';\n`],
    [
      'index.<이름> 진입점(index.view)',
      HOME_PAGE_PROBE,
      `import '@/features/explore/index.view';\n`,
    ],
    ['shared 세그먼트 index', HOME_PAGE_PROBE, `import '@/shared/date';\n`],
    [
      'shared/ui 루트 직속 파일(steiger 면제)',
      HOME_PAGE_PROBE,
      `import '@/shared/ui/BottomTabBar';\n`,
    ],
    [
      'shared/ui 하위 폴더 index',
      HOME_PAGE_PROBE,
      `import '@/shared/ui/pref';\n`,
    ],
    [
      'shared/api 진입점(index.schemas)',
      HOME_PAGE_PROBE,
      `import '@/shared/api/index.schemas';\n`,
    ],
    [
      '자기 슬라이스 내부',
      'src/features/home/model/__deep_probe__.ts',
      `import '@/features/home/ui/HomeGlyphs';\n`,
    ],
    [
      '테스트 파일의 딥 import',
      'src/pages/home/ui/__deep_probe__.test.tsx',
      `import '@/features/home/ui/HomeGlyphs';\n`,
    ],
    [
      '개발 프리뷰(_dev)의 딥 import',
      'src/app/_dev/__deep_probe__.tsx',
      `import '@/features/home/ui/HomeGlyphs';\n`,
    ],
  ])('%s 는 error 0', async (_label, filePath, code) => {
    const ruleIds = await lint(code, filePath);

    expect(ruleIds).toEqual([]);
  });
});
