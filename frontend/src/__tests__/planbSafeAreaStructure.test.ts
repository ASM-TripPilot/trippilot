/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-580 · US-PLANB-08(i19) · US-PLANB-05(i12) — 여행 중 전면화면 **세이프에어리어 래핑** 구조가드.
 *
 * 무엇을 보장하나(소스를 글자로 읽어 잰다 — 앱을 안 돌린다):
 *  - 🔴 i19 `ReplanAppliedScreen`·i12 `ReplanSolvingScreen`·`PlanbDiffPage`(pre-apply·error 두 얼굴)가
 *    `react-native-safe-area-context` 의 `SafeAreaView` 를 import 하고, 루트를 `edges={['top','bottom']}`
 *    로 감싼다(형제 `OptionSwapScreen.tsx:77` 동형 — 탭바 없는 전면화면이라 상·하 두 변).
 *  - 🔴 `PlanbDiffPage` 는 성공 얼굴이 자체 래퍼를 가진 `ReplanAppliedScreen` 을 그리므로, 남은
 *    **두 얼굴(pre-apply·error)** 각각이 래핑돼야 한다 → top-edge 래퍼가 **2개 이상**.
 *  - 🔴 ★1 세 파일 어디에도 `useSafeAreaInsets()` 훅이 없다 — 리포의 어떤 production feature/page 도
 *    이 훅을 안 써서 jest 통합 렌더에 Provider 목이 없다. 훅을 쓰면 렌더 크래시(TRIP-456 실측).
 *    `<SafeAreaView>` 컴포넌트는 Provider 없이도 조용히 동작한다.
 *
 * 왜 소스 스캔인가(맹점①): 세이프에어리어 실제 여백은 jest 원리적 사각이다 —
 * `react-native-safe-area-context` 목이 children 을 그냥 통과시켜, 래퍼를 지우거나 `edges` 오타를
 * 내도 렌더 테스트가 green 이다(지도 `viewOnly`·바텀시트 실제 열림과 동형). 이 소스 스캔이 "래퍼
 * 존재·올바른 edges·훅 부재"를 잠그고, 실제 노치/홈인디케이터 픽셀 여백은 6-b 실기가 판정한다.
 *
 * 전처리×탐지기 조합: 소스를 `stripComments` 로 가공한 뒤 정규식으로 훑으므로, 주석 속 옛
 * `<SafeAreaView>` 잔재가 카운트를 부풀리지 않고 · 진짜 import·JSX·URL 은 살아남는지를 G1 에서
 * 실측한다(문제로그 [[2026-07-31 stripComments가 URL의 슬래시를 주석으로 오인]] 계열 ·
 * planbScopeStructure G1 선례).
 */

const ROOT = path.resolve('src');

/** 세 대상 파일(리포 상대경로). */
const I19_REL = 'features/planb/ui/ReplanAppliedScreen.tsx';
const I12_REL = 'features/planb/ui/ReplanSolvingScreen.tsx';
const DIFF_REL = 'pages/planb-diff/ui/PlanbDiffPage.tsx';

/** `react-native-safe-area-context` 에서 `SafeAreaView` **컴포넌트**를 들여오는 import. */
const IMPORT_SAV =
  /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*'react-native-safe-area-context'/;
