/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * A-1 · A-2(소스 절반) · A-3 · A-4 · A-5 · 1-7 (TRIP-864 재조준) — 지도 브리지 소스 스캔 가드.
 *
 * 왜 소스 스캔인가 — 렌더 층은 "이번 렌더에서 실제로 나온 출력"만 본다. 여기는 조건부로만
 * 실행되는 코드·아예 렌더되지 않는 import·git 추적 파일 전수까지 본다(두 층은 사정거리가 다르다).
 *
 * ── TRIP-864 지도 공급자 전환(카카오 WebView → 네이버 네이티브) 반영 ──────────────
 *  - A-1: webview↔expo bundledNativeModules 문자열 정합 → **네이버 SDK 정확 핀 검사**
 *    (네이티브 모듈은 bundledNativeModules 명부에 없어 대조 불가 — 정확 핀 자체를 계약으로).
 *  - A-2: env 이름 `EXPO_PUBLIC_KAKAO_MAP_JS_KEY` → `EXPO_PUBLIC_NAVER_MAP_CLIENT_ID`
 *    (참조는 shared/map 안 정확히 1곳 = MapView.tsx). 앵커 파일 KakaoMapView.tsx → MapView.tsx.
 *  - A-4: "카카오 로컬 검색 지문 0" → **"공급자 SDK 직접 import 는 shared/map 밖에서 0건"**
 *    (네이티브 SDK 를 소비처가 직접 물면 공급자 중립 경계가 무너진다).
 *  - A-9(REGISTERED_DOMAIN 도메인 리터럴) **삭제** — 네이티브 SDK 는 client_id 로 인증하고
 *    URL 등록 명부·도메인 개념이 없어 심판 대상이 소멸했다.
 *
 * 전제 — 모든 소스 스캔 it 은 주석을 걷어낸 소스를 스캔한다(`stripComments`). 걷어내지 않으면
 * 주석 속 문자열이 긍정·부정 단언을 대신 만족시키는 거짓 통과를 낸다 — 이번 칸은 **양방향**
 * 모두를 겪는다: 부정 단언은 알려진 함정 1과 같지만, 긍정 단언(env 참조 존재)은 주석이 거짓
 * *만족*시키는 반대 방향이라 `stripComments` 자체를 검증하는 단언을 별도로 둔다(A-2).
 *
 * 가짜 통과 방지 규약(리포 확립 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 도달 앵커와
 * 같은 it 안에서 짝을 이루고, "정확히 N곳" 류 단언은 탐지기 자가검사(합성 위반을 실제로
 * 잡는지)를 더해 정규식 자체의 고장까지 잡는다.
 */

const ROOT = path.resolve('src');
const MAP_DIR = path.join(ROOT, 'shared', 'map');
const TEST_ONLY_DIRS = ['__tests__', '__mocks__', 'test-support', 'mocks'];

/** 지도 코어 파일(카카오 KakaoMapView.tsx 삭제 후 정본). 도달 앵커가 이 파일을 가리킨다. */
const MAP_CORE_REL = 'shared/map/MapView.tsx';

/** 32-hex 키 형태 리터럴 — 경계(`\b`) 덕분에 40자 SHA·31자 문자열은 매치되지 않는다. */
const HEX32_LITERAL = /\b[0-9a-f]{32}\b/i;

/** 탐지기 자가검사용 합성 키. **소스에 32자 연속 hex 를 리터럴로 남기면 안 된다** — A-3 의
 * 모집단이 `git ls-files`(추적 목록)라, 이 파일이 커밋되는 순간 자기 자신이 위반으로 잡힌다.
 * 16자씩 이어 붙여 런타임 값만 32-hex 가 되게 한다. */
const SYNTHETIC_HEX32 = 'a1b2c3d4e5f6a7b8' + 'c9d0e1f2a3b4c5d6';
/** 40자 — `\b` 가 40자 연속 hex 안에서 32자 매치를 성립시키지 않는다는 것을 확인하는 대조군. */
const SYNTHETIC_HEX40 = SYNTHETIC_HEX32 + 'ff112233';

/** 주석 제거. `(?<!:)`(직전 문자가 `:` 가 아닐 때만 매치) 없이는 `https://` 의 `//` 를 주석으로
 * 오인해 줄 나머지를 날린다 — URL 로 적힌 위반이 스캔에서 조용히 사라진다. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*/g, '');
}

/** 디렉토리가 없으면 빈 배열 — readdirSync 예외로 죽으면 "무엇이 없는가"를 읽을 diff 가 안 남는다. */
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

