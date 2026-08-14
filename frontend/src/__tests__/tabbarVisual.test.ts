/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import tailwindConfig from '../../tailwind.config.js';

/**
 * AC-V1 · AC-V2 · AC-V3 · AC-V4 (01b Seed) — 탭바 비주얼 소스 스캔 가드.
 *
 * 무엇을 보장하나: `BottomTabBar.tsx` 소스가 Figma 마스터 `1236:1177`의 값으로 갈아끼워졌음을
 * 잠근다. jest는 실제 픽셀을 못 보므로 "코드에 그 값이 있는가"만 본다 — "눈에 그렇게 보이는가"는
 * [검증] 스크린샷 대조(AC-S1~S6) 몫이다. 모집단은 **파일 1개**(`shared/ui/BottomTabBar.tsx`)이고,
 * 스캔하는 문자열은 그 파일에서 **주석을 걷어낸 것**이다(`stripComments`).
 * 여러 파일을 훑지 않으므로 스캔 범위가 조용히 비는 사고(2/4 사이클 `BARREL_LAYERS=[]`가 빈
 * 디렉토리에서 "위반 0건"을 공허하게 통과시킨 것)는 구조적으로 재현되지 않는다 — 대신 아래
 * `tabBarAnchor()`가 "방어적 읽기로의 회귀"(existsSync로 감싸 오타 경로를 조용한 빈 문자열로
 * 만드는 것)를 막는다. §T-9 참고: 이 파일은 일부러 `fs.existsSync` 방어를 쓰지 않는다 — 방어
 * 없는 `readFileSync`는 경로 오타 시 `ENOENT`로 죽는 것이 옳은 동작이다.
 *
 * 🔴 **주석 제거가 이 파일 전체의 전제다** (게이트①-2 보강). 걷어내기 전에는 `BottomTabBar.tsx`
 * 헤더 주석의 산문 *"반경은 rounded-pill 토큰"* 이 `includes('rounded-pill')`을 대신 만족시켜,
 * **알약 className을 통째로 지워도 전 스위트가 green**이었다(code-critic 실측 326/326). 주석이
 * 단언을 만족시키는 **거짓 GREEN**이며, 리포 문제로그 `2026-07-26 구조 가드 정규식이 주석까지
 * 스캔한다`의 **반대 방향**이다 — 그쪽은 거짓 RED(눈에 띈다), 이쪽은 거짓 GREEN(안 띈다).
 *
 * **가짜 통과 방지 규약(리포 확립 관례)**: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과
 * **같은 it 안에서** 짝을 이룬다 — AC-V3의 V3-1(부정)·V3-2(긍정)가 그 예다.
 *
 * **한계 — 위치는 못 본다.** 소스 스캔은 "이 문자열이 파일 어딘가에 있다"까지만 본다. "이 클래스가
 * *밴드* View에 붙어 있다"는 AST 없이는 판정할 수 없어, 값을 다른 요소로 옮기는 변경은 통과한다.
 * 그 층의 심판은 스크린샷 대조다(단, `active=1~4` 변형은 이 환경에서 항구적으로 검증 불가 —
 * 03d 한계). 이 파일이 잠그는 것은 **값의 소실·되돌림**이지 값의 이동이 아니다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 *
 * **A. 영구 규칙 — 유지한다.** (회귀 금지 · 우회 차단 · 토큰 경유 강제 — Figma 값이 바뀌어도 유효)
 *   - **주석 제거 후 스캔** — 주석이 단언을 만족시키는 실패 클래스 자체를 닫는다(위 🔴)
 *   - `viewBox="0 0 24 24"` 0건 — 옛 손그림 좌표계로의 회귀 금지
 *   - `size={24}`·`size = 24` 0건 — 좌표계만 27로 두고 **렌더 크기**를 24로 되돌리는 우회 차단
 *   - `h-[74px]` 0건 — 옛 밴드 높이 회귀 금지
 *   - `border-t` 0건 — 풀폭 직각 바로의 회귀 금지(알약 디자인이 유지되는 한 유효)
 *   - `rounded-pill` 존재 — 반경의 토큰 경유 강제(`rounded-full`·`rounded-[999px]` 우회 차단).
 *     ⚠️ 이 항목은 게이트①-1에서도 A로 선언돼 있었지만 **실제로는 작동하지 않았다** — 주석 제거를
 *     넣기 전까지 헤더 주석이 대신 만족시켰다. 지금부터 선언대로 작동한다
 *   - SVG 상수(PRIMARY/MUTED) ↔ tailwind 토큰 일치 — `BottomTabBar.tsx`는 D-3 raw-hex 가드
 *     (`homeStructure.test.ts`)의 모집단 밖이라, 이 단언이 상수를 토큰 표에 묶는 유일한 끈이다
 *   - 라벨 `text-primary`/`text-muted` 존재 + `text-gray-`·`text-[#` 0건
 *
 * **B. 이행 체크포인트 — 한시적이다.** 아래는 전부 **Figma 마스터의 특정 값**을 고정한다 —
 * 디자인이 바뀌면 정당한 작업에 red를 낸다. 그래서 A와 가른다.
 *   - `viewBox="0 0 27 27"` 정확히 10회 + `<Svg` 정확히 10회 — `<Svg>` 래퍼를 공통 컴포넌트로
 *     뽑는 정당한 리팩토링이 이 숫자를 10 → 1로 만든다. 완화형: **"`<Svg` 개수 ===
 *     `viewBox="0 0 27 27"` 개수, 그리고 > 0"** (의미 — 모든 Svg가 27 좌표계다 — 는 보존하고
 *     숫자 고정만 푼다)
 *   - `size={22}` 정확히 2회(활성·비활성 호출부) + `size = 22` 정확히 10회(아이콘 10종 기본값) —
 *     **TRIP-201로 27→22**(좌표계 viewBox는 27 유지, 렌더 크기만 22). 아이콘을 배열/공통
 *     래퍼로 접는 리팩토링이 두 숫자를 흔든다. 옛 27 렌더 크기(`size={27}`·`size = 27`) 0건도
 *     함께 잠근다. 완화형: **"`size={22}` ≥ 1 + `size={24}`·`size = 24` 0건"**
 *   - `h-[84px]`(밴드) — 01b가 Q1(하단 SafeArea 인셋 합산)을 이번 범위 밖으로 이연한 위에 서
 *     있다. Q1이 뒤집혀 밴드 높이가 `84 + insets.bottom` 계산식이 되면 이 클래스 문자열은
 *     정당하게 사라진다
 *   - `px-lg`(밴드 좌우 여백) · `pt-[26px]`(밴드 상단) · `h-[46px]`(알약 높이) ·
 *     `px-[10px]`·`py-[2px]`(알약 내부) · `w-[67.6px]`(탭 폭) · `leading-[13px]`(라벨 줄높이) —
 *     **TRIP-201 신 치수**(가정 A1, 티켓 실측 — ⚠️ live Figma 60 인스턴스는 아직 구 치수라
 *     미corroborate, 아침 추인 플래그). 옛 값(`px-[28px]`·`h-[64px]`·`w-[62px]`) 0건도 짝으로
 *     잠근다. `h-[46px]`·`leading-[13px]`는 **M-1 회귀**(알약 높이를 내용물이 정해 여백이
 *     뭉개진 것)를 막는 자리다
 *   - `bg-canvas` 0건(밴드) — **M-2 역전**(TRIP-201 오버레이). 밴드는 이제 **투명**이고
 *     표면은 알약(`bg-surface-soft`)만 진다 — `(tabs)/_layout`의 `tabBarStyle:{position:
 *     'absolute'}`가 탭바를 화면 위에 띄우므로 밴드가 불투명이면 화면이 안 비친다. 오버레이
 *     설계가 유지되는 한 유효. 한계: 밴드에 다른 불투명 토큰을 넣는 우회는 실기가 잡는다
 *   - `bg-surface-soft`(알약) — **M-3 회귀** 방지. `bg-canvas`로 바꾸면 알약이 밴드와 같은 색이
 *     되어 사라진다. 진짜 불변식은 "알약 배경 ≠ 밴드 배경"이고 토큰 이름 고정은 그 근사다.
 *     완화형: 두 토큰이 서로 다르기만 하면 통과
 *   - `style={PILL_SURFACE_STYLE}`(알약 테두리·그림자, AC-S2) — 상수 **이름**을 고정하므로 정당한
 *     리네임에 red다. 그럼에도 넣는 이유: 이 한 줄을 지우면 테두리·그림자가 통째로 사라지는데
 *     스크린샷 심판이 그것을 못 잡는다(`elevation`은 iOS 스크린샷에 안 나오고 iOS 그림자는 육안
 *     "있다"까지만 — 03d 한계). 완화형: `shadowRadius: 14` 존재
 *
 * **B 카운터**: 이 파일 전용. 현재값 = **1**. (TRIP-201이 신 치수·오버레이로 B 체크포인트
 * `px`·`h`·`w`·`size`·`bg-canvas`를 red로 만들어 신값 갱신 — 정당한 사이클 밖 작업이 B로 red를
 * 낸 1회차. 2회차가 오면 위 완화형으로 즉시 격하.)
 * **B 카운터 제외구**(`fsdStructure.test.ts` 헤더에서 그대로 계승): 카운터에 세는 red는
 * ① 그 단언을 만든 사이클 **밖**의 작업이 낸 것이고 ② B 단언 자체를 갱신하지 않고는 통과할 수
 * 없는 것이다(AND). TRIP-201의 갱신은 제외구 ①·② 둘 다 충족(단언은 TRIP-173이 만들었고 값을
 * 갱신하지 않으면 못 통과) → 카운터 0→1. 반대로, 이번 사이클이 새로 만드는 가드의 **출생 red**는
 * 제외구에 걸려 세지 않는다(마찰이 아니라 가드가 실효함을 증명하는 증거).
 * **B 완화 시점**: 정당한 신규 작업이 B 때문에 red를 낸 것이 **2회 누적되면 즉시** 위 완화형으로
 * 격하한다(사이클 종료를 기다리지 않는다).
 */

