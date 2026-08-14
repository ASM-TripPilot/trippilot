/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * AC-O2 · AC-O3 (01b Seed 칸3) — 탭바 오버레이 전환 소스 스캔 가드.
 *
 * 무엇을 보장하나:
 *  - AC-O2: `(tabs)/_layout.tsx`가 탭바를 화면 **위에** 띄운다(`tabBarStyle:{position:
 *    'absolute'}`) — expo-router가 화면을 탭바 높이만큼 줄이지 않게(A8).
 *  - AC-O3: 홈·탐색·일정 세 콘텐츠 표면이 탭바 높이(84) 이상의 하단 여백을 확보한다 —
 *    오버레이 탭바가 마지막 항목을 가리지 않게.
 *
 * ⚠️ **한계 — jest 밖(02a ★O-2)**: 오버레이의 실제 겹침·화면 비침·마지막 항목 비가림은
 * RN 위치·레이어라 소스 스캔이 **원리적으로 못 본다**(seed 명시). 이 파일은 "≥84 인셋이
 * 선언됐는가"·"absolute가 설정됐는가"까지만 잠근다 — 그 인셋이 외곽 스크롤 바닥에 붙었는지,
 * 실제로 안 가리는지는 [검증] 아침 시뮬레이터 스모크 몫이다(`tabbarVisual.test.ts`의
 * "위치는 못 본다" 한계 계승).
 *
 * **가짜 통과 방지 규약**: 부정/문턱 단언은 정체성 앵커(파일이 그 파일인가)와 짝짓는다.
 * **전처리**: 주석을 걷어낸 소스만 스캔한다(`stripComments`) — 산문 속 "paddingBottom: 84"가
 * 문턱을 공짜로 넘기는 거짓 green을 막는다.
 */

const ROOT = path.resolve('src');
const TAB_BAR_HEIGHT = 96; // BottomTabBar 루트 밴드 h-[96px](SWT PRO Figma 실물)

/**
 * 주석 제거 — 줄 주석 규칙에서 바로 앞 글자가 `:`이면 주석으로 보지 않는다
 * (`https://`의 슬래시를 주석 시작으로 오인하지 않기 위함, `tripDraftBoundary.test.ts` 계승).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

/** 소스에 선언된 하단 여백(px 숫자)의 최댓값 — `pb-[Npx]`·`paddingBottom: N` 둘 다 본다.
 * 위치는 못 본다(외곽 스크롤 바닥인지 내부 섹션인지 구분 못 함) — 02a ★O-2 한계. */
