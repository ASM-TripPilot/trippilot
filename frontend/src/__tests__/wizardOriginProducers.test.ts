import fs from 'fs';
import path from 'path';

/**
 * TRIP-1093 결정 2 — **위저드 출처 d04(장소 탐색)를 여는 곳은 d02 select 하나뿐**이다.
 *
 * 무엇을 보장하나: 위저드 출처 d04 의 ♥ 는 새 화면을 열지 않고 `router.back()` 한다(01b Q2 A3). 그게 d02
 * select 로 돌아가려면 "위저드 출처 d04 바로 아래는 늘 d02 select" 여야 한다. 누가 다른 화면에서 위저드
 * 출처를 실어 d04 를 열면 ♥ 가 엉뚱한 곳으로 돌아간다 — jest 는 스택을 못 보므로(6-b) 생산자를 센다.
 *
 * - G1 `wizardOriginParams(` 를 부르는 파일이 정해진 둘뿐이다(1/4 는 d02 select 로 보낼 때 싣는다 — 01b Q1).
 * - G2 그중 d04(`'/explore/places'`)로 보내는 파일은 SavedPlacesPage 하나다.
 * - G3 헬퍼를 건너뛰고 `from: 'wizard'`·`from=wizard` 를 손으로 적은 곳이 없다(G1·G2 의 우회로).
 *
 * 새 생산자가 필요해졌다면: 그 화면에서 d04 로 간 뒤 ♥ 의 back 이 어디로 돌아가는지 먼저 정하고, 이 표를 고친다.
 */

const ROOT = path.resolve('src');
const DEFINITION = 'features/explore/model/wizardOrigin.ts';

const CALL = /\bwizardOriginParams\(/;
// 따옴표로 양끝을 닫은 정확 리터럴 — 카드 상세 `/explore/places/${id}`·URL 속 경로는 안 걸린다.
const D04_LITERAL = /['"`]\/explore\/places['"`]/;
const HANDWRITTEN = /\bfrom\s*[:=]\s*['"]?wizard\b/;

/** 블록 주석과 줄 주석을 걷는다 — `https://` 같은 URL 의 `//` 는 남긴다(앞 글자가 `:`). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['__tests__', 'generated', 'test-support', 'mocks'].includes(
        entry.name
      )
        ? []
        : listSourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [full];
  });
}

const SOURCES = listSourceFiles(ROOT)
  .map((full) => ({
    rel: path.relative(ROOT, full).split(path.sep).join('/'),
    code: stripComments(fs.readFileSync(full, 'utf8')),
  }))
  .filter(({ rel }) => rel !== DEFINITION);

function relsMatching(pattern: RegExp, among = SOURCES): string[] {
  return among
    .filter(({ code }) => pattern.test(code))
    .map(({ rel }) => rel)
    .sort();
}

describe('1093 AC-9 · 위저드 출처 d04 를 여는 곳은 d02 select 하나뿐이다', () => {
  it('G1 · wizardOriginParams 를 부르는 곳은 d02(SavedPlacesPage)와 1/4(TripNewStep1Page) 둘뿐이다', () => {
    expect(relsMatching(CALL)).toEqual([
      'pages/saved-places/ui/SavedPlacesPage.tsx',
      'pages/trip-new-step1/ui/TripNewStep1Page.tsx',
    ]);
  });

  it('🔴 G2 · 그중 d04(/explore/places)로 보내는 곳은 SavedPlacesPage 하나다 — 1/4 는 d02 select 로만 간다', () => {
    const producers = SOURCES.filter(({ code }) => CALL.test(code));
    expect(relsMatching(D04_LITERAL, producers)).toEqual([
      'pages/saved-places/ui/SavedPlacesPage.tsx',
    ]);
  });

  it('G3 · 헬퍼를 건너뛰고 위저드 출처를 손으로 적은 곳이 없다', () => {
    // 긍정 앵커 — 정의 파일은 그 철자를 실제로 품고 있다(정규식이 헛돌지 않는다).
    const definition = stripComments(
      fs.readFileSync(path.join(ROOT, DEFINITION), 'utf8')
    );
    expect(HANDWRITTEN.test(definition)).toBe(true);

    expect(relsMatching(HANDWRITTEN)).toEqual([]);
  });
});
