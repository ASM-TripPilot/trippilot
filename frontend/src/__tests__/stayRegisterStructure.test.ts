/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * G-0~G-8 (브리프 AC-S1~S4 · 01b Seed §4 · §3-5 · §7) — e05 등록 표면 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 두 층은 사정거리가 다르다. 렌더 단언(`StayRegisterScreen.test.tsx`)은
 * "이번 렌더에서 실제로 나온 출력"만 본다. 여기는 **조건부로만 렌더되는 코드·아예 렌더되지
 * 않는 import**까지 본다 — INV-3처럼 "어떤 경로로도 나오면 안 되는 것"과 FSD 층 경계처럼
 * "출력에 안 보이는 것"은 소스 층이라야 잡힌다.
 *
 * **기존 가드가 못 덮는 구멍을 이 파일이 메운다.** `staySearchStructure.test.ts`는
 *  ① `duration` 모집단이 `features/stay` + `pages/stay-search` + `app/stays`라
 *     **`pages/stay-register`가 사각지대**이고,
 *  ② raw hex 목록(`TOKENIZED_HEX`)이 11색이라 이 화면의 민트 3색
 *     (`#f0fcfa`·`#a1e8dd`·`#0b6e63`)을 **못 잡는다** — tailwind에는 `info-bg`·`info-border`·
 *     `info`로 이미 존재하는데도 raw로 박으면 green이었다(02a ★3).
 * 그 두 구멍을 여기서 닫는다. 동결된 기존 파일의 상수·it 본문은 건드리지 않는다.
 *
 * 전제 — 모든 it은 주석을 걷어낸 소스를 스캔한다. 걷어내지 않으면 헤더 주석의 산문이
 * 부정 단언을 대신 만족시키는 거짓 GREEN을 낸다.
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다"는 "있어야 한다" 앵커와 같은 it 안에서
 * 짝을 이루고, 탐지기는 합성 위반을 실제로 잡는지 자가검사한다.
 */

const ROOT = path.resolve('src');

/** INV-3 모집단 — 이 칸이 새로 만드는 숙소 표면 3층 전부. */
const DURATION_SCAN_DIRS = [
  path.join(ROOT, 'features', 'stay'),
  path.join(ROOT, 'pages', 'stay-register'),
  path.join(ROOT, 'app', 'stays'),
];

/**
 * 토큰 스캔 모집단 — 화면 부품과 배선.
 *
 * 게이트①-2 수정(2026-08-01): 두 번째 항목이 `pages/stay-register` **디렉토리 전체**였다.
 * 첫 항목은 `ui`까지 좁혀져 있는데 대칭이 깨져 순수 배럴 `index.ts`가 딸려 들어왔고,
 * G-1의 "모든 파일이 className으로 스타일링된다"를 **어떤 배럴 구현으로도 만족할 수 없어**
 * 구조적으로 통과 불가였다(검증 n=1 F-1). `ui`로 한정해 첫 항목과 대칭을 맞춘다.
 */
const TOKEN_SCAN_DIRS = [
  path.join(ROOT, 'features', 'stay', 'ui'),
  path.join(ROOT, 'pages', 'stay-register', 'ui'),
];

const SCREEN_FILE = path.join(
  ROOT,
  'features',
  'stay',
  'ui',
  'StayRegisterScreen.tsx'
);
const PAGE_FILE = path.join(
  ROOT,
  'pages',
  'stay-register',
  'ui',
  'StayRegisterPage.tsx'
);
const BARREL_FILE = path.join(ROOT, 'pages', 'stay-register', 'index.ts');
const ROUTE_FILE = path.join(ROOT, 'app', 'stays', 'register.tsx');
const FORM_FILE = path.join(
  ROOT,
  'features',
  'stay',
  'model',
  'stayRegisterForm.ts'
);
const SEARCH_PAGE_FILE = path.join(
  ROOT,
  'pages',
  'stay-search',
  'ui',
  'StaySearchPage.tsx'
);
const SEARCH_SCREEN_FILE = path.join(
  ROOT,
  'features',
  'stay',
  'ui',
  'StaySearchScreen.tsx'
);