function maxBottomPad(file: string): number {
  const src = read(file);
  const nums: number[] = [];
  for (const m of src.matchAll(/pb-\[(\d+)px\]/g)) nums.push(Number(m[1]));
  for (const m of src.matchAll(/paddingBottom:\s*(\d+)/g))
    nums.push(Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

describe('탐지기 자가검사 — 주석은 걷히고 코드는 살아남는다', () => {
  it('주석 속 숫자·URL은 스캔에서 사라지고, 코드의 padding·URL은 남는다', () => {
    const sample = [
      '/** paddingBottom: 999 (블록 주석) */',
      'const a = { paddingBottom: 140 };',
      '// paddingBottom: 888 (줄 주석)',
      "const url = 'https://cdn.example.com/x';  // 꼬리 주석",
    ].join('\n');

    const stripped = stripComments(sample);

    // 주석 속 숫자는 사라진다 — 안 걷으면 산문이 문턱을 공짜로 넘긴다.
    expect(stripped).not.toContain('999');
    expect(stripped).not.toContain('888');
    // 코드의 padding·URL은 남는다 — `:` 앞 `//`(https)까지 지우면 코드가 소실된다.
    expect(stripped).toContain('paddingBottom: 140');
    expect(stripped).toContain('https://cdn.example.com/x');
  });
});

describe('AC-O2 · (tabs)/_layout 오버레이 배선', () => {
  it('탭바 렌더프롭을 유지하면서 tabBarStyle position:absolute 를 준다', () => {
    const src = read(path.join(ROOT, 'app', '(tabs)', '_layout.tsx'));

    // 긍정 앵커 — 이 파일이 탭 레이아웃이고 커스텀 탭바 렌더프롭이 살아 있다.
    expect(src).toContain('Tabs');
    expect(src).toContain('BottomTabBar');
    expect(src).toContain('tabBar');

    // 신 계약(A8) — 탭바를 화면 위에 띄운다(화면 미축소).
    expect(src).toContain('tabBarStyle');
    expect(/position:\s*'absolute'/.test(src)).toBe(true);
  });

  // 게이트①-2 (code-critic 차단-1 수정 후 심판 사각지대): react-navigation 은 커스텀 tabBar
  // 렌더프롭에 `tabBarStyle` 을 적용하지 않으므로 위 `_layout` 단언은 무효 문자열을 잠근다.
  // 실제 오버레이(씬 미축소)를 내는 것은 `BottomTabBar` 루트 밴드의 `absolute`+`bottom-0`다
  // (컬럼 플로우에서 빠져 flex:1 씬이 전체 높이를 차지, Yoga). 그 진짜 메커니즘을 지워
  // 씬 축소로 되돌리면 이 단언이 red 를 낸다(뮤테이션 실측 확인).
  it('BottomTabBar 루트 밴드가 절대배치로 콘텐츠 위에 뜬다(진짜 오버레이 메커니즘)', () => {
    const src = read(path.join(ROOT, 'shared', 'ui', 'BottomTabBar.tsx'));

    // 정체성 앵커 — 이 파일이 탭바 밴드다.
    expect(src).toContain('h-[96px]');

    // 루트 밴드 className 한 줄에 absolute + bottom-0 이 함께 있어야 오버레이가 성립한다.
    const overlayRoot =
      /className="[^"]*\babsolute\b[^"]*\bbottom-0\b[^"]*h-\[96px\]/.test(
        src
      ) ||
      /className="[^"]*\bbottom-0\b[^"]*\babsolute\b[^"]*h-\[96px\]/.test(src);
    expect(overlayRoot).toBe(true);
  });
});

describe('AC-O3 · 콘텐츠 하단 여백 ≥ 탭바 높이', () => {
  it('홈 스크롤 콘텐츠가 탭바 높이 이상 하단 여백을 확보한다 (선제 green · 회귀 가드)', () => {
    const p = path.join(ROOT, 'features', 'home', 'ui', 'HomeScreen.tsx');
    expect(fs.existsSync(p)).toBe(true);
    // 정체성 앵커 — 이 파일이 홈 화면이다.
    expect(read(p)).toContain('home-dashboard-root');
    // 현재 외곽 ScrollView contentContainerStyle={{ paddingBottom: 140 }} ≥ 84 → 이미 안전.
    // 누가 84 밑으로 낮추면 red(회귀 가드).
    expect(maxBottomPad(p)).toBeGreaterThanOrEqual(TAB_BAR_HEIGHT);
  });

  it('탐색 랜딩 스크롤 콘텐츠가 탭바 높이 이상 하단 여백을 확보한다', () => {
    const p = path.join(
      ROOT,
      'features',
      'explore',
      'ui',
      'ExploreLandingScreen.tsx'
    );
    // 존재 앵커 — 구현 전에는 파일이 없어 red(칸1이 만든다).
    expect(fs.existsSync(p)).toBe(true);
    expect(read(p)).toContain('explore-landing');
    expect(maxBottomPad(p)).toBeGreaterThanOrEqual(TAB_BAR_HEIGHT);
  });

  it('일정 빈 상태는 중앙 정렬이라 오버레이 하단에 가릴 항목이 없다 (선제 green)', () => {
    const p = path.join(ROOT, 'app', '(tabs)', 'itinerary.tsx');
    const src = read(p);
    // 정체성 앵커 — 이 파일이 일정 탭 빈 상태다.
    expect(src).toContain('itinerary-tab-empty');
    // 중앙 정렬 = 하단에 가릴 "마지막 항목"이 원리적으로 없다(02a ★O-3). pb≥84를 강제하면
    // 중앙 콘텐츠가 위로 밀려 UX가 상하므로, 여기는 인셋이 아니라 중앙정렬로 안전을 표현한다.
    expect(src).toContain('justify-center');
  });
});