/** `src/**` 프로덕션 파일 전체 — 테스트 파일도, 테스트 전용 디렉토리도 아닌 것. */
function productionSources() {
  return readAll(
    listSourceFiles(ROOT).filter((full) => {
      const segments = path.relative(ROOT, full).split(path.sep);
      return !segments.some((segment) => TEST_ONLY_DIRS.includes(segment));
    })
  );
}

const EXACT_PIN = /^\d+\.\d+\.\d+$/;
const NAVER_SDK_PKG = '@mj-studio/react-native-naver-map';

describe('A-1 — 네이버 지도 SDK 의존이 정확 버전으로 핀되어 있다', () => {
  it('package.json 의 @mj-studio/react-native-naver-map 이 ^·~ 없는 정확 핀이고, devDependencies 에는 없다', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8')
    );

    const dep = pkg.dependencies?.[NAVER_SDK_PKG];
    // 도달 앵커 — 의존이 dependencies 에 실재한다(오타·누락 방지).
    expect(dep).toBeDefined();

    // 본체 — 정확 버전(예: 2.9.0)이다. `^`·`~` 레인지면 이 매치가 실패한다. 네이티브 모듈은
    // JS 라이브러리와 달리 Expo bundledNativeModules 대조 목록에 없어(카카오 webview 와 다름),
    // 맵 기준 비교 대신 "정확 핀" 자체를 계약으로 잠근다.
    expect(dep).toEqual(expect.stringMatching(EXACT_PIN));
    // 네이티브 모듈이 devDependencies 로 잘못 들어가지 않았다.
    expect(pkg.devDependencies?.[NAVER_SDK_PKG]).toBeUndefined();

    // 탐지기 자가검사 — 정확 핀 판정이 레인지 표기를 실제로 거른다.
    expect(EXACT_PIN.test('2.9.0')).toBe(true);
    expect(EXACT_PIN.test('^2.9.0')).toBe(false);
    expect(EXACT_PIN.test('~2.9.0')).toBe(false);
  });
});

describe('A-2 (소스 절반) — 키는 env 참조로만 들어오고 리터럴은 없다', () => {
  it('env 참조가 정확히 한 곳이고, 32-hex 키 형태 리터럴이 0건이며, stripComments 가 실제로 걷어낸다', () => {
    const sources = mapSources();

    // 도달 앵커 — 디렉토리가 실재하고, 지도 코어가 모집단에 있다.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(MAP_CORE_REL);

    const envReaders = sources
      .filter((s) =>
        s.source.includes('process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID')
      )
      .map((s) => s.file);
    // 본체 긍정 — env 를 읽는 자리가 shared/map 안 정확히 한 곳이다(D6 정신). 길이 1 을 잠그면서
    // 실패 시 diff 에 실제 목록이 찍힌다. 파일명 자체는 못박지 않는다(구현 자유).
    expect(envReaders).toEqual([expect.stringMatching(/\.tsx?$/)]);

    // 본체 부정 — 키 형태 리터럴 0건.
    const offenders = sources
      .filter((s) => HEX32_LITERAL.test(s.source))
      .map((s) => s.file);
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 합성 위반을 실제로 잡고, 40자 SHA·31자 문자열은 잡지 않는다.
    expect(HEX32_LITERAL.test(`const k = '${SYNTHETIC_HEX32}';`)).toBe(true);
    expect(HEX32_LITERAL.test(`const sha = '${SYNTHETIC_HEX40}';`)).toBe(false);
    expect(
      HEX32_LITERAL.test("const short = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d';")
    ).toBe(false);

    // stripComments 자기검증 — 주석이 긍정 단언(env 참조 존재)을 거짓 만족시키는 반대 방향
    // 함정을 기계로 잠근다. 걷어내지 않으면 이 문자열이 살아남는다.
    expect(
      stripComments(
        '// process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID\nconst a = 1;'
      )
    ).not.toContain('EXPO_PUBLIC_NAVER_MAP_CLIENT_ID');
    // 반대 방향 — URL 속 `//` 는 살아남는다(`(?<!:)` 룩비하인드가 지워지면 여기가 red).
    expect(stripComments("const d = 'https://localhost';")).toContain(
      'localhost'
    );
  });
});

