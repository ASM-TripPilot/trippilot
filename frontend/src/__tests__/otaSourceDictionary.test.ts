/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1017 AC-C5 — OTA 코드 사전은 한 벌이다.
 *
 * 무엇을 보장하나: 등록 숙소(l04)의 출처 라벨이 "이 코드가 OTA 인가"를 판정할 때, 사전을 my-stays 쪽에
 *  새로 적지 않고 제휴 고지 사전(`features/stay/config/affiliateNotice.ts`)을 쓴다. 두 벌이면 한쪽에만
 *  OTA 를 더했을 때 옵션 시트는 "아고다"라 하고 등록 숙소는 "탐색에서 저장"이라 하는 드리프트가 난다.
 *
 * 어떻게 재나(인구조사): 프로덕션 소스(테스트·생성물·개발 프리뷰 제외)를 주석을 걷고 훑어 `'AGODA'`
 *  인용 리터럴을 가진 파일 목록을 만든다 → 사전 파일 하나뿐이어야 한다. `NAVER` 가 아니라 `AGODA` 로
 *  재는 이유 — `NAVER` 는 소셜 로그인 공급자 코드로도 쓰여(features/auth) 오탐이 난다.
 *
 * 사정거리 밖: 글자를 쪼개 적는 우회(`'AG' + 'ODA'`)는 못 잡는다 — 리뷰 몫.
 * 지금도 green 이 정상이다(선제 green 회귀 앵커) — 구현이 사전을 복제하는 순간 red.
 */

const ROOT = path.resolve('src');
const DICTIONARY_REL = 'features/stay/config/affiliateNotice.ts';

/** 제외 — 테스트, orval 생성물(계약 사본), 개발 프리뷰(픽스처에 원천 코드가 정당하게 있다). */
const EXCLUDED_DIRS = [
  path.join(ROOT, 'shared', 'api', 'generated'),
  path.join(ROOT, 'app', '_dev'),
];

const AGODA_LITERAL = /['"`]AGODA['"`]/;

/** 블록 주석 + 줄 주석 제거. 줄 주석은 바로 앞 글자가 `:` 이면 보지 않는다(`https://` 오인 방지). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listProductionSources(dir: string): string[] {
  if (EXCLUDED_DIRS.includes(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listProductionSources(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function hasAgodaLiteral(source: string): boolean {
  return AGODA_LITERAL.test(stripComments(source));
}

describe('C5 · 탐지기 자가검사 — 전처리 × 탐지기 조합', () => {
  it('주석 속 AGODA 는 걷히고, URL 이 있는 줄의 코드 AGODA 는 살아남는다', () => {
    // 주석 속 언급 — 사전 설명 주석이 스스로 red 를 내면 안 된다.
    expect(hasAgodaLiteral("// ['AGODA', '아고다']\nexport const x = 1;")).toBe(
      false
    );
    expect(hasAgodaLiteral("/* 'AGODA' */ export const x = 1;")).toBe(false);
    // ★ 조합 — URL 의 `//` 을 주석으로 오인해 뒤따르는 코드 리터럴까지 지우면 안 된다.
    expect(
      hasAgodaLiteral("const u = 'https://x.io/p'; const k = ['AGODA'];")
    ).toBe(true);
    // 코드 리터럴(작은·큰따옴표·백틱) — 잡힌다.
    expect(hasAgodaLiteral("new Map([['AGODA', '아고다']])")).toBe(true);
    expect(hasAgodaLiteral('const k = "AGODA";')).toBe(true);
    // 합성 키(`AGODA:s3`)는 코드값 사전이 아니다 — 안 잡힌다.
    expect(hasAgodaLiteral("const key = 'AGODA:s3';")).toBe(false);
  });
});

describe('🟢 TRIP-1017 AC-C5 · OTA 사전 한 벌 (인구조사)', () => {
  it("프로덕션 소스에서 'AGODA' 코드 리터럴을 가진 파일은 affiliateNotice.ts 하나뿐이다", () => {
    const files = listProductionSources(ROOT);

    // 긍정 앵커 — 스캔이 실제로 넓게 닿았고, 사전 파일과 등록 숙소 페이지가 스캔 집합에 있다.
    expect(files.length).toBeGreaterThan(100);
    const rels = files.map((f) => path.relative(ROOT, f));
    expect(rels).toContain(DICTIONARY_REL);
    expect(rels).toContain('pages/my-stays/ui/MyStaysPage.tsx');

    const owners = files
      .filter((f) => hasAgodaLiteral(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f));

    expect(owners).toEqual([DICTIONARY_REL]);
  });
});