/**
 * 기존 가드의 11색 + **이 화면이 새로 쓰는 민트 3색**. 셋 다 tailwind.config.js에
 * `info-bg`(#F0FCFA) · `info-border`(#A1E8DD) · `info`(#0B6E63)로 실재함을 확인했다 —
 * 토큰이 있는데 raw로 박는 것은 토큰 우회다.
 */
const TOKENIZED_HEX = [
  '#ffffff',
  '#222222',
  '#6a6a6a',
  '#3f3f3f',
  '#dddddd',
  '#ededed',
  '#ff385c',
  '#f7f7f7',
  '#ffe4e9',
  '#9aa1ab',
  '#f2f2f2',
  '#f0fcfa',
  '#a1e8dd',
  '#0b6e63',
];

/** `features/stay/ui`의 FSD 경계 금지 목록(기존 가드와 같은 집합) — 화면은 무상태여야 한다. */
const FORBIDDEN_IN_SCREEN = [
  'useState',
  'useReducer',
  'zustand',
  'expo-router',
  '@tanstack/react-query',
  'axios',
  '@/shared/api/generated/stays',
  '@/features/home',
  '@/features/auth',
  '@/features/onboarding',
];

/** 이 칸이 확정한 testID 계약(02a §5) — 템플릿으로 조립되는 것은 접두사로 본다. */
const REQUIRED_TEST_IDS = [
  'stay-register-root',
  'stay-register-tab-mapsearch',
  'stay-register-tab-linkpaste',
  'stay-register-tab-pin',
  'stay-register-search-input',
  'stay-register-candidate-hint',
  'stay-register-candidate-empty',
  'stay-register-candidate-skeleton-',
  'stay-register-searchfail',
  'stay-register-searchfail-retry',
  'stay-register-pinfallback',
  'stay-register-map-preview',
  'stay-register-coordnotice',
  'stay-register-mapconfirm',
  'stay-register-mapsheet',
  'stay-register-mapsheet-confirm',
  'stay-register-mapsheet-close',
  'stay-register-date-field',
  'stay-register-date-summary',
  'stay-register-date-error',
  'stay-register-datesheet',
  'stay-register-date-cell-',
  'stay-register-submit',
  'stay-register-submitfail',
  'stay-register-submitfail-retry',
];

/** 티켓 §6이 이름까지 확정한 5종 — 위 목록이 조용히 그것들을 빠뜨리지 않았는지 잠근다. */
const TICKET_FIXED_TEST_IDS = [
  'stay-register-tab-mapsearch',
  'stay-register-tab-linkpaste',
  'stay-register-tab-pin',
  'stay-register-submit',
  'stay-register-mapconfirm',
];

/**
 * 주석 제거. `(?<!:)`(직전 문자가 `:`가 아닐 때만 매치) 없이는 `https://`의 `//`를 주석으로
 * 오인해 줄 나머지를 날린다 — G-5의 탐지 대상이 바로 URL이라, 순진한 판을 쓰면 위반이
 * **스캔에서 조용히 사라져 어떤 구현으로도 red가 나지 않는다**(2026-07-31 TRIP-197 실사고,
 * `mapBridgeStructure.test.ts:47-52` 선례). 아래 G-0이 이 두 방향을 모두 자가검사한다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*/g, '');
}

/** 디렉토리가 없으면 빈 배열(방어) — 구현 전에는 pages/stay-register가 아직 없다. 방어 없이
 * readdirSync를 걸면 예외로 죽어 "무엇이 없는가"를 읽을 diff가 안 남는다. */
function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listSourceFiles(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    })
    .sort();
}

function readAll(files: string[]): { file: string; source: string }[] {
  return files.map((file) => ({
    file: path.relative(ROOT, file).split(path.sep).join('/'),
    source: stripComments(fs.readFileSync(file, 'utf8')),
  }));
}

/** 존재 여부를 경로와 함께 감싼다 — 실패 메시지에 어느 파일인지 남기는 리포 표준 형태. */
function existsPair(file: string): { file: string; exists: boolean } {
  return { file: path.relative(ROOT, file), exists: fs.existsSync(file) };
}

function readOne(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'));
}