const ROOT = path.resolve('src');
const TABBAR_FILE = path.join(ROOT, 'shared', 'ui', 'BottomTabBar.tsx');

/**
 * "0건"을 안전하게 세는 헬퍼. `String.match(/…/g)`는 매치 0건일 때 배열이 아니라 `null`을
 * 돌려주므로 `.length`에서 TypeError로 죽는다(실측: `'abc'.match(/zzz/g)` → `null`).
 * `split(needle).length - 1`은 0건일 때 정직하게 `0`을 준다.
 */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * 스캔 전처리 — 소스에서 주석을 걷어낸다. 정규식 2개짜리 근사이고, 완전한 파서를 만들지 않는 것이
 * 의도다(AST 파싱은 신규 의존성이라 이 파일의 비용 규모를 넘는다).
 *
 * 알려진 한계(실측 P-17): 문자열 리터럴 안의 `//`(예: URL)를 주석으로 오인해 그 줄의 나머지를
 * 지운다. `BottomTabBar.tsx`에는 그런 문자열이 없음을 확인했고(`//` 6줄·블록 1개가 전부 진짜
 * 주석), 오인이 일어나도 방향은 **긍정 단언이 red**로 안전하다 — 거짓 GREEN은 만들지 않는다.
 */
function stripComments(source: string): string {
  return (
    source
      // 블록 주석을 **먼저** 지운다. `[\s\S]`는 줄바꿈까지 포함하는 "아무 글자"이고, `*?`는
      // 최소 매칭이라 블록 2개를 하나로 삼키지 않는다(실측 P-18).
      // JSX 주석 `{/* … */}`도 안쪽이 이 규칙에 걸려 사라지고 빈 `{}`만 남는다(실측 P-16).
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // 줄 주석. `.`은 줄바꿈에 매치되지 않으므로 그 줄 끝에서 멈춘다.
      // 순서가 중요하다 — 줄 주석을 먼저 지우면 `/* a // b */ const keep = 2;` 같은 한 줄에서
      // `// b */ const keep = 2;`가 통째로 날아가 코드가 소실된다(실측 P-15b).
      .replace(/\/\/.*/g, '')
  );
}

