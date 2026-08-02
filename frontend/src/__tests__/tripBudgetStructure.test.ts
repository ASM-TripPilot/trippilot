/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-207 AC-5 — **렌더로는 볼 수 없는 제약**을 소스 층에서 잠근다.
 *
 * 무엇을 보장하나: 예산 천단위 구분을 `toLocaleString`/`Intl`로 찍지 않는다.
 *
 * 왜 소스 스캔인가: node에서 `(1200000).toLocaleString('en-US')`도 `'1,200,000'`을 돌려준다 —
 * **결과가 같아서 동작 테스트가 이 차이를 원리적으로 못 본다.** 갈리는 곳은 앱이 도는 Hermes고,
 * 거기서 로케일 데이터가 없거나 다르면 표기가 달라지는데 그때는 테스트가 이미 다 통과한 뒤다.
 * `formatPrice.ts`가 같은 이유로 주석에 금지를 적어 뒀지만 **기계로 막는 가드는 리포에 없었다** —
 * 이 파일이 그 자리를 메운다(01b D5 · 브리프 §7-① "첫 손이 정확히 이걸 집는다").
 *
 * ⚠️ 전처리와 탐지기의 조합이 서로를 지울 수 있다(2026-07-31 `stripComments` 실사고 계열).
 * 주석을 **안 걷으면** 파일 머리말의 금지 문구("toLocaleString을 쓰지 않는다" — `formatPrice.ts`가
 * 실제로 그렇게 적혀 있고 새 모듈도 같은 관례를 따를 것이다)가 그 자체로 red를 낸다. 걷는데
 * 전처리가 코드까지 먹으면 **거짓 green**이다. 그래서 아래 첫 describe가 탐지기를 먼저 심판한다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const BUDGET_MODULE = join(
  SRC_ROOT,
  'features',
  'trip',
  'model',
  'budgetAmount.ts'
);
const SCREEN = join(
  SRC_ROOT,
  'features',
  'trip',
  'ui',
  'TripWizardStep1Screen.tsx'
);
const PAGE = join(
  SRC_ROOT,
  'pages',
  'trip-new-step1',
  'ui',
  'TripNewStep1Page.tsx'
);

/** 로케일 서식 API — 이 이름들이 **코드에** 있으면 안 된다. */
const FORBIDDEN_LOCALE_APIS = ['toLocaleString', 'Intl.'];

/**
 * 스캔 전처리 — 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가
 * 소실된다). 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** —
 * `'https://…'`의 슬래시를 주석 시작으로 오인하지 않기 위한 것이다
 * (`tripWizardStep1Boundary.test.ts`와 같은 형태 · 완전한 파서를 만들지 않는 것이 의도다).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function existsPair(file: string): { file: string; exists: boolean } {
  return { file, exists: existsSync(file) };
}

describe('탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('주석 속 금칙어는 걷히고, 코드의 금칙어와 URL 줄은 살아남는다', () => {
    const source = [
      '/**',
      ' * 천단위 구분에 toLocaleString/Intl 을 쓰지 않는다 — 로케일 서식이 갈린다.',
      ' * 참조: https://figma.com/design/x',
      ' */',
      "// const bad = String(n).toLocaleString('ko-KR');",
      "const url = 'https://example.com/a';",
      "const good = String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');",
    ].join('\n');

    const stripped = stripComments(source);

    // ① 산문으로 적은 금칙어는 걸리지 않는다 — 걷지 않으면 머리말이 스스로 red를 낸다.
    expect(stripped).not.toContain('toLocaleString');

    // ② 회귀 가드 — URL의 `//`를 줄 주석으로 오인하면 그 줄이 통째로 사라져 **거짓 green**이
    //    난다(2026-07-31 실사고). 화면 파일 머리말에 Figma 노드 URL을 적는 것이 이 리포
    //    관례라 이 함정은 실제로 밟힌다.
    expect(stripped).toContain("const url = 'https://example.com/a';");
    expect(stripped).toContain('String(n).replace');

    // ③ **가장 중요한 짝** — 코드에 실재하는 금칙어는 전처리를 통과해 살아남는다. 이게
    //    없으면 "무엇이든 다 지우는" 전처리가 아래 단언 전부를 공짜로 통과시킨다.
    expect(stripComments("const x = n.toLocaleString('ko-KR');")).toContain(
      'toLocaleString'
    );
    expect(
      stripComments("const y = new Intl.NumberFormat('ko-KR');")
    ).toContain('Intl.');
  });
});

describe('AC-5 · 천단위 구분을 로케일 API로 찍지 않는다', () => {
  it('예산 모듈·화면·배선 어디에도 toLocaleString / Intl 이 없다', () => {
    [BUDGET_MODULE, SCREEN, PAGE].forEach((file) => {
      // 긍정 짝 ① — 파일이 없으면 아래 읽기가 예외로 죽어 "무엇이 없는가"를 읽을 수 없다.
      expect(existsPair(file)).toEqual({ file, exists: true });

      const source = stripComments(readFileSync(file, 'utf8'));
      FORBIDDEN_LOCALE_APIS.forEach((api) => {
        expect(source).not.toContain(api);
      });
    });
  });

  it('긍정 짝 — 예산 모듈이 실제로 변환 함수를 내보낸다', () => {
    // 이게 없으면 **빈 파일도** 위 부정 단언을 통과한다.
    expect(existsPair(BUDGET_MODULE)).toEqual({
      file: BUDGET_MODULE,
      exists: true,
    });

    const source = stripComments(readFileSync(BUDGET_MODULE, 'utf8'));
    ['parseBudgetAmount', 'formatBudgetAmount'].forEach((symbol) => {
      expect(source).toMatch(
        new RegExp(`export\\s+(?:function\\s+|const\\s+)${symbol}\\b`)
      );
    });
  });
});
