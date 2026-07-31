/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * A-1 · A-2(소스 절반) · A-3 · A-4 · A-5 · A-9(소스 절반) (01b Seed) — 지도 브리지 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 렌더 층(`KakaoMapView.test.tsx`)은 "이번 렌더에서 실제로 나온 출력"만
 * 본다. 여기는 조건부로만 실행되는 코드·아예 렌더되지 않는 import·git 추적 파일 전수까지
 * 본다(`[[가드의 사정거리]]` 실측 6 — 두 층은 사정거리가 다르다, 02a §5-5).
 *
 * 전제 — 모든 소스 스캔 it은 주석을 걷어낸 소스를 스캔한다(`stripComments`,
 * `staySearchStructure.test.ts`·`noMswInStaticGraph.test.ts`의 것과 동형 — 공용화하지 않고
 * 파일마다 각자 갖는 것이 리포 관례다). 걷어내지 않으면 주석 속 문자열이 긍정·부정 단언을
 * 대신 만족시키는 거짓 통과를 낸다 — 이번 칸은 **양방향** 모두를 겪는다: 부정 단언은 알려진
 * 함정 1(`tabbarVisual` 2사이클 실측)과 같지만, 긍정 단언(env 참조 존재)은 주석이 거짓
 * *만족*시키는 반대 방향이라 `stripComments` 자체를 검증하는 단언을 별도로 둔다(1-2).
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 도달 앵커와
 * 같은 it 안에서 짝을 이루고, "정확히 N곳" 류 단언은 탐지기 자가검사(합성 위반을 실제로
 * 잡는지)를 더해 정규식 자체의 고장까지 잡는다(선례 `noMswInStaticGraph.test.ts`).
 */

const ROOT = path.resolve('src');
const MAP_DIR = path.join(ROOT, 'shared', 'map');
const TEST_ONLY_DIRS = ['__tests__', '__mocks__', 'test-support', 'mocks'];

/** 32-hex 키 형태 리터럴 — 경계(`\b`) 덕분에 40자 SHA·31자 문자열은 매치되지 않는다
 * (경계 안쪽에 word-char 전환이 없어 고정 길이 32 매치가 성립하지 않는다, 02a M10 실측). */
const HEX32_LITERAL = /\b[0-9a-f]{32}\b/i;

/** D5/R1 양쪽을 포용하는 도메인 리터럴 — 값을 문자열로 못박으면 R1 폴백 시 이 테스트를
 * 고쳐야 한다(02a §5-20). `g` 없이 `match()`를 쓰면 global 상태 없이 등장 횟수를 셀 수 있다. */
const DOMAIN_LITERAL = /https?:\/\/localhost(?::\d+)?/g;

/** 주석 제거. `(?<!:)`(직전 문자가 `:`가 아닐 때만 매치) 없이는 `https://`의 `//`를 주석으로
 * 오인해 줄 나머지를 날린다 — A-9의 도메인 리터럴이 스캔 전에 사라져 어떤 구현으로도 통과할
 * 수 없고, A-4의 `/v2/local/` 위반은 URL로 적히는 순간 스캔에서 조용히 사라진다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*/g, '');
}

/** 디렉토리가 없으면 빈 배열 — 구현 전에는 src/shared/map이 아직 없다. 방어 없이
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

/** `src/shared/map/**` 모집단 — 지도 브리지 소스 전체(테스트 파일 제외). */
function mapSources() {
  return readAll(listSourceFiles(MAP_DIR));
}

/** `src/**` 프로덕션 파일 전체 — 테스트 파일도, 테스트 전용 디렉토리도 아닌 것
 * (선례 `noMswInStaticGraph.test.ts`의 `listProductionFiles`와 동형 모집단, 이 칸은 주석까지
 * 걷어낸다는 점만 다르다 — A-4가 주석 속 지문까지 걸러야 하는 것은 아니지만, 소스 스캔
 * 전부가 같은 전처리를 거치는 편이 함정 1의 재발을 구조적으로 막는다). */
function productionSources() {
  return readAll(
    listSourceFiles(ROOT).filter((full) => {
      const segments = path.relative(ROOT, full).split(path.sep);
      return !segments.some((segment) => TEST_ONLY_DIRS.includes(segment));
    })
  );
}

describe('A-1 — react-native-webview 의존이 Expo SDK 고정판과 정합한다', () => {
  it('package.json의 react-native-webview 버전이 expo/bundledNativeModules.json과 같은 문자열이고, devDependencies에는 없다', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8')
    );
    const bundled = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/expo/bundledNativeModules.json'),
        'utf8'
      )
    );

    // 도달 앵커 — 비교 기준 맵이 실제로 로드됐다.
    expect(Object.keys(bundled).length).toBeGreaterThan(20);
    // 맵에 그 키가 실재한다(오타 방지).
    expect(bundled['react-native-webview']).toEqual(
      expect.stringMatching(/^\d+\.\d+\.\d+$/)
    );

    // 본체 — package.json이 맵과 같은 문자열이다. '13.15.0'을 못박지 않는다 — Expo SDK를
    // 올리면 맵의 값도 같이 바뀌므로, 맵 기준 비교라야 SDK 범프가 이 테스트를 거짓 red로
    // 만들지 않는다(02a M11 실측 — 겹치는 27개 의존이 27/27 문자열 완전일치).
    expect(pkg.dependencies?.['react-native-webview']).toBe(
      bundled['react-native-webview']
    );
    // 네이티브 모듈이 devDependencies로 잘못 들어가지 않았다.
    expect(pkg.devDependencies?.['react-native-webview']).toBeUndefined();
  });
});