describe('A-3 — git 추적 파일 전수에 키 리터럴이 0건이다', () => {
  it('git ls-files -z 기준 추적 파일에 32-hex 키 형태 리터럴이 없고, .env.example 은 지도 키 이름만 있고 값은 비어 있다', () => {
    const raw = execFileSync('git', ['ls-files', '-z'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const files = raw.split('\0').filter((f) => f.length > 0);

    // 도달 앵커 — cwd 가 frontend 다.
    expect(files).toContain('package.json');
    // ★★ -z 를 뺀 형태로 퇴화하지 않았다 — 한글 경로가 `"..."` 로 인용되면 readFileSync 가
    // ENOENT 를 내고, try/catch 로 넘기면 그 파일이 스캔에서 조용히 사라진다.
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

    // 탐지기 자가검사 — A-2 와 같은 합성 3종.
    expect(HEX32_LITERAL.test(`const k = '${SYNTHETIC_HEX32}';`)).toBe(true);
    expect(HEX32_LITERAL.test(`40-char: ${SYNTHETIC_HEX40}`)).toBe(false);
    expect(HEX32_LITERAL.test('31-char: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d')).toBe(
      false
    );

    // 지도 키가 .env.example 에 이름만(값 없음) 선언돼 있다 — TRIP-864 로 KAKAO_MAP_JS_KEY 에서
    // NAVER_MAP_CLIENT_ID 로 지도 키가 바뀌었다(카카오 잔재 줄 정리는 S5 소관, 이 칸 밖).
    expect(files).toContain('.env.example');
    const envExampleContent = fs.readFileSync('.env.example', 'utf8');
    const keyAssignmentLines = envExampleContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('EXPO_PUBLIC_NAVER_MAP_CLIENT_ID='));
    // 이름이 정확히 1줄 있고, `=` 뒤에 키 형태 문자열이 없다(값 비어 있음).
    expect(keyAssignmentLines).toEqual([
      expect.stringMatching(/^EXPO_PUBLIC_NAVER_MAP_CLIENT_ID=\s*$/),
    ]);
  });
});

describe('A-4 — 공급자 지도 SDK 를 shared/map 밖에서 직접 import 하지 않는다', () => {
  it('@mj-studio/react-native-naver-map 직접 import 가 shared/map 밖 프로덕션에 0건이고, shared/map 코어는 문다', () => {
    const sources = productionSources();

    // 도달 앵커 — 모집단이 채워졌고, 지도 코어가 그 안에 있다.
    expect(sources.length).toBeGreaterThan(20);
    expect(sources.map((s) => s.file)).toContain(MAP_CORE_REL);

    const SDK = /@mj-studio\/react-native-naver-map/;
    const importers = sources
      .filter((s) => SDK.test(s.source))
      .map((s) => s.file);

    // 긍정 짝 — shared/map 코어는 공급자 SDK 를 문다(래핑의 유일한 자리). 없으면 아래
    // "밖에서 0건"이 "아무도 안 쓴다"는 미래 상태에서 공허 통과한다.
    expect(importers.some((f) => f.startsWith('shared/map/'))).toBe(true);

    // 본체 — shared/map 밖에서 공급자 SDK 를 직접 물면 위반(공급자 중립 경계 붕괴). 소비처는
    // 배럴 `@/shared/map` 만 알아야 하고 어떤 공급자인지 몰라야 한다.
    const offenders = importers.filter((f) => !f.startsWith('shared/map/'));
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 합성 위반을 실제로 잡고, 무관 문자열은 안 잡는다.
    expect(
      SDK.test(
        "import { NaverMapView } from '@mj-studio/react-native-naver-map';"
      )
    ).toBe(true);
    expect(SDK.test("import { MapView } from '@/shared/map';")).toBe(false);
  });
});

describe('A-5 — INV-3: src/shared/map/** 에 duration 식별자가 0건이다', () => {
  it('duration 식별자가 없고, \\b 경계 덕분에 durable 같은 이웃 단어는 잡히지 않는다', () => {
    const sources = mapSources();

    // 도달 앵커
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(MAP_CORE_REL);

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

describe('1-7(선택 · D10 이행 확인) — shared/map 이 features/*를 import 하지 않는다', () => {
  it('@/features/ 문자열이 0건이다 — Coords 승격을 이번에 하지 않는다는 결정(D10)의 기계 강제', () => {
    const sources = mapSources();

    // 도달 앵커
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.file)).toContain(MAP_CORE_REL);

    const offenders = sources
      .filter((s) => s.source.includes('@/features/'))
      .map((s) => s.file);
    expect(offenders).toEqual([]);
  });
});
