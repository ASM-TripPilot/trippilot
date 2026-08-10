/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-226 거점 전제 게이트 — **층 배치의 소스면 심판.**
 *
 * ── 왜 이 파일이 필요한가 ────────────────────────────────────────────────
 * 이 칸의 설계 난점은 하나였다: 보완 시트가 **지도**(`@/shared/map`)와 **네트워크**
 * (`@/shared/api/generated`)를 둘 다 물어야 하는데, 화면(`TripWizardStep2Screen`)은
 * *"완성된 문자열·불리언만 받는 순수 진열대"*라는 계약(AC-G3)을 지고 있다.
 *
 * 채택한 배치: **시트를 독립 파일로 빼고 상태를 하나도 주지 않는다.**
 *   - 지도는 **시트**가 문다 (`shared → features`는 FSD 정방향이고 `StayRegisterScreen`이
 *     이미 같은 형태다)
 *   - 네트워크는 **배선**이 문다
 *   - 판정은 **순수 모듈**(`baseGate.ts`)이 진다
 *
 * 이 배치는 **렌더 단언으로는 하나도 안 보인다.** 시트가 자기 `useState`로 저장 게이트를
 * 다시 계산해도 화면은 똑같이 나오고, 그 순간 D3("저장 성공 = 즉시 지정 가능")가 두 곳에서
 * 따로 계산되기 시작한다 — *"고쳤는데 여전히 막힌다"*가 층 사이 틈에서 되살아난다.
 * 소스에서만 보이는 성질이라 여기서 잰다.
 *
 * ⚠️ **전처리 함정(★16 · 2026-07-31 실사고 계열).** 아래 스캔은 전부 **주석을 걷어낸** 소스를
 * 본다. 이 칸의 소스 머리말에는 `useState`를 두지 않는다·`@tanstack/react-query`를 모른다
 * 같은 **금칙어를 적은 산문**이 실제로 들어간다(설계 근거를 주석에 쓰는 것이 리포 관례다) —
 * 안 걷으면 산문이 부정 단언을 red로 만드는 **거짓 red**가 난다. 반대로 순진한 `//.*` 제거는
 * `'https://…'`의 슬래시를 주석 시작으로 오인해 그 줄의 진짜 코드를 통째로 지운다.
 * 첫 describe가 **전처리와 탐지기를 함께 태워** 둘이 서로를 지우지 않음을 회귀 가드로 잠근다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 같은
 * it 안에서 짝을 이룬다. 헬퍼는 공용화하지 않고 파일마다 각자 갖는다.
 *
 * ── 졸업 조건 (frontend/CLAUDE.md "장치 판정 규칙") ──────────────────────
 * **한시적 이행 체크포인트.** 잠그는 것이 이번 칸의 층 계약 스냅숏이라 정당한 리네임에
 * red를 낸다. **카운터 = 0.** 정당한 작업이 이 파일 때문에 red를 낸 것이 **2회 누적**되면
 * 즉시 `baseGate.ts`의 import 0건(★17)만 남기고 나머지 심볼 단언을 뗀다 —
 * 그 하나만 영구 규칙(순수성)이고 나머지는 이번 배치의 사진이다.
 */

const SRC_ROOT = resolve(__dirname, '..');

const SCREEN_REL = 'features/trip/ui/TripWizardStep2Screen.tsx';
const SHEET_REL = 'features/trip/ui/TripBaseFixSheet.tsx';
const PAGE_REL = 'pages/trip-new-step2/ui/TripNewStep2Page.tsx';
const GATE_REL = 'features/trip/model/baseGate.ts';
const FIX_HOOK_REL = 'features/trip/model/useBaseFix.ts';

/**
 * 주석을 걷어낸다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다).
 * 줄 주석 규칙에서 **바로 앞 글자가 `:`이면 주석으로 보지 않는다** — `'https://…'`의
 * 슬래시를 주석 시작으로 오인하지 않기 위한 것이고, 완전한 파서를 만들지 않는 것이 의도다.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 구현 전에도 "무엇이 없는가"를 깨끗한 assertion diff로 남기기
 * 위해서다(ENOENT 예외로 죽으면 diff가 안 남는다). 빈 문자열이 부정 단언을 공짜로
 * 통과시키는 것은 같은 it 안의 긍정 짝이 먼저 막는다. */