/** 모집단을 읽는 유일한 통로 — 원본 문자열이 단언에 새어 나가지 않도록 여기서만 읽는다. */
function readScannedSource(): string {
  return stripComments(fs.readFileSync(TABBAR_FILE, 'utf8'));
}

/**
 * 모집단 앵커 — "읽은 것이 정말 그 파일인가"를 경로(동결 문자열)와 내용(정체성 표지) 두
 * 다리로 잠근다. 부정 단언(V2·V3)이 있는 it에만 붙인다 — 전부 긍정인 V1·V4는 긍정 단언
 * 자체가 앵커라 별도로 필요하지 않다.
 */
function tabBarAnchor(source: string) {
  return {
    file: path.relative(ROOT, TABBAR_FILE),
    isTabBar: /export function BottomTabBar\b/.test(source),
    hasRootTestId: source.includes('shell-tabbar-root'),
  };
}

describe('스캔 전처리 · 주석 제거 — AC-V1~V4 공통 전제', () => {
  it('주석 안의 글자는 스캔에서 사라지고, 코드의 같은 글자는 남는다', () => {
    // Arrange — 실제 파일이 아니라 손으로 만든 표본을 쓴다. 실제 파일의 주석 문구가 바뀌어도
    // 이 테스트는 흔들리지 않고, 반대로 `stripComments`가 아무것도 안 하는 no-op으로 퇴화하면
    // 여기서 즉시 red가 난다 — 보강 전체가 조용히 되돌려지는 것을 막는 유일한 파수꾼이다.
    const sample = [
      '/** 헤더: 반경은 rounded-pill 토큰 */',
      'const a = "rounded-full";',
      '// 줄 주석: h-[84px]',
      'const b = "h-[64px]";',
    ].join('\n');

    // Act
    const stripped = stripComments(sample);

    // Assert — 두 방향을 한 객체로 본다. 주석만 지우고 끝이 아니라 **코드는 남겨야** 한다
    // (전부 지우는 구현도 앞 두 키만 보면 통과해 버린다).
    expect({
      fromBlockComment: stripped.includes('rounded-pill'),
      fromLineComment: stripped.includes('h-[84px]'),
      fromCodeString: stripped.includes('rounded-full'),
      fromCodeClass: stripped.includes('h-[64px]'),
    }).toEqual({
      fromBlockComment: false,
      fromLineComment: false,
      fromCodeString: true,
      fromCodeClass: true,
    });
  });
});