describe('G-0 · stripComments 자가검사 (선제 green — 탐지기가 눈멀지 않았다)', () => {
  it('진짜 주석은 지우고, URL이 있는 줄은 통째로 살린다', () => {
    // 방향 ① — 주석 속 문자열이 부정 단언을 거짓 만족시키지 않는다.
    expect(stripComments('// useState 금지\nconst a = 1;')).not.toContain(
      'useState'
    );
    expect(stripComments('/* dapi.kakao.com */\nconst b = 2;')).not.toContain(
      'dapi.kakao.com'
    );

    // 방향 ② — URL의 `//`를 주석으로 오인하지 않는다. 이 단언이 없으면 `(?<!:)`를 지웠을 때
    // G-5가 조용히 눈이 멀고(위반이 스캔 전에 사라진다) 아무도 모른다.
    const withUrl =
      "const sdk = 'https://dapi.kakao.com/v2/maps/sdk.js'; const x = 1;";
    expect(stripComments(withUrl)).toContain('dapi.kakao.com');
    expect(stripComments(withUrl)).toContain('const x = 1;');
  });
});

describe('G-1 · 토큰 사용 — 민트 3색까지 포함한 raw hex 금지 (브리프 AC-S2)', () => {
  it('등록 표면 전 파일이 className으로 스타일링되고, 토큰화된 14색 raw hex가 0건이다', () => {
    const sources = readAll(
      TOKEN_SCAN_DIRS.flatMap((dir) => listSourceFiles(dir)).filter(
        // 글리프는 예외 — SVG의 stroke/fill 색은 className으로 줄 수 없다(기존 가드와 동일 사유).
        (file) => !/Glyphs\.tsx$/.test(file)
      )
    );

    // 앵커 — 모집단에 이 칸의 화면과 배선이 실제로 들어 있다. 없으면 아래 "0건"이 공허하다.
    expect(sources.map((s) => s.file)).toContain(
      'features/stay/ui/StayRegisterScreen.tsx'
    );
    expect(sources.map((s) => s.file)).toContain(
      'pages/stay-register/ui/StayRegisterPage.tsx'
    );

    // className 요구는 **화면 부품 층에만** 건다(선례 `staySearchStructure.test.ts:243-259` —
    // 그 파일은 `styled: true`를 `features/stay/ui`에만 걸고 페이지를 넣은 적이 없다).
    // 게이트①-2 수정(2026-08-01): 원래 `sources` 전체에 걸어 배선 페이지까지 요구했으나,
    // 배선 페이지는 마크업 스타일을 갖지 않는 층이다 — 선례 `StaySearchPage.tsx`도
    // `className` 0건이고 `StayRegisterPage.tsx`도 0건이라 **구조적으로 통과 불가**였다
    // (검증 n=1 F-1 잔여분). raw hex 금지는 아래처럼 배선 페이지까지 그대로 덮는다.
    sources
      .filter(({ file }) => file.startsWith('features/stay/ui/'))
      .forEach(({ file, source }) => {
        expect({ file, styled: /className=/.test(source) }).toEqual({
          file,
          styled: true,
        });
      });

    const offenders = sources.flatMap(({ file, source }) =>
      TOKENIZED_HEX.filter((hex) => source.toLowerCase().includes(hex)).map(
        (hex) => `${file}: ${hex}`
      )
    );
    expect(offenders).toEqual([]);

    // 목록이 조용히 줄어들지 않았다 — 민트 3색이 이 가드의 존재 이유다.
    expect(TOKENIZED_HEX).toEqual(
      expect.arrayContaining(['#f0fcfa', '#a1e8dd', '#0b6e63'])
    );
  });
});