describe('A-2 (소스 절반) — 키는 env 참조로만 들어오고 리터럴은 없다', () => {
  it('env 참조가 정확히 한 곳이고, 32-hex 키 형태 리터럴이 0건이며, stripComments가 실제로 걷어낸다', () => {
    const sources = mapSources();

    // 도달 앵커 — 디렉토리가 실재하고, 지도 컴포넌트가 모집단에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain('shared/map/KakaoMapView.tsx');

    const envReaders = sources
      .filter((s) =>
        s.source.includes('process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY')
      )
      .map((s) => s.file);
    // 본체 긍정 — env를 읽는 자리가 정확히 한 곳이다(D6 정신). 길이 1을 잠그면서 실패 시
    // diff에 실제 목록이 찍힌다. 파일명 자체는 못박지 않는다(구현 자유).
    expect(envReaders).toEqual([expect.stringMatching(/\.tsx?$/)]);

    // 본체 부정 — 키 형태 리터럴 0건.
    const offenders = sources
      .filter((s) => HEX32_LITERAL.test(s.source))
      .map((s) => s.file);
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 합성 위반을 실제로 잡고, 40자 SHA·31자 문자열은 잡지 않는다.
    expect(
      HEX32_LITERAL.test("const k = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';")
    ).toBe(true);
    expect(
      HEX32_LITERAL.test(
        "const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6ff112233';"
      )
    ).toBe(false);
    expect(
      HEX32_LITERAL.test("const short = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d';")
    ).toBe(false);

    // stripComments 자기검증 — 이번 칸의 반대 방향 함정(주석이 긍정 단언 c를 거짓 만족시킨다,
    // 02a §5-1)을 기계로 잠근다. 걷어내지 않으면 이 문자열이 살아남는다.
    expect(
      stripComments('// process.env.EXPO_PUBLIC_KAKAO_MAP_JS_KEY\nconst a = 1;')
    ).not.toContain('EXPO_PUBLIC_KAKAO_MAP_JS_KEY');
    // 반대 방향 — URL 속 `//`는 살아남는다. 이 단언이 없으면 `(?<!:)`를 지웠을 때
    // A-9만 red를 내고 A-4는 다시 눈이 먼다(게이트①-2 결함 ②의 재발 경로).
    expect(stripComments("const d = 'https://localhost';")).toContain(
      'localhost'
    );
  });
});