function readOne(rel: string): string {
  const full = join(SRC_ROOT, rel);
  if (!existsSync(full)) return '';
  return stripComments(readFileSync(full, 'utf8'));
}

function existsPair(rel: string): { file: string; exists: boolean } {
  return { file: rel, exists: existsSync(join(SRC_ROOT, rel)) };
}

/** 금칙어 중 실제로 등장한 것만 남긴다 — 위반을 **이름과 함께** 남긴다. */
function present(source: string, needles: string[]): string[] {
  return needles.filter((needle) => source.includes(needle));
}

describe('★16 · 탐지기 자가검사 — 이게 통과해야 아래 단언이 의미를 갖는다', () => {
  it('머리말 산문은 걷히고, 코드의 URL·useState·import는 살아남는다', () => {
    // 이 칸에서 실제로 쓰일 시트 소스를 본뜬 문자열이다 — 머리말 Figma URL, 산문 속 금칙어
    // (`useState`·`@tanstack/react-query`·`Date.now`), 주석 처리된 코드, 그리고 코드 쪽의
    // URL·useState·import가 전부 들어 있다. 핵심은 **이 셋이 서로를 지우는가**다.
    const sample = [
      '/**',
      ' * 보완 시트 — Figma https://www.figma.com/design/1MTF3dt?node-id=1358-1546',
      ' * useState를 두지 않는다. @tanstack/react-query도 모른다. Date.now도 안 읽는다.',
      ' */',
      "import { KakaoMapView } from '@/shared/map';",
      '// const dead = useState(null);',
      'const [open, setOpen] = useState(false);',
      "const url = 'https://cdn.example.com/x.jpg';",
    ].join('\n');

    const stripped = stripComments(sample);

    // ① 주석 속 금칙어는 걷힌다 — 걷지 않으면 "useState를 두지 않는다"고 **적은 주석 자체가**
    //    아래 부정 단언을 red로 만든다(거짓 red). 표본의 `useState` 3개 중 2개가 주석이므로
    //    걷고 나면 **정확히 1개**(코드)만 남아야 한다.
    expect(stripped).not.toContain('figma.com');
    expect(stripped).not.toContain('@tanstack/react-query');
    expect(stripped).not.toContain('Date.now');
    expect(stripped.split('useState').length - 1).toBe(1);

    // ② ★ 조합 검증 — 전처리를 태운 **뒤에도** 탐지 대상이 살아 있어야 한다. 순진한 `//.*`
    //    제거는 URL 줄을 `const url = 'https:` 로 잘라 URL 단언을 공짜로 통과시킨다.
    expect(stripped).toContain("const url = 'https://cdn.example.com/x.jpg';");
    expect(stripped).toContain("import { KakaoMapView } from '@/shared/map';");
    expect(stripped).toContain('const [open, setOpen] = useState(false);');

    // ③ 진짜 위반은 여전히 잡힌다 — 탐지기가 전처리 때문에 눈이 먼 것이 아니다.
    expect(present(stripped, ['useState'])).toEqual(['useState']);
    expect(
      present(stripComments('const t = Date.now();'), ['Date.now'])
    ).toEqual(['Date.now']);
    // ④ `Date.UTC`는 금칙이 아니다(순수 산술) — 시계 금칙과 섞이지 않는지 함께 본다.
    expect(
      present(stripComments('Date.UTC(2026, 5, 10);'), ['Date.now'])
    ).toEqual([]);
  });
});

describe('다섯 파일이 실재한다 (아래 읽기가 의미를 갖는 전제)', () => {
  it('화면·시트·배선·순수 모듈·훅이 서 있다', () => {
    [SCREEN_REL, SHEET_REL, PAGE_REL, GATE_REL, FIX_HOOK_REL].forEach((rel) =>
      expect(existsPair(rel)).toEqual({ file: rel, exists: true })
    );
  });
});

