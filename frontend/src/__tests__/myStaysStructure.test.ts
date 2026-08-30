/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-605 · AC-5(INV-3 소스 이중방어) + raw-hex 0 + SafeArea 규약 — l04 등록 숙소 화면 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 렌더 단언과 사정거리가 다르다. `MyStaysScreen.test.tsx`는 "이번 렌더에서 나온
 * 출력"만 본다. 여기는 렌더되지 않는 `accessibilityLabel` 문자열·주석 밖 소스까지 본다. pages 쪽
 * INV-3 는 `pagesLayerStructure.test.ts`(층 전수 재귀)가 `pages/my-stays/` 를 자동 편입해 이미
 * 잠그므로, 이 파일은 **`features/settings/ui` 쪽**만 새로 잠근다(중복 스캔 안 함).
 *
 * **전제 — 주석을 걷어낸 소스를 스캔한다**(`stripComments`). 줄 주석 규칙은 **바로 앞 글자가 `:`이면
 * 주석으로 보지 않는다**(`'https://…'`의 슬래시 오인 방지, 2026-07-31 실사고 회귀 가드).
 * "없어야 한다" 단언은 "있어야 한다" 짝과 같은 it 안에 둔다(빈 스캔 공짜 통과 차단).
 */

const ROOT = path.resolve('src');
const SETTINGS_UI = path.join(ROOT, 'features', 'settings', 'ui');
const SCREEN_REL = 'features/settings/ui/MyStaysScreen.tsx';

/** 소요시간 표기 탐지기(INV-3) — `HH:mm`(숫자 뒤 `:`)은 안 걸린다. */
const DURATION_TEXT = /(\d+\s*분|\d+\s*시간|소요)/;

/** 토큰으로 이미 존재하는 색 — raw hex로 적으면 토큰 우회다(브리프 §토큰 스냅 결과). */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#3f3f3f',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f2f2f2',
  '#9aa1ab',
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `*Glyphs.tsx` 는 제외한다(SVG stroke/fill 은 className 을 못 받는 리포 전체 관례). */
function listUiSources(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listUiSources(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !/Glyphs\.tsx$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

function readStripped(full: string): string {
  return stripComments(fs.readFileSync(full, 'utf8'));
}

describe('G1 · 탐지기 자가검사 — 전처리 × 탐지기 조합', () => {
  it('주석 속 소요시간 어휘는 걷히고, 코드의 숫자+분은 살아남고, URL 슬래시는 보존된다', () => {
    const sample = [
      '/**',
      ' * 소요시간 계산은 하지 않는다(INV-3) — https://figma.com/x 참조.',
      ' */',
      '// 15분 걸린다는 주석',
      "const label = '도보 15분';",
      "const u = 'https://a/b';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 '소요시간'·'15분'은 걷힌다 — 안 걷으면 머리말이 스스로 red를 낸다.
    expect(
      DURATION_TEXT.test(stripped.replace("const label = '도보 15분';", ''))
    ).toBe(false);
    // ② ★ 조합 — 전처리 뒤에도 코드의 '15분'은 살아남아 탐지된다.
    expect(stripped).toContain("const label = '도보 15분';");
    expect(DURATION_TEXT.test(stripped)).toBe(true);
    // ③ ★ 조합 — URL 의 `://` 슬래시는 주석으로 오인되지 않는다.
    expect(stripped).toContain("const u = 'https://a/b';");
  });
});

describe('G2 · INV-3 — features/settings/ui 재귀 스캔에 소요시간 문자열 0', () => {
  it('설정 UI 소스 전체(주석 제거·글리프 제외)에 분·시간·소요 표기가 없다', () => {
    const files = listUiSources(SETTINGS_UI);

    // 긍정 짝 — 스캔이 실제로 파일에 닿았고, 신규 화면이 그 집합에 있다(빈 스캔 공허 통과 차단).
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.endsWith('MyStaysScreen.tsx'))).toBe(true);

    const offenders = files.filter((f) => DURATION_TEXT.test(readStripped(f)));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe('G3 · raw hex 0 — 신규 UI 파일(MyStays*·BaseToggle*·StyleSummary*, 글리프 제외)', () => {
  it('신규 화면·다이얼로그·스타일 카드가 토큰 경유로만 색을 쓴다(raw hex 없음)', () => {
    const newFiles = listUiSources(SETTINGS_UI).filter((f) =>
      /(MyStays|BaseToggle|StyleSummary)/.test(path.basename(f))
    );

    // 긍정 짝 — 신규 파일이 실제로 스캔 집합에 있다.
    expect(newFiles.some((f) => f.endsWith('MyStaysScreen.tsx'))).toBe(true);
    // 긍정 짝 — 색 카드 StyleSummaryCard.tsx 도 스캔 집합에 실재한다(필터 파손 시 red).
    expect(newFiles.some((f) => f.endsWith('StyleSummaryCard.tsx'))).toBe(true);

    const offenders: string[] = [];
    for (const f of newFiles) {
      const source = readStripped(f).toLowerCase();
      for (const hex of TOKENIZED_HEX) {
        if (source.includes(hex))
          offenders.push(`${path.relative(ROOT, f)} → ${hex}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('G4 · SafeArea 규약 — MyStaysScreen 이 top edge 를 진다', () => {
  it('MyStaysScreen 이 SafeAreaView 를 top edge 로 감싼다', () => {
    const full = path.join(ROOT, SCREEN_REL);
    const source = fs.existsSync(full) ? readStripped(full) : '';

    // 긍정 짝 — 화면이 실재한다(빈 문자열 공허 통과 차단).
    expect(source).toContain('MyStaysScreen');
    // 규약 — SafeAreaView + edges top(MyPageScreen·LocationConsentScreen 선례).
    expect(source).toContain('SafeAreaView');
    expect(source).toMatch(/edges=\{?\[[^\]]*['"]top['"]/);
  });
});
