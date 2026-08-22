/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-447 AC-1 — d01 랜딩 축 세그먼트(4탭) 제거 소스 스캔 가드.
 *
 * 무엇을 보장하나:
 *  - `ExploreLandingScreen.tsx` 소스에 축 세그먼트 흔적이 0건이다: 상수 `AXES` · 컴포넌트
 *    `AxisSegment` · testID `explore-axis-*` · `accessibilityRole="tab"`.
 *  - 동시에(가짜통과 짝) 헤딩·검색·숙소 레인 testID는 **생존**한다 — 파일을 통째로 비워
 *    0건을 만드는 우회를 파일 존재 앵커 + 앵커 3종으로 막는다.
 *
 * 왜 렌더가 아니라 소스 스캔인가(02a ★4): 렌더 테스트는 "안 그려짐"만 본다. 상수/컴포넌트/
 * 주석에 남은 축 잔존물은 화면엔 안 뜨지만 소스엔 남아, 다음 사람이 되살리기 쉽다. 글자로
 * 읽어야 잡힌다.
 *
 * 전처리×탐지기 조합(02a §5-①): `stripComments`로 주석을 걷은 소스만 스캔한다 — 주석이
 * "AXES 삭제됨" 같은 언급을 남겨도 가짜 red를 안 내게. 아래 자가검사가 (a) 주석 속 금칙어는
 * 사라지고 (b) 코드의 금칙어·URL은 살아남음을 실문자열로 증명한다(주석 제거가 탐지 대상을
 * 지워 통과 불가가 되는 함정, 2026-07-31 계열 회귀 가드).
 */

const ROOT = path.resolve('src');
const SCREEN = path.join(
  ROOT,
  'features',
  'explore',
  'ui',
  'ExploreLandingScreen.tsx'
);

/**
 * 주석 제거 — 줄 주석 규칙에서 바로 앞 글자가 `:`이면 주석으로 보지 않는다
 * (`https://`의 슬래시를 주석 시작으로 오인하지 않기 위함, `tabbarOverlay.test.ts` 계승).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

// 금지 4토큰(Seed AC-1). `accessibilityRole="tab"`는 닫는 따옴표까지 포함해 `="button"`과
// 겹치지 않는다(02a §5-②).
const FORBIDDEN = [
  'AXES',
  'AxisSegment',
  'explore-axis-',
  'accessibilityRole="tab"',
];

// 가짜통과 짝 — 축을 지우면서 통째로 비우지 못하게 하는 생존 앵커.
const ANCHORS = [
  'explore-landing-heading',
  'explore-landing-search',
  'explore-lane-stay',
];

describe('탐지기 자가검사 — 주석은 걷히고 코드·URL은 살아남는다', () => {
  it('주석 속 금칙어는 사라지고, 코드의 금칙어·URL은 남는다', () => {
    const sample = [
      '// 남은 AXES 참조 없음, AxisSegment 삭제됨 (주석)',
      'const AXES = [];',
      'accessibilityRole="tab"',
      "const u = 'https://cdn.example.com/x'; // 꼬리 주석",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석에만 있던 금칙어는 사라진다 — 안 걷으면 "삭제됨" 같은 주석이 가짜 red를 낸다.
    expect(stripped).not.toContain('삭제됨');
    // 코드의 금칙어는 살아남는다 — 진짜 위반을 못 잡으면 스캔이 무의미하다.
    expect(stripped).toContain('const AXES');
    expect(stripped).toContain('accessibilityRole="tab"');
    // 코드의 URL은 보존된다 — `:` 앞 `//`(https)까지 지우면 코드가 소실된다.
    expect(stripped).toContain('https://cdn.example.com/x');
  });
});

describe('TRIP-447 AC-1 — ExploreLandingScreen 소스에서 축 세그먼트 완전 제거', () => {
  it('AXES·AxisSegment·explore-axis-·accessibilityRole="tab" 이 0건이고, 헤딩·검색·숙소레인 testID 는 생존한다', () => {
    // 존재 앵커 — 빈/삭제 파일이 0건으로 가짜통과하는 것을 막는다.
    expect(fs.existsSync(SCREEN)).toBe(true);
    const src = read(SCREEN);

    // 부정 — 축 세그먼트 흔적 0건(상수·컴포넌트·testID·역할).
    for (const token of FORBIDDEN) {
      expect(src).not.toContain(token);
    }

    // 긍정 짝 — 나머지 구획 testID 는 살아 있다(통째로 비운 우회 차단).
    for (const anchor of ANCHORS) {
      expect(src).toContain(anchor);
    }
  });
});