describe('AC-G3 · 화면은 여전히 순수 진열대다 (독립 재확인)', () => {
  it('화면이 시트를 가리키되, 조회·라우팅·스토어·생성 클라이언트를 여전히 모른다', () => {
    // 동결된 `tripWizardStep2Structure.test.ts`가 같은 목록을 이미 잰다. 여기서 **다시** 재는
    // 이유는 이 칸의 배치 결정이 그 가드에 **얹혀 있기** 때문이다 — 그 파일이 나중에 어떤
    // 이유로든 완화되면 이 칸의 근거가 조용히 사라진다. 심판은 자기 근거를 자기가 들어야 한다.
    const screenSource = readOne(SCREEN_REL);

    // 긍정 짝 — 읽은 것이 정말 그 화면이고, 시트를 **실제로 렌더한다**. 없으면 아래 금칙
    // 0건을 "시트를 안 만든" 구현도 통과한다.
    expect(screenSource).toMatch(/export function TripWizardStep2Screen\b/);
    expect(screenSource).toContain('TripBaseFixSheet');

    const FORBIDDEN = [
      'expo-router',
      '@tanstack/react-query',
      'useTripBases',
      'useTripCoverage',
      'useSavedStays',
      'useTripWizardStore',
      '@/shared/api/generated',
      'toBaseSections',
      // 이 칸이 더하는 두 줄 — 게이트 판정과 네트워크가 화면으로 새어 들면 AC-G3가 깨진다.
      'useFixSavedStay',
      'baseBlockReason',
    ];
    expect(present(screenSource, FORBIDDEN)).toEqual([]);
  });
});

describe('§3-3 · 시트는 지도만 알고 상태를 갖지 않는다', () => {
  it('`@/shared/map`을 물되 useState·훅·라우터·타 feature를 모른다', () => {
    const sheetSource = readOne(SHEET_REL);

    // 긍정 짝 ① — 읽은 것이 정말 그 시트다.
    expect(sheetSource).toMatch(/export function TripBaseFixSheet\b/);
    // 긍정 짝 ② — 지도를 **실제로** 문다. 01b D2가 "좌표 확정은 KakaoMapView 핀 외에 길이
    // 없다"로 정했으므로, 지도가 없는 시트는 좌표 축을 아예 고칠 수 없다.
    expect(sheetSource).toContain('@/shared/map');
    // 긍정 짝 ③ — 경고 아이콘은 **같은 feature**에서 가져온다(★19). 같은 이름의 글리프가
    // `features/stay/ui/StayGlyphs`에도 있고 계약이 다르다(`tone` vs `size`).
    expect(sheetSource).toContain('@/features/trip/ui/TripGlyphs');

    const FORBIDDEN = [
      // 상태를 쥐면 D3 저장 게이트가 시트와 배선 두 곳에 살게 된다(§3-3).
      'useState',
      'useReducer',
      'useRef',
      // 네트워크·라우팅·스토어는 배선의 것이다.
      '@tanstack/react-query',
      '@/shared/api/generated',
      'expo-router',
      'useTripWizardStore',
      'useFixSavedStay',
      // 교차 feature import는 기계로 안 막힌다(eslint FEATURES = onboarding·home뿐, 실측).
      // 이 줄이 그 관례를 처음으로 기계화하는 자리다.
      '@/features/stay',
      // 층 역행 — 화면이 배선을 되짚어 올라가면 안 된다.
      '@/pages',
    ];
    expect(present(sheetSource, FORBIDDEN)).toEqual([]);
  });
});