describe('A-3 — git 추적 파일 전수에 키 리터럴이 0건이다', () => {
  it('git ls-files -z 기준 추적 파일에 32-hex 키 형태 리터럴이 없고, .env.example은 이름만 있고 값은 비어 있다', () => {
    const raw = execFileSync('git', ['ls-files', '-z'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const files = raw.split('\0').filter((f) => f.length > 0);

    // 도달 앵커 — cwd가 frontend다.
    expect(files).toContain('package.json');
    // ★★ -z를 뺀 형태로 퇴화하지 않았다 — 한글 경로가 `"..."`로 인용되면 readFileSync가
    // ENOENT를 내고, try/catch로 넘기면 그 파일이 스캔에서 조용히 사라진다(02a M9 실측).
    expect(files.filter((f) => f.includes('"'))).toEqual([]);

    const EXCLUDED = ['pnpm-lock.yaml'];
    // 제외목록이 실제로 목록에 있었다(허공 제외 금지).
    expect(files).toContain('pnpm-lock.yaml');
    // 제외목록이 조용히 넓어지지 않았다 — 늘리려면 이 단언도 함께 고쳐야 게이트에 보인다.
    expect(EXCLUDED).toEqual(['pnpm-lock.yaml']);

    const TEXT_EXTENSION = /\.(ts|tsx|js|jsx|json|md|yml|yaml|cjs|mjs)$/;
    const scanned = files.filter(
      (f) => TEXT_EXTENSION.test(f) && !EXCLUDED.includes(f)
    );
    // 도달 앵커 — 스캔량.
    expect(scanned.length).toBeGreaterThan(200);

    const offenders = scanned.filter((f) =>
      HEX32_LITERAL.test(fs.readFileSync(f, 'utf8'))
    );
    // 본체.
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 1-2와 같은 합성 3종.
    expect(
      HEX32_LITERAL.test("const k = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';")
    ).toBe(true);
    expect(
      HEX32_LITERAL.test('40-char: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6ff112233')
    ).toBe(false);
    expect(HEX32_LITERAL.test('31-char: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d')).toBe(
      false
    );

    // U1(오케 확정, 02a §7) — .env.example의 심판이 §3 층 A에 배정돼 있지 않아, 이미 이
    // git 추적 스캔이 훑은 목록에 동반 단언으로 붙인다(추가 파일 0). 지금은 파일 자체가
    // 없어 이 단언 때문에 케이스 전체가 선제 green에서 red로 바뀐다(02a §4 갱신).
    expect(files).toContain('.env.example');
    const envExampleContent = fs.readFileSync('.env.example', 'utf8');
    const keyAssignmentLines = envExampleContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('EXPO_PUBLIC_KAKAO_MAP_JS_KEY='));
    // 이름이 정확히 1줄 있고, `=` 뒤에 키 형태 문자열이 없다(값 비어 있음).
    expect(keyAssignmentLines).toEqual([
      expect.stringMatching(/^EXPO_PUBLIC_KAKAO_MAP_JS_KEY=\s*$/),
    ]);
  });
});

describe('A-4 — 프로덕션 소스가 카카오 로컬 검색을 직접 부르지 않는다', () => {
  it('로컬 검색 지문(/v2/local/ · KakaoAK)이 0건이고, 도메인 기반 탐지기로 퇴화하지 않았다', () => {
    const sources = productionSources();

    // 도달 앵커 — 모집단이 채워졌고, 지도 파일이 그 안에 있다. 이 앵커가 있어야
    // "지도가 로컬 검색을 안 부른다"가 의미를 갖는다 — 본체 자체는 지금도 참이라(M12),
    // 이 케이스를 red로 만드는 것은 앵커 쪽이다(02a §4).
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map((s) => s.file)).toContain('shared/map/KakaoMapView.tsx');

    const FINGERPRINTS = [/\/v2\/local\//, /KakaoAK/];
    const offenders = sources
      .filter((s) => FINGERPRINTS.some((re) => re.test(s.source)))
      .map((s) => s.file);
    // 본체 — 지금도 0건이다.
    expect(offenders).toEqual([]);

    // ★★ 반증 단언 — 금지(로컬 검색)와 허용(지도 SDK)이 dapi.kakao.com을 공유한다(02a §5-4).
    // 도메인만으로 잡는 탐지기는 지도 SDK 스크립트 자신을 오탐해 A-4를 영구 red로 만든다.
    const detect = (source: string) =>
      FINGERPRINTS.filter((re) => re.test(source)).length;
    expect(
      detect("const sdk = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=X';")
    ).toBe(0);
    expect(
      detect(
        "const local = 'https://dapi.kakao.com/v2/local/search/keyword.json'; const auth = 'Authorization: KakaoAK X';"
      )
    ).toBe(2);
  });
});

describe('A-5 — INV-3: src/shared/map/** 에 duration 식별자가 0건이다', () => {
  it('duration 식별자가 없고, \\b 경계 덕분에 durable 같은 이웃 단어는 잡히지 않는다', () => {
    const sources = mapSources();

    // 도달 앵커
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain('shared/map/KakaoMapView.tsx');

    const DURATION = /\bduration\b/i;
    const offenders = sources
      .filter((s) => DURATION.test(s.source))
      .map((s) => s.file);
    // 본체 — INV-3.
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 경계(\b) 확인.
    expect(DURATION.test('const duration = 1')).toBe(true);
    expect(DURATION.test('const durable = 1')).toBe(false);
  });
});

describe('A-9 (소스 절반) — 도메인 문자열이 상수 한 곳에만 있다', () => {
  it('도메인 리터럴이 등장하는 파일이 정확히 1개이고, 그 파일 안에서도 1회뿐이며, SDK 조립 파일이 모집단에 있다', () => {
    const sources = mapSources();

    // 도달 앵커
    expect(sources.length).toBeGreaterThan(0);

    const withDomainLiteral = sources.filter(
      (s) => (s.source.match(DOMAIN_LITERAL) ?? []).length > 0
    );
    // 본체 — 리터럴이 등장하는 파일이 정확히 1개(파일명은 못박지 않는다).
    expect(withDomainLiteral.map((s) => s.file)).toEqual([
      expect.stringMatching(/\.tsx?$/),
    ]);
    // 본체 — 그 파일 안에서도 1회만(값 자체를 못박지 않는다 — D5의 https://localhost와
    // R1 폴백의 http://localhost:8081을 양쪽 다 포용해야 폴백 전환이 이 테스트를 안 건드린다).
    // 위 단언이 통과해야(파일 정확히 1개) 여기가 undefined 접근 없이 의미를 갖는다.
    expect(
      (withDomainLiteral[0].source.match(DOMAIN_LITERAL) ?? []).length
    ).toBe(1);
    // 도달 앵커 — SDK 스크립트를 조립하는 파일이 모집단에 있다.
    expect(sources.some((s) => s.source.includes('sdk.js'))).toBe(true);
  });
});

describe('1-7(선택 · D10 이행 확인) — shared/map이 features/*를 import하지 않는다', () => {
  it('@/features/ 문자열이 0건이다 — Coords 승격을 이번에 하지 않는다는 결정(D10)의 기계 강제', () => {
    const sources = mapSources();

    // 도달 앵커
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain('shared/map/KakaoMapView.tsx');

    const offenders = sources
      .filter((s) => s.source.includes('@/features/'))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