describe('AC-T1·AC-T2·AC-O1 · SWT PRO Figma 실물 정합 — 밴드·프로스티드 알약·탭', () => {
  it('Figma 실물 치수(px-30·h-96·flex-1·프로스티드 알약)가 있고, 201 티켓값·구값·밴드 배경은 사라졌다', () => {
    // Arrange — 소스 스캔은 읽는 것이 곧 실행이다(렌더 없음).
    const scanned = readScannedSource();

    // 긍정(AC-T1) — Figma 실물(1236:1177 · SWT PRO 화면) 값이 소스에 있다. 대괄호 `[` `]`는
    // 정규식 특수문자라 `includes`만 쓴다. 요소별로 묶어 한 객체로 내면 실패 diff에 어느 값이
    // 빠졌는지 한 번에 보인다. 알약은 이제 프로스티드 글래스(expo-blur BlurView)라 배경 토큰
    // 대신 BlurView·tint·overflow-hidden(블러를 알약 모양에 클립)을 잠근다. 알약 높이는
    // Figma대로 내용물이 정하므로 고정 높이를 잠그지 않는다.
    expect({
      band: {
        height: scanned.includes('h-[96px]'),
        sidePadding: scanned.includes('px-[30px]'),
        topPadding: scanned.includes('pt-[26px]'),
      },
      pill: {
        radius: scanned.includes('rounded-pill'),
        blur: scanned.includes('BlurView'),
        tint: scanned.includes('tint="light"'),
        clip: scanned.includes('overflow-hidden'),
        innerX: scanned.includes('px-[10px]'),
        innerY: scanned.includes('py-[2px]'),
        shadow: scanned.includes('style={PILL_SHADOW_STYLE}'),
        border: scanned.includes('style={PILL_BORDER_STYLE}'),
      },
      tab: { width: scanned.includes('flex-1') },
    }).toEqual({
      band: { height: true, sidePadding: true, topPadding: true },
      pill: {
        radius: true,
        blur: true,
        tint: true,
        clip: true,
        innerX: true,
        innerY: true,
        shadow: true,
        border: true,
      },
      tab: { width: true },
    });

    // 부정(AC-T2 회귀 + AC-O1 밴드 투명) — TRIP-201 티켓값(px-lg·h-46·w-67.6·h-84)·더 옛
    // 구값(px-28·h-64·w-62)·불투명 알약(bg-surface-soft)·밴드 배경(bg-canvas)이 없다.
    // `bg-canvas` 0건 = M-2 역전(오버레이): 밴드는 투명, 표면은 프로스티드 알약만 진다.
    // 긍/부정 짝을 이뤄 "갈아끼우다 만 중간 상태"(구값도 신값도 없음)를 통과시키지 않는다.
    // ⚠️ 한계: 밴드에 다른 불투명 토큰을 넣는 우회는 실기가 잡는다(bg-canvas·bg-surface-soft가
    // 각각 밴드·구 알약 전용 토큰이라 이 근사가 성립).
    expect({
      t201SidePad: scanned.includes('px-lg'),
      t201PillHeight: scanned.includes('h-[46px]'),
      t201TabWidth: scanned.includes('w-[67.6px]'),
      t201BandHeight: scanned.includes('h-[84px]'),
      oldSidePad: scanned.includes('px-[28px]'),
      oldPillHeight: scanned.includes('h-[64px]'),
      oldTabWidth: scanned.includes('w-[62px]'),
      opaquePill: scanned.includes('bg-surface-soft'),
      bandBackground: scanned.includes('bg-canvas'),
    }).toEqual({
      t201SidePad: false,
      t201PillHeight: false,
      t201TabWidth: false,
      t201BandHeight: false,
      oldSidePad: false,
      oldPillHeight: false,
      oldTabWidth: false,
      opaquePill: false,
      bandBackground: false,
    });
  });
});

