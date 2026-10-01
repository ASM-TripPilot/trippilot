/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * G-0~G-2 (AC-10 · 02a §4-G) — WebView 지도 브리지 잔재 제거 소스 스캔(TRIP-866 S4).
 *
 * 무엇을 보장하나(초심자용): 핀 지정이 옛 `onMapMessage(PIN_DROP/GEOCODE_OK/GEOCODE_FAIL)` +
 * `coord2Address` 브리지에서 `CenterPinPicker.onPick` + `useGetStaysReverseGeocode` 단일 경로로
 * 넘어갔다. 이 파일은 그 옛 브리지 지문이 소비 표면(등록·위치)에서 **완전히 사라졌는지**를
 * 소스 텍스트로 잠근다 — 렌더로는 "안 쓰는 코드"가 안 보이므로 소스 스캔만 잡을 수 있다.
 *
 * 왜 소스 스캔인가: 이 지문들은 조건부로만 도는 핸들러·import 라 렌더 트리에 항상 나오지 않는다.
 * "어떤 경로로도 없어야 한다"는 소스 층이라야 증명된다.
 *
 * 범위: 소비 표면 세 곳(features/stay · pages/stay-register · pages/live-location)만 본다.
 * `src/shared/map`(kakaoCompat 별칭 shim)에는 `PIN_DROP` 등 유니온 타입이 S5 삭제까지 정당하게
 * 남으므로 스캔에서 제외한다(범위에 넣으면 거짓 red).
 *
 * ★ 전처리×탐지기 조합 자가검사(G-0): 소스를 `stripComments` 로 가공한 뒤 금칙어를 훑는다 —
 *   각 조각이 개별로 옳아도 전처리가 대상을 먼저 지우면 탐지기가 눈이 먼다(리포 실측 2건, URL 의
 *   `//` 오인). 그래서 (a) 주석 속 금칙어는 걷히고 (b) 코드 속 금칙어는 살아남고 (c) URL 은 보존됨을
 *   실제 문자열로 확인한다.
 *
 * 가짜 통과 방지: 모든 "없어야 한다"는 "있어야 한다" 긍정 앵커(신 경로가 실제로 배선됨)와 짝을 이룬다.
 */

const ROOT = path.resolve('src');

/** 옛 WebView 브리지 지문 — 소비 표면에서 0건이어야 한다. */
const FORBIDDEN = ['PIN_DROP', 'GEOCODE_OK', 'GEOCODE_FAIL', 'coord2Address'];

