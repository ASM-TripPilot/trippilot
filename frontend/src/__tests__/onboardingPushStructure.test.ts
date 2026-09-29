/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1108 AC-9 · R10 — 푸시 권한을 **어디서** 묻는지를 소스 수준에서 잠근다.
 *
 * 무엇을 보장하나:
 *  - 일정 생성 두 화면(`pages/itinerary-generating`·`pages/itinerary-manual`)은 권한 루틴
 *    `promptAndRegisterPush` 를 참조하지 않는다 — 생성 중 설명 없는 OS 창 금지(TRIP-835 시점 결정 뒤집기).
 *  - 그 루틴은 온보딩 푸시 카드 페이지(`pages/onboarding-push`)가 부른다(긍정 짝 — 없으면 위 부정이
 *    "아무 데서도 안 부른다"로 공허 통과한다).
 *  - 카드 컴포넌트는 배럴(`@/shared/push`)에서 재수출하지 않고 딥 경로로 쓴다 — 배럴을 통째로 목으로
 *    바꿔 끼우는 테스트가 8파일이라, 배럴에 카드를 넣으면 그 테스트들에서 카드가 `undefined` 가 된다.
 *
 * 행위 테스트(`GeneratingPage.push`·`ManualPlanPage.push` 의 0회 단언)와 **이중 그물**이다 — 행위는
 * 실제 호출을, 이 스캔은 import·참조 자체를 본다.
 *
 * **전제**: 모든 스캔은 주석을 걷은 소스를 본다(설명 주석 속 이름이 위반으로 잡히지 않게).
 * **가짜 통과 방지(리포 관례)**: "없어야 한다"는 같은 it 안의 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

const GENERATING_DIR_REL = 'pages/itinerary-generating';
const MANUAL_DIR_REL = 'pages/itinerary-manual';
const ONBOARDING_PUSH_DIR_REL = 'pages/onboarding-push';
const PUSH_BARREL_REL = 'shared/push/index.ts';
const PUSH_PAGE_REL = 'pages/onboarding-push/ui/PushPage.tsx';

/**
 * 스캔 전처리 — 블록 주석을 먼저, 그다음 줄 주석을 지운다. 줄 주석은 **바로 앞 글자가 `:` 이면**
 * 주석으로 보지 않는다(`'https://…'` 보존 — 리포 관례).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 루틴 이름이 코드에 나타남(import·호출·참조 전부). */
const PROMPT_REF = /\bpromptAndRegisterPush\b/;
/** 루틴 호출. */
const PROMPT_CALL = /\bpromptAndRegisterPush\s*\(/;
/** 카드를 딥 경로로 import. */
const CARD_DEEP_IMPORT = /from\s*['"]@\/shared\/push\/PushPreprompt['"]/;
/** 푸시 배럴(하위 경로 없이) import. */
const BARREL_IMPORT = /from\s*['"]@\/shared\/push['"]/;

/** dir(src 기준 상대) 아래 테스트가 아닌 .ts/.tsx 전부(상대경로, 정렬). */
function listProductionFiles(dirRel: string): string[] {
  const walk = (full: string): string[] => {
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
      const child = path.join(full, entry.name);
      if (entry.isDirectory()) return walk(child);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [path.relative(ROOT, child).split(path.sep).join('/')];
    });
  };
  return walk(path.join(ROOT, dirRel)).sort();
}

function readStripped(fileRel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, fileRel), 'utf8'));
}

describe('G0 · 탐지기 자가검사 — 주석 걷기와 탐지를 함께 태운다', () => {
  it('코드의 import·호출은 잡고, 주석 속 언급은 못 잡고, URL 뒤 같은 줄 호출도 잡는다', () => {
    const code = [
      "import { promptAndRegisterPush } from '@/shared/push';",
      "import { PushPreprompt } from '@/shared/push/PushPreprompt';",
      'void promptAndRegisterPush();',
    ].join('\n');
    const commented = [
      '// 생성 시점에는 promptAndRegisterPush 를 부르지 않는다(TRIP-1108)',
      '/* void promptAndRegisterPush(); */',
      '/**',
      ' * promptAndRegisterPush() 는 온보딩 카드에서만',
      ' */',
    ].join('\n');
    const urlThenCall =
      "const u = 'https://example.com'; void promptAndRegisterPush();";

    // 양성 — 전처리를 거쳐도 살아남는다
    expect(PROMPT_REF.test(stripComments(code))).toBe(true);
    expect(PROMPT_CALL.test(stripComments(code))).toBe(true);
    expect(CARD_DEEP_IMPORT.test(stripComments(code))).toBe(true);
    expect(BARREL_IMPORT.test(stripComments(code))).toBe(true);
    // 음성 — 주석뿐인 언급은 걷힌다
    expect(PROMPT_REF.test(stripComments(commented))).toBe(false);
    // 조합 — URL 의 `//` 를 줄 주석으로 오인해 뒤의 호출까지 지우지 않는다
    expect(PROMPT_CALL.test(stripComments(urlThenCall))).toBe(true);
    // 경계 — 배럴 탐지기는 딥 경로를, 딥 탐지기는 배럴을 잡지 않는다
    expect(BARREL_IMPORT.test("from '@/shared/push/PushPreprompt'")).toBe(
      false
    );
    expect(CARD_DEEP_IMPORT.test("from '@/shared/push'")).toBe(false);
  });
});

describe('🔴 TRIP-1108 AC-9 · 권한 루틴은 생성 화면이 아니라 온보딩 카드에서 부른다', () => {
  it('생성 두 슬라이스 소스에 루틴 참조 0건이고, 온보딩 푸시 슬라이스에는 호출이 있다', () => {
    const generationFiles = [
      ...listProductionFiles(GENERATING_DIR_REL),
      ...listProductionFiles(MANUAL_DIR_REL),
    ];
    // 모집단 앵커 — 스캔이 실제로 두 화면을 훑었다(빈 목록이면 아래 부정이 공허하다)
    expect(generationFiles).toEqual(
      expect.arrayContaining([
        'pages/itinerary-generating/ui/GeneratingPage.tsx',
        'pages/itinerary-manual/ui/ManualPlanPage.tsx',
      ])
    );

    // 부정 — 생성 화면에서 루틴을 참조하는 파일 0
    const offenders = generationFiles.filter((file) =>
      PROMPT_REF.test(readStripped(file))
    );
    expect(offenders).toEqual([]);

    // 긍정 짝 — 온보딩 푸시 슬라이스가 루틴을 실제로 부른다
    const callers = listProductionFiles(ONBOARDING_PUSH_DIR_REL).filter(
      (file) => PROMPT_CALL.test(readStripped(file))
    );
    expect(callers.length).toBeGreaterThanOrEqual(1);
  });
});

describe('🔴 TRIP-1108 R10 · 카드는 딥 경로, 루틴은 배럴', () => {
  it('배럴은 루틴을 내보내되 카드는 내보내지 않고, 푸시 페이지는 카드를 딥 경로로·루틴을 배럴로 가져온다', () => {
    const barrel = readStripped(PUSH_BARREL_REL);
    // 긍정 짝 — 배럴이 비어서 통과하는 게 아니다
    expect(PROMPT_REF.test(barrel)).toBe(true);
    // 부정 — 카드 재수출 없음
    expect(/PushPreprompt/.test(barrel)).toBe(false);

    const page = readStripped(PUSH_PAGE_REL);
    expect(CARD_DEEP_IMPORT.test(page)).toBe(true);
    expect(BARREL_IMPORT.test(page)).toBe(true);
  });
});