describe('AC-V2 · 아이콘 좌표계 27 + 렌더 크기 27 (SWT PRO Figma 실물) — 두 자리 독립 잠금', () => {
  it('아이콘 10종이 전부 viewBox="0 0 27 27"이고 27px로 그려지며, 201값 22·옛 24가 한 개도 없다', () => {
    // Arrange
    const scanned = readScannedSource();

    // Assert — 앵커: 이 it은 부정 단언(viewBox24: 0)을 포함하므로, 파일을 못 읽어도
    // "0건"이 공허하게 통과하지 않도록 먼저 정체성을 확인한다.
    expect(tabBarAnchor(scanned)).toEqual({
      file: 'shared/ui/BottomTabBar.tsx',
      isTabBar: true,
      hasRootTestId: true,
    });

    // 세 숫자를 한 객체로 묶는 이유: viewBox27:10이 긍정 짝(부정만 두면 파일이 비어도
    // 통과한다), svgOpenTags:10은 의미 앵커("<Svg> 10개가 전부 27 좌표계다"를 두 숫자의
    // 일치로 표현 — 없으면 "Svg는 12개인데 27은 10개" 같은 부분 표류를 못 본다).
    expect({
      svgOpenTags: count(scanned, '<Svg'),
      viewBox27: count(scanned, 'viewBox="0 0 27 27"'),
      viewBox24: count(scanned, 'viewBox="0 0 24 24"'),
    }).toEqual({ svgOpenTags: 10, viewBox27: 10, viewBox24: 0 });

    // 렌더 크기 — `viewBox`는 **좌표계**지 그려지는 크기가 아니다(TRIP-201: 좌표계는 27
    // 유지, 렌더 크기만 22로). `size={22}`를 `size={27}`(옛 크기)이나 `size={24}`로 되돌리면
    // 아이콘 크기가 Figma와 어긋나는데 위 세 viewBox 숫자는 그대로다(code-critic 실측:
    // 326/326 green). `count('size={27}')`는 `viewBox="0 0 27 27"`의 27을 세지 않는다(다른
    // 문자열, 02a ★T-1). 두 자리를 다 잠근다 — 호출부 2곳(활성·비활성)과 아이콘 10종의
    // 기본값. 기본값까지 세는 이유: 호출부에서 prop을 아예 빼면 기본값이 렌더 크기가 된다.
    expect({
      callSites27: count(scanned, 'size={27}'),
      defaults27: count(scanned, 'size = 27'),
      callSites22: count(scanned, 'size={22}'),
      defaults22: count(scanned, 'size = 22'),
      callSites24: scanned.includes('size={24}'),
      defaults24: scanned.includes('size = 24'),
    }).toEqual({
      callSites27: 2,
      defaults27: 10,
      callSites22: 0,
      defaults22: 0,
      callSites24: false,
      defaults24: false,
    });
  });
});