/** `edges={[ ... 'top' ... ]}` — 상단 인셋(노치·상태바). `\{\[`=여는 중괄호+대괄호, `[^\]]*`=닫는 대괄호 전까지. */
const EDGES_TOP = /edges=\{\[[^\]]*'top'/;
/** `edges={[ ... 'bottom' ... ]}` — 하단 인셋(홈인디케이터). 전면화면이라 상·하 둘 다 필요. */
const EDGES_BOTTOM = /edges=\{\[[^\]]*'bottom'/;
/** 전역판(개수 세기용). */
const EDGES_TOP_G = /edges=\{\[[^\]]*'top'/g;
/** ★1 금지 — 인셋 훅(Provider 필요, 리포에 목 없음 → 렌더 크래시). */
const HOOK = /useSafeAreaInsets/;

/** 주석을 걷어낸다. `:` 뒤 `//`(URL)은 주석으로 오인하지 않는다(리포 확립 룩비하인드). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 대상 소스를 주석 걷어 읽는다. */
function readOne(rel: string): string {
  return stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

describe('G1 · 전처리×탐지기 자가검사', () => {
  it('주석 속 SafeAreaView 는 걷히고, 진짜 import·edges·URL 은 살아남는다', () => {
    const sample = [
      "import { SafeAreaView } from 'react-native-safe-area-context';",
      "// 옛 주석: <SafeAreaView edges={['top']}> 잔재",
      "const doc = 'https://figma.com/design/x';",
      "    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>",
    ].join('\n');

    const stripped = stripComments(sample);

    // 진짜 import·edges 는 탐지된다(가짜 red 방지).
    expect(IMPORT_SAV.test(stripped)).toBe(true);
    expect(EDGES_TOP.test(stripped)).toBe(true);
    expect(EDGES_BOTTOM.test(stripped)).toBe(true);
    // 주석의 옛 SafeAreaView 잔재는 걷혀 카운트를 부풀리지 않는다(top-edge 는 코드 1건뿐).
    expect(stripped).not.toContain('잔재');
    expect((stripped.match(EDGES_TOP_G) ?? []).length).toBe(1);
    // URL 의 `://` 는 주석으로 오인되지 않아 그대로 보존된다.
    expect(stripped).toContain('https://figma.com/design/x');
  });
});

describe('🔴 G2 · i19 ReplanAppliedScreen — SafeAreaView top·bottom 래핑', () => {
  it('react-native-safe-area-context 의 SafeAreaView 로 edges top·bottom 을 감싼다', () => {
    const source = readOne(I19_REL);

    // 긍정 앵커 — 올바른 파일을 비어 있지 않게 읽었다(경로 오타로 인한 공허 red 방지).
    expect(source).toContain('planb-applied-back');

    expect(IMPORT_SAV.test(source)).toBe(true);
    expect(EDGES_TOP.test(source)).toBe(true);
    expect(EDGES_BOTTOM.test(source)).toBe(true);
  });
});

describe('🔴 G3 · i12 ReplanSolvingScreen — SafeAreaView top·bottom 래핑', () => {
  it('react-native-safe-area-context 의 SafeAreaView 로 edges top·bottom 을 감싼다', () => {
    const source = readOne(I12_REL);

    expect(source).toContain('planb-solving-cancel');

    expect(IMPORT_SAV.test(source)).toBe(true);
    expect(EDGES_TOP.test(source)).toBe(true);
    expect(EDGES_BOTTOM.test(source)).toBe(true);
  });
});

describe('🔴 G4 · PlanbDiffPage — pre-apply·error 두 얼굴 각각 래핑', () => {
  it('SafeAreaView 를 import 하고 top-edge 래퍼가 2개 이상이다(두 얼굴)', () => {
    const source = readOne(DIFF_REL);

    expect(source).toContain('planb-diff-confirm');

    expect(IMPORT_SAV.test(source)).toBe(true);
    expect(EDGES_BOTTOM.test(source)).toBe(true);
    // 성공 얼굴은 자체 래퍼를 가진 ReplanAppliedScreen 이 담당 → 남은 두 얼굴이 각각 래핑돼야 2건.
    expect((source.match(EDGES_TOP_G) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('G5 · ★1 — 세 파일 어디에도 useSafeAreaInsets 훅이 없다', () => {
  it('컴포넌트 SafeAreaView 만 쓴다(훅은 Provider 부재로 렌더 크래시 · TRIP-456)', () => {
    for (const rel of [I19_REL, I12_REL, DIFF_REL]) {
      expect(HOOK.test(readOne(rel))).toBe(false);
    }
  });
});