describe('배선이 네트워크를 지고, 지도를 모른다', () => {
  it('두 PATCH 훅과 게이트 판정을 물되 KakaoMapView는 안 문다', () => {
    const pageSource = readOne(PAGE_REL);

    // 긍정 짝 — 배선이 실제로 이 칸의 세 부품을 쓴다.
    expect(pageSource).toContain('useFixSavedStay');
    expect(pageSource).toContain('useExtendTripPeriod');
    // 판정을 순수 모듈에서 가져다 쓴다 — 배선이 조건식을 다시 짜면 `baseGate.test.ts`의
    // 32조합 전수 심판이 배선에는 안 걸린다.
    expect(pageSource).toContain('baseBlockReason');
    expect(pageSource).toContain('isOutsideTripPeriod');
    // 기간을 늘렸으면 스토어도 갱신해야 한다(맹점 ④) — 렌더 심판은 ★12가 따로 잰다.
    expect(pageSource).toContain('setPeriod');

    // 부정 — 지도는 시트의 것이다. 배선이 WebView를 직접 쥐면 배선 테스트가 전부 env 키에
    // 묶인다(02a §2-a 실측: 키가 없으면 `map-webview`가 아예 없다).
    expect(present(pageSource, ['KakaoMapView', '@/shared/map'])).toEqual([]);
  });
});

describe('★17 · baseGate.ts는 import가 0건이고 시계를 안 읽는다 (AC-G4)', () => {
  it('여섯 함수가 서 있고, 바깥 세계를 하나도 안 문다', () => {
    const gateSource = readOne(GATE_REL);

    // 긍정 짝 — 여섯 함수가 실제로 export된다. 없으면 빈 파일이 아래 부정 단언을 공짜로
    // 통과한다(import 0건은 빈 파일의 성질이기도 하다).
    [
      'baseBlockReason',
      'canSaveStayFix',
      'isOutsideTripPeriod',
      'extendedTripPeriod',
      'tripDayOptions',
      'applyDayPick',
    ].forEach((name) =>
      expect(gateSource).toMatch(new RegExp(`export function ${name}\\b`))
    );

    // 본체 — "시계·네트워크를 안 읽는다"(AC-G4)를 문장이 아니라 **구조로** 잠근다.
    // import가 0이면 읽을 것 자체가 없다. 타입도 자기 것만 쓴다.
    expect(gateSource).not.toMatch(/^\s*import\s/m);

    // 시계 금칙 — `Date.now()`나 무인자 `new Date()`로 "오늘"을 읽는 구현은 고정 픽스처
    // 테스트를 전부 통과하다가 **날짜가 바뀌면 어느 날 갑자기 깨진다**.
    expect(present(gateSource, ['Date.now', 'new Date('])).toEqual([]);
    // 짝 — `Date.UTC`(순수 산술)는 금칙이 아니다. 이 구분을 안 하면 이미 `Date.UTC`를 쓰는
    // `baseSections.ts`와 규칙이 어긋난다. `tripDayOptions`가 날짜를 하루씩 세려면 필요하다.
    expect(gateSource).toContain('Date.UTC');
  });
});

describe('★15 · useBaseFix.ts의 무효화 사정거리 (소스면)', () => {
  it('생성 키 헬퍼를 쓰고, bases·coverage 키를 손대는 범위가 계약대로다', () => {
    const hookSource = readOne(FIX_HOOK_REL);

    // 긍정 짝 — 두 훅이 실제로 서 있고, 키를 **손으로 적지 않고** 생성물 헬퍼를 쓴다.
    // 다시 적으면 코드젠이 키를 바꿔도 아무도 모르게 어긋난다(`useTripBases.ts` 선례).
    expect(hookSource).toMatch(/export function useFixSavedStay\b/);
    expect(hookSource).toMatch(/export function useExtendTripPeriod\b/);
    expect(hookSource).toContain('getGetSavedStaysQueryKey');
    expect(hookSource).toContain('getGetTripsTripIdCoverageQueryKey');

    // 부정 — 배정 목록은 이 두 조작으로 바뀌지 않는다. 실제 요청 수는
    // `useBaseFix.integration.test.tsx`가 MSW로 재고, 여기서는 **키 자체가 안 들어오는지**를
    // 본다(둘은 다른 것을 잡는다 — 소스면은 "무효화할 의도가 없다"를, MSW는 "실제로 안 갔다"를).
    expect(present(hookSource, ['getGetTripsTripIdBasesQueryKey'])).toEqual([]);
  });
});