describe('AC-V3 · 옛 풀폭 직각 바 흔적 제거', () => {
  it('상단 실선(border-t)과 옛 높이(h-[74px])가 사라지고, 그 자리에 96px 밴드 + 알약이 있다', () => {
    // Arrange
    const scanned = readScannedSource();

    // Assert — 앵커: 아래 두 부정 단언이 공허하게 통과하지 않도록 먼저 정체성을 확인한다.
    expect(tabBarAnchor(scanned)).toEqual({
      file: 'shared/ui/BottomTabBar.tsx',
      isTabBar: true,
      hasRootTestId: true,
    });

    // 부정 단언 — `border-t`를 `includes`로 찾으면 `border-transparent`에 오탐한다
    // (실측: `'border-transparent'.includes('border-t')` → true). 단어 경계 `\b`를 쓰면
    // `border-transparent`는 안 걸리고 `border-t`·`border-t-2`만 걸린다. `h-[74px]`는
    // `includes`로 충분하다(반대로 `min-h-[74px]`가 걸리는 것은 오탐이 아니라 정탐 —
    // 그것도 옛 높이의 잔재다).
    expect({
      borderTop: /border-t\b/.test(scanned),
      oldBand74: scanned.includes('h-[74px]'),
    }).toEqual({ borderTop: false, oldBand74: false });

    // 긍정 짝 — 가짜 통과 방지 규약: "없어야 한다"만 두면 옛 값도 새 값도 없는 중간
    // 상태(예: 갈아끼우다 만 상태)가 통과해 버린다. AC-V1과 같은 단언을 여기서도 다시 보는
    // 것은 의도된 중복이다 — 이 it만 따로 실행해도 공허하지 않아야 한다. 주석을 걷어낸
    // 문자열을 보기 때문에 이제야 실제로 작동한다(걷어내기 전에는 `rounded-pill`이 헤더
    // 주석으로 만족돼, 이 짝이 막겠다던 "중간 상태"가 정확히 통과했다).
    expect({
      band96: scanned.includes('h-[96px]'),
      pillRadius: scanned.includes('rounded-pill'),
    }).toEqual({ band96: true, pillRadius: true });
  });
});

describe('AC-V4 · 색의 토큰 경유 — SVG 상수 ↔ tailwind 토큰 일치', () => {
  it('라벨이 text-primary/text-muted를 쓰고, SVG 색 상수 2개가 tailwind 토큰값과 일치한다', () => {
    // Arrange
    const scanned = readScannedSource();
    // 캡처 그룹 `(...)`이 따옴표 안 hex 값만 꺼낸다. 매치 실패 시 undefined —
    // 아래 첫 단언(추출 성공)이 그 상태를 먼저 잡는다.
    const primaryMatch = scanned.match(/const PRIMARY = '(#[0-9A-Fa-f]{6})'/);
    const mutedMatch = scanned.match(/const MUTED = '(#[0-9A-Fa-f]{6})'/);
    const primary = primaryMatch ? primaryMatch[1] : undefined;
    const muted = mutedMatch ? mutedMatch[1] : undefined;

    // Assert — 추출 성공을 먼저 확인한다. 이 단언 없이 바로 다음 단언(토큰 대조)으로
    // 가면, 상수 선언 형태가 바뀌어 정규식이 못 찾았을 때 실패 메시지가 "왜 undefined
    // 인지"를 말해 주지 않는다.
    expect({
      primaryFound: typeof primary === 'string',
      mutedFound: typeof muted === 'string',
    }).toEqual({ primaryFound: true, mutedFound: true });

    // 토큰 일치 — 기대값을 이 파일에 하드코딩하지 않는다(하드코딩하면 토큰이 바뀔 때
    // tailwind·컴포넌트·이 테스트 세 곳이 갈라진다). 대신 컴포넌트에서 뽑은 값을
    // tailwind와 대조해 두 파일이 서로를 검산하게 한다. `toMatchObject`는 "부분 집합
    // 키 + 정확한 값" 비교라 25개 색 토큰 중 2개만 지정해도 되고, 값이 하나라도 다르면
    // 실패한다.
    expect(tailwindConfig.theme?.extend?.colors).toMatchObject({
      primary,
      muted,
    });

    // 클래스 측 — labelPrimary/labelMuted가 긍정 짝이라 라벨이 토큰 클래스를 실제로
    // 쓰는지 보증하고, rawHexClass(`text-[#`)·genericGray(`text-gray-`)가 우회 경로를
    // 막는다. 오탐 실측: `'text-[11px]'.includes('text-[#')` → false,
    // `'rgba(255,255,255,0.68)'.includes('text-[#')` → false.
    expect({
      labelPrimary: scanned.includes('text-primary'),
      labelMuted: scanned.includes('text-muted'),
      rawHexClass: scanned.includes('text-[#'),
      genericGray: scanned.includes('text-gray-'),
    }).toEqual({
      labelPrimary: true,
      labelMuted: true,
      rawHexClass: false,
      genericGray: false,
    });
  });
});
