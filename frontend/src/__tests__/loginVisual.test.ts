/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import tailwindConfig from '../../tailwind.config.js';

/**
 * AC-V4 (01b Seed · 02a §5-4) — 로그인 화면 에러 배너 경고 글리프, 소스 스캔 가드.
 *
 * 무엇을 보장하나: 경고 글리프(`WarningTriangleGlyph`)가 정의되고, 화면이 실제로
 * import·렌더하며, 좌표계·선굵기가 Figma 값(18×18 · strokeWidth 1.575 **3 path 전부**)이고,
 * **렌더 크기 18px** 이 기본값·`width`/`height` 배선·호출부 세 곳에서 잠기며, stroke 색이
 * hex 리터럴이 아니라 **상수를 경유**해 들어가며 그 상수값이 tailwind `primary-text`
 * 토큰과 정확히 같다.
 *
 * **02b 보강(게이트①-2)** — 5-b 가 심판 구멍 2건을 실측해 닫았다:
 *  - W-1 `strokeWidth` 가 `>= 1`(적어도 하나)이라 **삼각 외곽선만 `2`** 로 바꾼 굵기 불균형
 *    아이콘이 337/337 + 43/43 GREEN 이었다 → 3 path 값을 **배열 비교**로 각각 고정.
 *  - W-3 AC-V4 의 "18px" 이 무심판이었다(`viewBox` 는 **좌표계**, 렌더 크기가 아니다).
 *    `size` 를 40 으로 바꿔도 전부 GREEN → 기본값 + `width`/`height` 배선 + 호출부를 잠근다.
 *    호출부만 잠그면 *"prop 삭제 + 기본값 변경"* 이 통과한다(3/4 사이클 실측).
 *  - 개수는 **추정하지 않고 실측**했다: 블록 안 `strokeWidth={1.575}` 3 · `viewBox` 1 ·
 *    `size = 18` 1 · `width={size}`/`height={size}` 각 1 · 호출부 태그 `size={18}` 1.
 *  - 세는 범위를 **블록/태그로 좁혔다** — 파일 전역 카운트는 이 모듈의 다른 글리프 5개가
 *    개수를 채워 주면 공허해진다(03b W-1 참고: 18×18 글리프가 하나 더 생기는 순간).
 *
 * **왜 렌더가 아니라 소스 스캔인가**(02a §5-4, 3가지 이유):
 *  1. "상수를 경유했는가"는 렌더가 원리적으로 못 본다 — 하드코딩해도 렌더 트리에 남는
 *     값(`stroke="#C13515"`)은 상수를 거친 것과 똑같다. "우회했는지"는 글자를 읽어야 안다.
 *  2. 신규 testID 금지 제약 아래, 렌더에서 글리프를 잡는 유일한 공개 경로는
 *     `UNSAFE_getByType(WarningTriangleGlyph)` 인데, 그러려면 테스트가 아직 없는 심볼을
 *     import 해야 해 TS 컴파일 에러로 파일 전체가 죽는다.
 *  3. 소스 스캔은 심볼 이름을 문자열로만 보므로 컴파일 결합이 0이다 — 각 단언이 독립적으로
 *     red 를 낸다.
 *
 * 모집단은 정확히 파일 3개다 — `AuthGlyphs.tsx`(정의) · `SocialLoginScreen.tsx`(사용) ·
 * `gradients.ts`(상수) + `tailwind.config.js`(대조 대상). 렌더 테스트(jsdom)와 한 파일을
 * 겸할 수 없어(`@jest-environment node` 필요) `SocialLoginScreen.visual.test.tsx` 와
 * 분리했다 — 리포의 스캔 가드 4파일(`homeStructure`·`onboardingStructure`·`fsdStructure`·
 * `tabbarVisual`)이 예외 없이 따르는 형태다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 *
 * **A. 영구 규칙 — 유지한다.** (회귀 금지 · 우회 차단 · 토큰 경유 강제 — Figma 값이 바뀌어도 유효)
 *   - 주석 제거 후 스캔 + 그 파수꾼 it — 주석이 단언을 만족시키는 실패 클래스 자체를 닫는다.
 *     이 사이클에서 필요한 이유는 `noLiteral` 부정 단언 하나다 — `AuthGlyphs.tsx`·
 *     `LocationGlyphs.tsx`류 헤더 주석이 "값은 primary-text(#C13515)와 같다" 식 산문을
 *     적는 관행이 있어, 그 순간 `noLiteral`이 영구 거짓 RED 가 될 수 있다(02a §6-1).
 *   - `AuthGlyphs.tsx`에 `#c13515` 리터럴(대소문자 무관) 0건 — 토큰 우회 차단
 *   - `AUTH_ICON_COLORS.warning` === tailwind `primary-text` — 토큰 경유 강제.
 *     `AuthGlyphs.tsx`는 `homeStructure` D-3 raw-hex 가드의 모집단 밖이라(그 가드의
 *     모집단은 `HomeScreen.tsx` 하나뿐), 이 단언이 그 상수를 토큰 표에 묶는 유일한 끈이다
 *   - 모집단 앵커 3종(it 1·2·3) — 경로 오타·빈 스캔이 "위반 0건"으로 공허히 통과하는 것을
 *     막는다. `fs.existsSync` 방어는 일부러 쓰지 않는다 — 경로 오타는 `ENOENT`로 죽는
 *     것이 옳다(`tabbarVisual` 계승)
 *   - **블록/태그 슬라이스로 범위 좁히기**(02b) — 값이 바뀌어도 유효한 구조 규칙이다.
 *     "다른 글리프가 개수를 채워 주는" 실패 클래스를 닫는다
 *   - **3 path 를 배열로 비교**(02b) — 개수·순서를 고정해 *"적어도 하나가 만족"* 형태를
 *     없앤다. 3/4 사이클 D-4 의 `some` 과 같은 구조적 약점이었다. Figma 값이 바뀌어도
 *     "path 마다 같은 굵기"라는 구조는 유효하다(값만 B, 구조는 A)
 *   - **`size` → `width`/`height` 배선**(02b) — 숫자와 무관한 우회 차단(`width={40}`
 *     하드코딩이 기본값 잠금을 무력화하는 경로)
 *   - **스캔 헬퍼 의미 파수꾼**(02b) — 0건 `null` 함정과 `size = 180` 부분 포함 함정을
 *     실행으로 고정한다. 헬퍼가 no-op 으로 퇴화하면 즉시 red
 *
 * **B. 이행 체크포인트 — 한시적이다.** 아래는 Figma 의 특정 값을 고정한다 — 디자인이
 * 바뀌면 정당한 작업에 red 를 낸다.
 *   - `WarningTriangleGlyph` 정의 + `SocialLoginScreen.tsx` 사용 — 완화형: Figma 값
 *     고정이 아니라 심볼 이름 고정이다. 정당한 리네임에 red 다. 그럼에도 넣는 이유:
 *     이 문자열이 사라지면 글리프가 통째로 빠져도 렌더 층이 그것을 못 본다(신규 testID
 *     금지). 완화형: `UNSAFE_getByType` 렌더 단언으로 갈아타거나, testID 가 허용되면
 *     `within(banner).getByTestId(...)`로 이관
 *   - `viewBox="0 0 18 18"` — Figma 값 고정. 완화형: `viewBox` 존재만(정사각 18은
 *     스크린샷이 잡는다)
 *   - `strokeWidth` 3개가 전부 `'1.575'` — Figma 값 고정. **완화형: 값을 풀고 "3개가
 *     서로 같다"만 남긴다**(`new Set(값들).size === 1 && 값들.length === 3`) — 굵기 불균형
 *     차단(W-1)은 유지되고 Figma 리디자인은 통과한다
 *   - 렌더 크기 `18`(기본값 `size = 18` + 호출부 `size={18}`) — Figma 값 고정. **완화형:
 *     숫자를 풀고 "기본값과 호출부 값이 같다"만 남긴다** + `width`/`height` 배선(A)은 유지 —
 *     아이콘이 배너를 먹는 회귀(W-3)는 계속 잡히고 18→20 리디자인은 통과한다
 *
 * **B 카운터**: 이 사이클 신규 2파일(`SocialLoginScreen.visual.test.tsx`의 AC-V1~V3 +
 * 이 파일의 AC-V4) 전용. 현재값 = **0** (02b 보강분 포함 — 보강 뮤테이션 실측이 낸 red 는
 * 아래 제외구 ①에 걸린다: 그 단언을 만든 사이클 **안**의 작업이 낸 red 다).
 * **B 카운터 제외구**(`tabbarVisual`·`fsdStructure` 헤더에서 계승): 카운터에 세는 red 는
 * ① 그 단언을 만든 사이클 **밖**의 작업이 낸 것이고 ② B 단언 자체를 갱신하지 않고는
 * 통과할 수 없는 것이다(AND). 이번 사이클의 출생 red 는 전부 제외구에 걸려 세지 않는다 —
 * 출생 red 는 마찰이 아니라 가드가 실효함을 증명하는 정반대의 증거다.
 * **B 완화 시점**: 정당한 신규 작업이 B 때문에 red 를 낸 것이 **2회 누적되면 즉시** 위
 * 완화형으로 격하한다(사이클 종료를 기다리지 않는다).
 */