const SCAN_DIRS = [
  path.join(ROOT, 'features', 'stay'),
  path.join(ROOT, 'pages', 'stay-register'),
  path.join(ROOT, 'pages', 'live-location'),
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
const LIVE_FILE = path.join(
  ROOT,
  'pages',
  'live-location',
  'ui',
  'LiveLocationPage.tsx'
);
// TRIP-979 B — 위치 입력 화면이 컨테이너(LiveLocationPage)와 순수 뷰(LiveLocationView)로 갈라졌다.
// 지도(CenterPinPicker)는 뷰가 그린다.
const LIVE_VIEW_FILE = path.join(
  ROOT,
  'pages',
  'live-location',
  'ui',
  'LiveLocationView.tsx'
);

/** 주석 제거. `(^|[^:])` 로 `https://` 의 `//` 를 주석으로 오인하지 않는다(URL 이 스캔 전에
 * 사라지면 탐지기가 조용히 눈이 먼다 — 리포 실측, itineraryMapSurfaceStructure 선례). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

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

function readOne(file: string): string {
  if (!fs.existsSync(file)) return '';
  return stripComments(fs.readFileSync(file, 'utf8'));
}

describe('G-0 · stripComments 자가검사 (선제 green — 탐지기가 눈멀지 않았다)', () => {
  it('주석 속 금칙어는 지우고, 코드 속 금칙어와 URL 은 살린다', () => {
    // (a) 주석 속 금칙어는 걷힌다 — 걷지 않으면 주석 산문이 부정 단언을 거짓 만족시킨다.
    expect(
      stripComments('// PIN_DROP 은 여기서 안 쓴다\nconst a = 1;')
    ).not.toContain('PIN_DROP');

    // (b) 코드 속 금칙어는 살아남는다 — 이게 없으면 옛 브리지가 남아도 red 가 안 난다.
    const withCode = "if (message.type === 'PIN_DROP') {}";
    expect(stripComments(withCode)).toContain('PIN_DROP');

    // (c) ★ URL 은 보존된다 — 순진한 `//.*` 제거는 `https:` 뒤를 잘라 URL 위반을 조용히 놓친다.
    const withUrl = "const u = 'https://dapi.kakao.com/x'; const b = 2;";
    expect(stripComments(withUrl)).toContain('dapi.kakao.com');
    expect(stripComments(withUrl)).toContain('const b = 2;');
  });
});

describe('G-1 · 옛 WebView 브리지 지문이 소비 표면에서 0건이다 (AC-10)', () => {
  it('features/stay · pages/stay-register · pages/live-location 코드에 PIN_DROP·GEOCODE_*·coord2Address 가 없다', () => {
    const sources = readAll(SCAN_DIRS.flatMap((dir) => listSourceFiles(dir)));

    // 앵커 — 모집단에 이번에 바꾸는 세 표면이 실제로 들어 있다(공집합 공허 통과 차단).
    const files = sources.map((s) => s.file);
    expect(files).toContain('features/stay/ui/StayRegisterScreen.tsx');
    expect(files).toContain('pages/stay-register/ui/StayRegisterPage.tsx');
    expect(files).toContain('pages/live-location/ui/LiveLocationPage.tsx');
    expect(files).toContain('pages/live-location/ui/LiveLocationView.tsx');

    const offenders = sources.flatMap(({ file, source }) =>
      FORBIDDEN.filter((token) => source.includes(token)).map(
        (token) => `${file}: ${token}`
      )
    );
    expect(offenders).toEqual([]);
  });

  it('StayRegisterScreen 은 onMapMessage·KakaoMapMessage 를 더는 물지 않는다 (별칭 소비처 소멸)', () => {
    const screen = readOne(SCREEN_FILE);

    // 이 두 지문이 사라져야 S5 가 KakaoMapView 별칭·KakaoMapMessage 를 삭제할 수 있다.
    expect(screen).not.toContain('onMapMessage');
    expect(screen).not.toContain('KakaoMapMessage');
    // 페이지도 KakaoMapMessage import 를 걷는다(handlePinMessage 제거의 짝).
    expect(readOne(PAGE_FILE)).not.toContain('KakaoMapMessage');
  });
});

describe('G-2 · 신 단일 경로가 실제로 배선됐다 (긍정 짝 — 공허 통과 차단)', () => {
  it('화면은 CenterPinPicker 를, 페이지는 useGetStaysReverseGeocode 를 쓴다 (등록 표면)', () => {
    expect(readOne(SCREEN_FILE)).toContain('CenterPinPicker');
    // 주소는 화면이 아니라 페이지가 훅으로 얻는다 — 단일 경로의 정본 위치.
    expect(readOne(PAGE_FILE)).toContain('useGetStaysReverseGeocode');
  });

  it('LiveLocation 은 CenterPinPicker 를 쓰되 역지오코딩은 안 쓴다 (좌표만 · AC-9)', () => {
    // 지도는 뷰가 그린다(TRIP-979 B 컨테이너/뷰 분리).
    expect(readOne(LIVE_VIEW_FILE)).toContain('CenterPinPicker');
    // 위치 화면은 주소를 안 쓴다 — 뷰·컨테이너 어느 쪽에도 역지오코딩이 새 들어오면 안 된다.
    expect(readOne(LIVE_VIEW_FILE)).not.toContain('useGetStaysReverseGeocode');
    expect(readOne(LIVE_FILE)).not.toContain('useGetStaysReverseGeocode');
  });
});