describe('G-2 · FSD 상태 소유 — 상태는 pages가, 화면은 무상태 (01b Seed §4)', () => {
  it('StayRegisterPage가 상태·라우팅을 지고, StayRegisterScreen은 그 어느 것도 갖지 않는다', () => {
    expect(existsPair(PAGE_FILE)).toEqual({
      file: 'pages/stay-register/ui/StayRegisterPage.tsx',
      exists: true,
    });
    expect(existsPair(SCREEN_FILE)).toEqual({
      file: 'features/stay/ui/StayRegisterScreen.tsx',
      exists: true,
    });

    // 긍정 — 배선이 실제로 상태와 라우팅을 진다(껍데기만 만들고 화면에 다 넣는 것을 막는다).
    const pageSource = readOne(PAGE_FILE);
    expect(pageSource).toContain('useState');
    expect(pageSource).toContain('expo-router');
    expect(pageSource).toContain('StayRegisterScreen');

    // 부정 — 화면은 상태·네트워크·라우팅·타 feature를 전혀 모른다. `features/stay`는
    // eslint의 FEATURES 배열(['onboarding','home']) 밖이라 린트 강제가 없어서 여기서 잡는다.
    const screenSource = readOne(SCREEN_FILE);
    const offenders = FORBIDDEN_IN_SCREEN.filter((needle) =>
      screenSource.includes(needle)
    );
    expect(offenders).toEqual([]);

    // 짝 — 화면이 껍데기가 아니라 실제로 이 화면을 그린다.
    expect(screenSource).toMatch(/export function StayRegisterScreen\b/);
  });
});

describe('G-3 · 라우트는 얇은 래퍼다 (브리프 AC-S3)', () => {
  it('register.tsx가 배럴만 참조하고 훅·마크업을 직접 만지지 않으며, 배럴이 페이지를 재수출한다', () => {
    expect(existsPair(ROUTE_FILE)).toEqual({
      file: 'app/stays/register.tsx',
      exists: true,
    });
    expect(existsPair(BARREL_FILE)).toEqual({
      file: 'pages/stay-register/index.ts',
      exists: true,
    });

    const routeSource = readOne(ROUTE_FILE);
    // 긍정 — 새 pages 슬라이스를 배럴로 참조한다(app/stays/index.tsx 선례와 같은 형태).
    expect(routeSource).toContain('@/pages/stay-register');
    // 부정 — 라우트에 로직이 새지 않는다.
    expect(routeSource).not.toContain('useState');
    expect(routeSource).not.toContain('useGetStaysGeocode');
    expect(routeSource).not.toContain('FlatList');

    // 배럴이 빈 스텁이 아니라 실제로 페이지를 재수출한다.
    expect(readOne(BARREL_FILE)).toMatch(/StayRegisterPage/);
  });
});

describe('G-4 · INV-3 — 등록 표면에 duration 식별자가 0건 (브리프 AC-S1)', () => {
  it('features/stay·pages/stay-register·app/stays 전체에 duration이 없고, 탐지기가 실제로 작동한다', () => {
    const sources = readAll(
      DURATION_SCAN_DIRS.flatMap((dir) => listSourceFiles(dir))
    );

    // 앵커 — 이 칸이 만든 파일 3개가 실제로 스캔됐다. 기존 가드는 pages/stay-register를
    // 모집단에 넣지 않아 그 디렉토리가 통째로 사각지대였다(이 it의 존재 이유).
    const files = sources.map((s) => s.file);
    expect(files).toContain('features/stay/model/stayDates.ts');
    expect(files).toContain('features/stay/ui/StayRegisterScreen.tsx');
    expect(files).toContain('pages/stay-register/ui/StayRegisterPage.tsx');

    // 게이트①-2 수정(2026-08-01): `/\bduration\b/i`였으나 `\b`가 단어 문자 전이를 요구해
    // `stayDuration` 같은 **합성 식별자를 못 잡았다** — 아래 자가검사가 그 사실을 드러냈고
    // (기대 true ↔ 실제 false, 검증 n=1 F-2), 이는 테스트 버그가 아니라 INV-3 가드의
    // 실제 커버리지 구멍이었다. 경계를 떼면 두 자가검사가 동시에 통과하며 구멍이 닫힌다
    // (`durable`은 `duration`을 부분문자열로 갖지 않아 여전히 오탐하지 않는다).
    const DURATION = /duration/i;
    const offenders = sources
      .filter(({ source }) => DURATION.test(source))
      .map(({ file }) => file);
    // 본체 — 박수 계산에 `duration`을 쓰면 여기서 걸린다. 이름은 `nights`다.
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 경계(\b)가 살아 있어 이웃 단어는 오탐하지 않는다.
    expect(DURATION.test('const stayDuration = 1')).toBe(true);
    expect(DURATION.test('const durable = 1')).toBe(false);
  });
});