const ROOT = path.resolve('src');
const SCREEN_FILE = path.join(
  ROOT,
  'features',
  'auth',
  'ui',
  'SocialLoginScreen.tsx'
);
const GLYPHS_FILE = path.join(ROOT, 'features', 'auth', 'ui', 'AuthGlyphs.tsx');
const GRADIENTS_FILE = path.join(
  ROOT,
  'features',
  'auth',
  'config',
  'gradients.ts'
);

/**
 * "0건"을 안전하게 세는 헬퍼. `String.match(/…/g)`는 매치 0건일 때 배열이 아니라 `null`을
 * 돌려주므로 `.length`에서 TypeError로 죽는다(실측: `'abc'.match(/zzz/g)` → `null`).
 * `split(needle).length - 1`은 0건일 때 정직하게 `0`을 준다(`tabbarVisual.test.ts` 복제 —
 * 지역 함수라 import 불가, 리포의 현 형태).
 */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * 스캔 전처리 — 소스에서 주석을 걷어낸다(`tabbarVisual.test.ts:106` 패턴 복제). 블록 주석을
 * **먼저**, 줄 주석을 **나중에** 지운다 — 순서를 뒤집으면 `/* a // b *\/ const keep = 2;`
 * 한 줄에서 코드가 소실된다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

/** 모집단을 읽는 유일한 통로 — 원본 문자열이 단언에 새어 나가지 않도록 여기서만 읽는다. */
function readScannedSource(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

/**
 * **블록 슬라이스** — 함수 하나의 본문만 잘라낸다. 새 개념 한 줄: *파일 전역에서 세면 **다른
 * 글리프가 채워 준 개수**로 통과할 수 있으므로, 세는 범위를 그 함수 안으로 좁힌다.*
 * 이 파일은 글리프 6개가 한 모듈에 모여 있어(`AppIconGlyph`·`GoogleIcon`·…) 전역 카운트가
 * 특히 위험하다 — 18×18 글리프가 하나 더 생기는 순간 `viewBox` 개수 단언이 공허해진다.
 * 시작은 `export function <이름>`, 끝은 그 뒤 첫 `export function`(없으면 파일 끝 — 실측:
 * `WarningTriangleGlyph` 가 현재 파일 마지막 함수라 `indexOf` 가 `-1`). 못 찾으면 빈 문자열을
 * 주므로 뒤따르는 개수 단언이 0/[] 로 정직하게 red 가 된다(조용한 통과 없음).
 */
function sliceFunction(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  if (start === -1) return '';
  const end = source.indexOf('\nexport function ', start + 1);
  return end === -1 ? source.slice(start) : source.slice(start, end);
}

/** 같은 좁히기를 JSX 태그 한 개(`<태그 … >`)에 적용한 판. 호출부 prop 을 셀 때 쓴다. */
function sliceTag(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`);
  if (start === -1) return '';
  return source.slice(start, source.indexOf('>', start) + 1);
}

/**
 * 블록 안 모든 `strokeWidth={…}` 값을 **등장 순서대로** 뽑는다 — 개수와 값을 한 단언으로 본다.
 * `count(...) >= 1`(적어도 하나)이면 3 path 중 1개만 어긋난 **굵기 불균형 아이콘**이 통과한다
 * (03b W-1 실측: 삼각 외곽선만 `strokeWidth={2}` → 337/337 + 43/43 전부 GREEN).
 * 정규식 대신 `split`: `{` `}` 는 정규식 특수문자이고 `match(/…/g)` 는 0건에 `null` 을 주는데,
 * `split` 은 0건에 `[]` 를 준다(실측 검증: 아래 파수꾼 describe).
 */
function bracedValues(block: string, prop: string): string[] {
  return block
    .split(`${prop}={`)
    .slice(1)
    .map((rest) => rest.split('}')[0]);
}

/**
 * 기본값 `size = 18` 을 **꺼내서** 돌려준다. `includes('size = 18')` 로 재면 `size = 180` 도
 * 참이 된다(부분 포함) — 값을 잘라내 정확 비교해야 그 우회가 막힌다. 구분자는 `,`(다음 prop)
 * 또는 `}`(구조분해 끝).
 */
function defaultProp(block: string, prop: string): string {
  const rest = block.split(`${prop} = `)[1];
  return rest === undefined ? '' : rest.split(/[,}]/)[0].trim();
}

describe('스캔 전처리 · 주석 제거 — AC-V4 noLiteral 단언의 전제', () => {
  it('주석 안의 글자는 스캔에서 사라지고, 코드의 같은 글자는 남는다', () => {
    // Arrange — 실제 파일이 아니라 손으로 만든 표본을 쓴다. 실제 파일의 주석 문구가
    // 바뀌어도 이 테스트는 흔들리지 않고, 반대로 stripComments 가 아무것도 안 하는
    // no-op 으로 퇴화하면 여기서 즉시 red 가 난다 — 그 퇴화가 조용히 되돌려지는 것을
    // 막는 유일한 파수꾼이다.
    const sample = [
      '/** 헤더: 값은 primary-text(#c13515)와 같다 */',
      "const a = 'stroke={AUTH_ICON_COLORS.warning}';",
      '// 줄 주석: viewBox="0 0 18 18"',
      'const b = \'viewBox="0 0 20 20"\';',
    ].join('\n');

    // Act
    const stripped = stripComments(sample);

    // Assert — 두 방향을 한 객체로 본다. 주석만 지우고 끝이 아니라 코드는 남아야 한다
    // (전부 지우는 구현도 앞 두 키만 보면 통과해 버린다).
    expect({
      fromBlockComment: stripped.includes('#c13515'),
      fromLineComment: stripped.includes('viewBox="0 0 18 18"'),
      fromCodeString: stripped.includes('AUTH_ICON_COLORS.warning'),
      fromCodeClass: stripped.includes('viewBox="0 0 20 20"'),
    }).toEqual({
      fromBlockComment: false,
      fromLineComment: false,
      fromCodeString: true,
      fromCodeClass: true,
    });
  });
});

describe('스캔 헬퍼 의미 검증 — 0건·부분 포함 함정 (02b 보강분의 전제)', () => {
  it('bracedValues 는 0건에 빈 배열을 주고, defaultProp 은 부분 포함(180)에 속지 않는다', () => {
    // Arrange — 실제 파일이 아니라 손으로 만든 표본. 두 함정을 산문으로 주장하지 않고
    // **실행으로** 남긴다(매처·쿼리 의미 추정 금지 규칙 — 02a 4-a 매처 실검증 의무).
    const sample =
      'function X({ size = 180, testID }) { <P strokeWidth={2} /> }';

    // Act & Assert — 한 객체로 본다.
    expect({
      // `match(/…/g)` 였다면 0건에 `null` → `.length` 에서 TypeError. split 판은 `[]` 다.
      noneFound: bracedValues('아무것도 없음', 'strokeWidth'),
      found: bracedValues(sample, 'strokeWidth'),
      // `includes('size = 18')` 로 재면 `size = 180` 에서 true 가 나온다(부분 포함 함정).
      // 값을 꺼내면 '180' 이라 `'18'` 과 다르다 — 그래서 defaultProp 을 쓴다.
      naiveIncludes: sample.includes('size = 18'),
      extracted: defaultProp(sample, 'size'),
      // 슬라이스가 대상을 못 찾으면 빈 문자열 → 뒤 개수 단언이 0/[] 로 red (조용한 통과 없음).
      missingBlock: sliceFunction('없음', 'Nope'),
      missingTag: sliceTag('없음', 'Nope'),
    }).toEqual({
      noneFound: [],
      found: ['2'],
      naiveIncludes: true,
      extracted: '180',
      missingBlock: '',
      missingTag: '',
    });
  });
});

describe('AC-V4 · 경고 글리프 정의 — Figma 좌표계·선굵기·렌더 크기 (소스 스캔)', () => {
  it('WarningTriangleGlyph 가 AuthGlyphs.tsx 에 정의되고 viewBox 18×18·strokeWidth 1.575 를 쓴다', () => {
    // Arrange — 소스 스캔은 읽는 것이 곧 실행이다(렌더 없음).
    const scanned = readScannedSource(GLYPHS_FILE);

    // 앵커 — "정말 이 파일을 읽었나"를 경로(동결 문자열)와 내용(정체성 표지) 두 다리로
    // 잠근다. isGlyphModule = 이 파일이 실제 AuthGlyphs 모듈인지, hasKakaoIcon = 기존
    // 글리프 5개 중 하나가 살아 있는지(엉뚱한 파일을 읽지 않았다는 보증).
    expect({
      file: path.relative(ROOT, GLYPHS_FILE),
      isGlyphModule: /export function AppIconGlyph\b/.test(scanned),
      hasKakaoIcon: scanned.includes('KakaoIcon'),
    }).toEqual({
      file: 'features/auth/ui/AuthGlyphs.tsx',
      isGlyphModule: true,
      hasKakaoIcon: true,
    });

    // 대괄호 `[` `]`는 정규식 특수문자다(`new RegExp('h-[52px]')`는 리터럴에 매치되지
    // 않는다, 02a §6-3 실측) — 값 탐색은 문자열 count/includes 만 쓴다.
    //
    // 세는 범위는 **파일 전역이 아니라 이 함수 블록**이다(02b W-1/W-3 보강). 전역이면 다른
    // 글리프가 개수를 채워 줘 통과할 수 있다 — 이 모듈엔 글리프가 6개 있다.
    const block = sliceFunction(scanned, 'WarningTriangleGlyph');

    expect({
      defined: /export function WarningTriangleGlyph\b/.test(scanned),
      // `>= 1` → `=== 1`. 이 블록 안 좌표계는 하나뿐이어야 한다(실측 1).
      viewBox18: count(block, 'viewBox="0 0 18 18"') === 1,
      // 렌더 크기 잠금 ①/③ — 기본값(실측: `size = 18` 1회). AC-V4 의 "18px" 은 좌표계가
      // 아니라 **렌더 크기**이고, 그것을 정하는 것은 `size` 다(`viewBox` 는 내부 좌표계).
      sizeDefault: defaultProp(block, 'size'),
      // 렌더 크기 잠금 ② — `size` 를 실제 width/height 로 흘려보내는 배선(각 실측 1회).
      // 이 두 줄이 없으면 `width={40}` 하드코딩으로 기본값 잠금을 우회할 수 있다.
      widthBoundToSize: count(block, 'width={size}') === 1,
      heightBoundToSize: count(block, 'height={size}') === 1,
    }).toEqual({
      defined: true,
      viewBox18: true,
      sizeDefault: '18',
      widthBoundToSize: true,
      heightBoundToSize: true,
    });

    // W-1 보강 — 3 path 의 선굵기를 **각각 정확값으로** 본다. 배열 비교라 개수(3)와 값
    // (1.575)과 순서를 한 번에 고정한다: 외곽선만 `2` 로 바꾸면 `['2','1.575','1.575']` 로
    // red, path 를 빼면 길이 2 로 red, 4번째 path 를 다른 굵기로 넣으면 길이 4 로 red.
    expect(bracedValues(block, 'strokeWidth')).toEqual([
      '1.575',
      '1.575',
      '1.575',
    ]);
  });
});

describe('AC-V4 · 경고 글리프 사용 — 화면이 실제로 import·렌더한다 (소스 스캔)', () => {
  it('SocialLoginScreen.tsx 가 WarningTriangleGlyph 를 import 하고 렌더한다', () => {
    const scanned = readScannedSource(SCREEN_FILE);

    expect({
      file: path.relative(ROOT, SCREEN_FILE),
      isScreen: /export function SocialLoginScreen\b/.test(scanned),
      hasBannerTestId: scanned.includes('auth-login-error-banner'),
    }).toEqual({
      file: 'features/auth/ui/SocialLoginScreen.tsx',
      isScreen: true,
      hasBannerTestId: true,
    });

    // imported ≥ 2 = import 구문 1회 + 사용 1회 이상. 정의만 하고 안 쓰는 상태를 막는
    // 것이 이 it 의 전부다 — "배너 안"인지는 보지 않는다(AC 문구 밖, 스크린샷 대조 몫).
    expect({
      imported: count(scanned, 'WarningTriangleGlyph') >= 2,
      rendered: count(scanned, '<WarningTriangleGlyph') >= 1,
      // 렌더 크기 잠금 ③/③ — 호출부(02b W-3). 기본값만 잠그면 `size={40}` 로 우회되고,
      // 호출부만 잠그면 "prop 삭제 + 기본값 변경" 으로 우회된다 → **둘 다** 잠근다.
      // 세는 범위는 이 태그 안이다: 파일 전역 `size={18}` 은 실측 1회지만, 다른 컴포넌트가
      // 나중에 `size={18}` 을 갖게 되면 전역 카운트는 이 글리프가 40 이 되어도 1 을 유지한다.
      sizeAtCallSite:
        count(sliceTag(scanned, 'WarningTriangleGlyph'), 'size={18}') === 1,
    }).toEqual({
      imported: true,
      rendered: true,
      sizeAtCallSite: true,
    });
  });
});

describe('AC-V4 · 경고 글리프 색 — 상수 경유 + tailwind 토큰 일치 (소스 스캔)', () => {
  it('AUTH_ICON_COLORS.warning 이 존재하고 AuthGlyphs.tsx 가 그것을 경유하며, 값이 tailwind primary-text 와 같다', () => {
    const gradientsScanned = readScannedSource(GRADIENTS_FILE);
    const glyphsScanned = readScannedSource(GLYPHS_FILE);

    // 캡처 그룹 `(...)`이 따옴표 안 hex 값만 꺼낸다. 매치 실패 시 undefined — 이 단언을
    // 먼저 확인하는 이유: 곧바로 tokenMatch 로 가면 상수 선언 형태가 달라 정규식이
    // 못 찾았을 때 실패 메시지가 "왜 undefined 인지"를 말해 주지 않는다.
    const colorMatch = gradientsScanned.match(/warning: '(#[0-9A-Fa-f]{6})'/);
    const extractedColor = colorMatch ? colorMatch[1] : undefined;

    expect({ extracted: typeof extractedColor === 'string' }).toEqual({
      extracted: true,
    });

    expect({
      // 상수 경유 형태가 있다 — 경유 경로 존재.
      viaConstant: glyphsScanned.includes('stroke={AUTH_ICON_COLORS.warning}'),
      // 우회 경로 차단 — tailwind 는 대문자(#C13515), Figma raw 는 소문자(#c13515)다.
      // 소문자화 후 비교해 어느 쪽으로 박아도 우회는 우회로 잡는다. 이 단언은
      // AuthGlyphs.tsx 에만 건다 — 파일 전역 raw-hex 금지는 불가능하다(이 파일은
      // 브랜드색 8개를 의도적으로 갖는다, 토큰화 금지 대상).
      noLiteral: count(glyphsScanned.toLowerCase(), '#c13515') === 0,
    }).toEqual({
      viaConstant: true,
      noLiteral: true,
    });

    // 경유한 값이 실제로 토큰값과 같다 — 기대값을 이 파일에 하드코딩하지 않는다
    // (하드코딩하면 토큰이 바뀔 때 tailwind·컴포넌트·이 테스트 세 곳이 갈라진다).
    // 소스에서 뽑은 값을 tailwind 와 대조해 두 파일이 서로를 검산하게 한다.
    // colors 는 tailwindcss 의 ResolvableTo<RecursiveKeyValuePair> 타입이라 문자열 키
    // 인덱싱을 TS 가 거부한다 — 런타임엔 평범한 객체이므로 Record 로 좁혀서 읽는다.
    const colors = tailwindConfig.theme?.extend?.colors as
      Record<string, string> | undefined;
    const tokenColor = colors?.['primary-text'];

    expect({ tokenMatch: extractedColor === tokenColor }).toEqual({
      tokenMatch: true,
    });
  });
});