describe('G-5 · 지도를 재구현하지 않는다 (브리프 AC-S4 · 01b Seed §3-3)', () => {
  it('@/shared/map 배럴을 경유하고, WebView·카카오 SDK 지문을 직접 갖지 않는다', () => {
    const sources = readAll(
      TOKEN_SCAN_DIRS.flatMap((dir) => listSourceFiles(dir))
    );

    // 앵커 — 모집단이 채워졌고, 지도를 실제로 배럴에서 가져온다(TRIP-197 산출물 재사용).
    expect(sources.length).toBeGreaterThan(0);
    const viaBarrel = sources
      .filter(({ source }) => source.includes('@/shared/map'))
      .map(({ file }) => file);
    expect(viaBarrel.length).toBeGreaterThan(0);

    // 본체 — 지도 브리지를 여기서 다시 조립하지 않는다(후보 N핀 확장도 이번 범위 밖, Seed §3-3).
    const FINGERPRINTS = [
      /react-native-webview/,
      /dapi\.kakao\.com/,
      /sdk\.js/,
    ];
    const offenders = sources
      .filter(({ source }) => FINGERPRINTS.some((re) => re.test(source)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 합성 위반을 실제로 잡는다. G-0과 짝을 이뤄야 의미가 있다:
    // 순진한 stripComments라면 아래 문자열이 스캔 전에 잘려 이 단언이 0을 돌려준다.
    const detect = (source: string) =>
      FINGERPRINTS.filter((re) => re.test(stripComments(source))).length;
    expect(
      detect("const sdk = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=X';")
    ).toBe(2);
    expect(detect("import { WebView } from 'react-native-webview';")).toBe(1);
    expect(detect("import { KakaoMapView } from '@/shared/map';")).toBe(0);
  });
});

describe('G-6 · testID 계약이 실재한다 (티켓 §6 · 02a §5)', () => {
  it('확정한 testID가 등록 표면 소스에 전부 있고, 티켓이 이름까지 정한 5종이 그 안에 있다', () => {
    const combined = readAll(
      TOKEN_SCAN_DIRS.flatMap((dir) => listSourceFiles(dir))
    )
      .map(({ source }) => source)
      .join('\n');

    // 앵커 — 스캔 대상이 비어 있지 않다.
    expect(combined.length).toBeGreaterThan(0);

    const missing = REQUIRED_TEST_IDS.filter((id) => !combined.includes(id));
    expect(missing).toEqual([]);

    // 목록이 조용히 줄어드는 것을 막는다 — 티켓이 못박은 5종은 협상 대상이 아니다.
    expect(REQUIRED_TEST_IDS).toEqual(
      expect.arrayContaining(TICKET_FIXED_TEST_IDS)
    );
  });
});

describe('G-7 · e02에서 e05로 가는 문이 실제로 배선됐다 (01b Seed §3-6)', () => {
  it('StaySearchPage가 등록 라우트로 보내고, 화면은 라우트를 모른다', () => {
    const pageSource = readOne(SEARCH_PAGE_FILE);
    // 긍정 — 배선 층이 목적지를 알고 실제로 이동시킨다.
    // 게이트①-2 수정(2026-08-01): `toContain('useRouter')`였으나 동결
    // `StaySearchPage.integration.test.tsx:34-36`의 목이 `useLocalSearchParams`만 제공해
    // `useRouter()` 호출 즉시 동결 2스위트 7건이 크래시한다(검증 n=1 F-3 실측). 구현이
    // 정적 `router` 싱글턴을 택해 무회귀를 지켰으므로 단언을 그 형태로 맞춘다. 이 절이
    // 지키려는 것은 "배선 층이 목적지를 안다"이지 훅 형태가 아니다.
    // `'router'`가 아니라 `'router.push'`인 이유: 전자는 `from 'expo-router'` import
    // 문자열만으로도 통과해 실제 이동 배선을 잠그지 못한다.
    expect(pageSource).toContain('/stays/register');
    expect(pageSource).toContain('router.push');
    expect(pageSource).toContain('onPressRegister');

    // 부정(짝) — 화면은 여전히 라우팅을 모른다. 기존 FSD 경계가 유지된다.
    const screenSource = readOne(SEARCH_SCREEN_FILE);
    expect(screenSource).not.toContain('/stays/register');
    expect(screenSource).not.toContain('expo-router');
    // 짝 — 그러면서도 콜백 prop은 받는다(스텁이 실배선으로 바뀐 증거).
    expect(screenSource).toContain('onPressRegister');
  });
});

/**
 * 게이트①-3 추가(2026-08-01) — **실기 스모크가 잡은 결함의 재발 방지**.
 *
 * 등록 화면은 몰입 화면(AC-11, 하단 탭바 없음)이라 상단 안전영역을 스스로 져야 하는데
 * 루트가 맨 `View`였다. 그래서 제목 「숙소 등록」이 상태바 시계와 겹쳐 글자가 뭉개졌다
 * (시뮬레이터 실측, 이 파일의 G-0~G-8과 렌더 테스트 550건 전부 green인 채로 통과했다).
 *
 * **같은 결함의 재발이다** — TRIP-181이 e02에서 내보냈고 TRIP-182가 `SafeAreaView`로
 * 고치며 `staySearchStructure.test.ts`에 가드를 붙였는데, 새 화면을 만들 때 그 가드가
 * 따라오지 않았다. 이 describe가 그 복제본이다.
 */
describe('G-9 · SafeArea — 몰입 화면이 상단 안전영역을 진다 (브리프 AC-11)', () => {
  it('StayRegisterScreen.tsx 루트가 SafeAreaView이고 edges에 top이 있으며, stay-register-root가 유지된다', () => {
    const source = readOne(SCREEN_FILE);

    // 긍정 — 안전영역 컨테이너가 실재한다.
    expect(source).toContain('react-native-safe-area-context');
    expect(source).toContain('SafeAreaView');
    expect(source).toMatch(/edges=\{\[[^\]]*'top'/);

    // 짝 — 그러면서 기존 testID 계약(G-6 모집단)이 살아 있다. 루트를 갈아끼우며
    // testID가 딸려 나가면 이 파일의 다른 가드와 렌더 테스트가 통째로 무너진다.
    expect(source).toContain('stay-register-root');

    // 잠그지 않는 것 — 실제 겹침은 기기의 물리적 형상값이라 렌더 트리에 없다.
    // jest가 잴 수 있는 것은 "쓰긴 했나"까지고, 겹침 여부는 실기 스모크 소관이다
    // (`staySearchStructure.test.ts` AC-13 가드의 같은 주석과 동일한 사정거리).
  });
});

describe('G-8 · zod + useState 규약, 새 의존성 0 (01b Seed §3-5 · §7)', () => {
  it('폼 모델이 zod를 쓰고, RHF·zustand·새 라이브러리가 등록 표면과 package.json에 없다', () => {
    // 긍정 — 폼 검증의 정본이 zod 스키마다(티켓 "Zod 폼 검증(UX 사본)").
    expect(existsPair(FORM_FILE)).toEqual({
      file: 'features/stay/model/stayRegisterForm.ts',
      exists: true,
    });
    expect(readOne(FORM_FILE)).toMatch(/from\s+['"]zod['"]/);

    // 부정 — react-hook-form은 설치돼 있으나 사용 파일이 0이라 선례가 없고, 필드 5개 중
    // 3개가 입력창이 아니라 이점이 작다(Seed §3-5). 이 칸이 첫 소비자가 되지 않는다.
    const registerSurface = readAll([
      ...DURATION_SCAN_DIRS.flatMap((dir) => listSourceFiles(dir)),
    ]);
    const offenders = registerSurface.flatMap(({ file, source }) =>
      ['react-hook-form', '@hookform/resolvers', 'zustand']
        .filter((needle) => source.includes(needle))
        .map((needle) => `${file}: ${needle}`)
    );
    expect(offenders).toEqual([]);

    // 새 의존성 0 — 달력 라이브러리·resolvers를 설치하지 않는다.
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8')
    );
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    // 앵커 — package.json을 실제로 읽었고, 이미 있는 것은 그대로다.
    expect(allDeps.zod).toBeDefined();
    expect(allDeps['@gorhom/bottom-sheet']).toBeDefined();

    expect(allDeps['@hookform/resolvers']).toBeUndefined();
    expect(allDeps['react-native-calendars']).toBeUndefined();
    expect(allDeps['@react-native-community/datetimepicker']).toBeUndefined();
  });
});
