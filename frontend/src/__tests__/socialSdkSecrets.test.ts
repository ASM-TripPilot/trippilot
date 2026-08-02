/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * AC-7 · AC-8′ — 소셜 SDK 키·시크릿이 커밋되지 않게 강제하는 소스 스캔 가드.
 *
 * 무엇을 보장하나:
 *  (1) 실값은 `.env`(미추적)에만 있고 `.env.example` 에는 **이름만** 있다,
 *  (2) git 추적 파일 어디에도 이 변수들의 **값 있는 대입**이 없다,
 *  (3) `app.config.ts` 는 키를 `process.env` 로만 읽는다(리터럴 0건),
 *  (4) 네이버 `consumerSecret` 은 SDK 필수 파라미터라 예외로 허용하되 env 경유만 하고
 *      그 예외 사실이 코드 주석과 README 에 남는다(D5 · AC-8′).
 *
 * ★ 왜 기존 `mapBridgeStructure.test.ts` 의 32-hex 탐지기를 그대로 쓰지 않았나:
 *  - 카카오 네이티브 앱 키는 32-hex 라 그 탐지기가 이미 잡는다 → **중복하지 않는다.**
 *  - 네이버 clientId·secret 은 짧은 영숫자라 **형태로 구별할 수 없다.** 형태 기반으로 넓히면
 *    리포 전체가 오탐이 된다.
 *  - 게다가 그 테스트의 확장자 필터(ts|tsx|js|json|md|…)에는 **`.env` 가 없어서** 실수로
 *    커밋된 `.env` 는 아예 스캔되지 않는다.
 *  → 그래서 여기는 **대입 문맥 기반**(`VAR=<값>`) 탐지기를 **확장자 무관 전 추적 파일**에 건다.
 *
 * 전제 — 소스 스캔은 주석을 걷어낸 뒤 훑는다(`stripComments`, 리포 관례상 파일마다 각자 갖는다).
 * 걷어내지 않으면 주석 속 문자열이 긍정 단언을 거짓 만족시킨다. 반대로 AC-8′ 의 "주석에 명시"는
 * **raw 등장 횟수 > stripped 등장 횟수** 로 판정한다 — 전처리를 검증 도구로 역이용하는 자리다.
 */

const ROOT = path.resolve('src');
const AUTH_LIB_DIR = path.join(ROOT, 'features', 'auth', 'lib');

/** D2 가 확정한 env 변수 4종. 값은 `.env` 에만, 이름은 `.env.example` 에만 있어야 한다. */
const SOCIAL_ENV_VARS = [
  'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY',
  'EXPO_PUBLIC_NAVER_CLIENT_ID',
  'EXPO_PUBLIC_NAVER_CLIENT_SECRET',
  'EXPO_PUBLIC_NAVER_URL_SCHEME',
] as const;

const NAVER_SECRET_VAR = 'EXPO_PUBLIC_NAVER_CLIENT_SECRET';

/** 32-hex 키 형태 리터럴(카카오 네이티브 앱 키 형태). `\b` 덕분에 40자 SHA 는 매치되지 않는다. */
const HEX32_LITERAL = /\b[0-9a-f]{32}\b/i;

/** 탐지기 자가검사용 합성 키 — 소스에 32자 연속 hex 를 리터럴로 남기면 스스로 위반이 된다.
 * 16자씩 이어 붙여 런타임 값만 32-hex 가 되게 한다. */
const SYNTHETIC_HEX32 = 'a1b2c3d4e5f6a7b8' + 'c9d0e1f2a3b4c5d6';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*/g, '');
}

/**
 * `VAR=<비지 않은 값>` 형태의 대입만 잡는다. 코드의 `process.env.VAR` **읽기**는 잡지 않는다.
 *
 * ⚠️ 공백 클래스가 **전부** `[^\S\n]`(개행 아닌 공백)이어야 한다. 한 곳이라도 `\s` 면 개행을
 * 삼켜 **다음 줄의 첫 글자**를 값으로 오인한다 — 게이트①-2 실측: `=` 뒤만 `\s*` 였을 때
 * `.env.example` 의 빈 값 변수 4줄이 연달아 있자 앞 3줄이 위반으로 잡혔다(매치 내용이
 * `"…APP_KEY=\nE"` 였고, 뒤에 아무것도 없는 마지막 줄만 빠져나갔다).
 */
function assignmentPattern(name: string): RegExp {
  return new RegExp(`^[^\\S\\n]*${name}[^\\S\\n]*=[^\\S\\n]*\\S`, 'm');
}

function trackedFiles(): string[] {
  const raw = execFileSync('git', ['ls-files', '-z'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return raw.split('\0').filter((f) => f.length > 0);
}

/** auth/lib 안의 프로덕션 파일(테스트 제외)을 raw·stripped 두 벌로 읽는다. */
function authLibSources(): { file: string; raw: string; stripped: string }[] {
  if (!fs.existsSync(AUTH_LIB_DIR)) return [];
  return fs
    .readdirSync(AUTH_LIB_DIR)
    .filter(
      (name) =>
        (name.endsWith('.ts') || name.endsWith('.tsx')) &&
        !/\.test\.[jt]sx?$/.test(name)
    )
    .map((name) => {
      const raw = fs.readFileSync(path.join(AUTH_LIB_DIR, name), 'utf8');
      return { file: name, raw, stripped: stripComments(raw) };
    });
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

describe('AC-7 · 실값은 .env 에만 있고 .env.example 은 이름만 담는다', () => {
  it('.env·.env.local 이 추적되지 않고, .env.example 에 변수 4종이 값 없이 정확히 한 줄씩 있다', () => {
    const files = trackedFiles();

    // 도달 앵커 — cwd 가 frontend 다.
    expect(files).toContain('package.json');
    // -z 를 뺀 형태로 퇴화하지 않았다(한글 경로가 인용되면 파일이 스캔에서 조용히 사라진다).
    expect(files.filter((f) => f.includes('"'))).toEqual([]);

    // ★ .gitignore 는 **이미 추적 중인 파일을 막지 못한다.** 한 줄로 유출 경로 하나를 닫는다.
    expect(files).not.toContain('.env');
    expect(files).not.toContain('.env.local');

    // .env.example 은 추적돼야 한다(관례를 담는 문서 역할).
    expect(files).toContain('.env.example');

    const lines = fs.readFileSync('.env.example', 'utf8').split('\n');
    for (const name of SOCIAL_ENV_VARS) {
      const assignments = lines
        .map((line) => line.trim())
        .filter((line) => line.startsWith(`${name}=`));
      // 이름이 정확히 1줄 있고, `=` 뒤가 비어 있다.
      expect({ name, assignments }).toEqual({
        name,
        assignments: [expect.stringMatching(new RegExp(`^${name}=\\s*$`))],
      });
    }
  });
});

describe('AC-7 · git 추적 파일 전수에 키 값이 대입돼 있지 않다', () => {
  it('확장자와 무관하게 모든 추적 파일에서 VAR=<값> 형태가 0건이다', () => {
    const files = trackedFiles();

    // 도달 앵커 — 스캔량. 확장자 필터를 두지 않으므로 모집단이 크다.
    expect(files.length).toBeGreaterThan(100);

    // pnpm-lock.yaml 은 해시 덩어리라 제외한다(형태 오탐 방지). 제외목록이 조용히 넓어지지
    // 않도록 목록 자체를 잠근다.
    const EXCLUDED = ['pnpm-lock.yaml'];
    expect(files).toContain('pnpm-lock.yaml');
    expect(EXCLUDED).toEqual(['pnpm-lock.yaml']);

    const offenders: string[] = [];
    for (const file of files) {
      if (EXCLUDED.includes(file)) continue;
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf8');
      } catch {
        continue; // 바이너리·심볼릭 링크 등은 건너뛴다.
      }
      for (const name of SOCIAL_ENV_VARS) {
        if (assignmentPattern(name).test(content)) {
          offenders.push(`${file}:${name}`);
        }
      }
    }
    // 본체.
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 값 있는 대입만 잡고, 빈 값·코드의 env 읽기는 잡지 않는다.
    const kakaoKey = assignmentPattern('EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY');
    expect(kakaoKey.test('EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=abc123')).toBe(true);
    expect(kakaoKey.test('  EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=abc123')).toBe(
      true
    );
    expect(kakaoKey.test('EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=')).toBe(false);
    expect(kakaoKey.test('EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=   ')).toBe(false);
    expect(
      kakaoKey.test('const k = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY;')
    ).toBe(false);

    // ★ 여러 줄 자가검사 — 게이트①-2 결함의 재발 방지. 이전 판은 자가검사 입력이 전부
    // **한 줄짜리**여서, `=` 뒤의 공백 클래스가 개행을 삼키는 결함을 하나도 잡지 못했다.
    // 아래 셋이 그 사각지대를 정확히 겨눈다.
    const naverId = assignmentPattern('EXPO_PUBLIC_NAVER_CLIENT_ID');
    // (a) 빈 값 변수가 연달아 있어도 앞 줄이 다음 줄 첫 글자를 값으로 삼지 않는다.
    const twoEmptyLines =
      'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=\nEXPO_PUBLIC_NAVER_CLIENT_ID=\n';
    expect(kakaoKey.test(twoEmptyLines)).toBe(false);
    expect(naverId.test(twoEmptyLines)).toBe(false);
    // (b) 빈 값 뒤에 임의의 다음 줄이 와도 마찬가지다.
    expect(kakaoKey.test('EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=\nsomething')).toBe(
      false
    );
    // (c) 대조 — 여러 줄이어도 **진짜 값**은 여전히 잡힌다(위 셋이 탐지기를 죽여
    // 놓고 통과하는 것을 막는다).
    expect(
      kakaoKey.test(
        'EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY=real-value\nEXPO_PUBLIC_NAVER_CLIENT_ID=\n'
      )
    ).toBe(true);
  });
});

describe('AC-7 · app.config.ts 는 키를 env 로만 읽는다', () => {
  it('네이티브 앱 키·urlScheme 을 process.env 로 읽고(주석 밖에서), 32-hex 리터럴이 0건이다', () => {
    const raw = fs.readFileSync(path.resolve('app.config.ts'), 'utf8');
    const stripped = stripComments(raw);

    // 도달 앵커 — 파일을 실제로 읽었고 plugins 배열이 있는 그 파일이다.
    expect(stripped).toContain('plugins');

    // 긍정 — 두 값이 env 참조로 들어온다. **주석을 걷어낸 뒤** 보므로 주석에 적어 두는
    // 우회로는 통과하지 못한다. (naver consumerKey/Secret 은 런타임 initialize 로 가고,
    // config plugin 이 요구하는 것은 카카오 앱 키와 네이버 urlScheme 이다 — Seed §2.)
    expect(stripped).toContain('process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY');
    expect(stripped).toContain('process.env.EXPO_PUBLIC_NAVER_URL_SCHEME');

    // 부정 — 키 형태 리터럴이 박혀 있지 않다.
    expect(HEX32_LITERAL.test(stripped)).toBe(false);

    // 탐지기 자가검사.
    expect(HEX32_LITERAL.test(`const k = '${SYNTHETIC_HEX32}';`)).toBe(true);

    // stripComments 자기검증(양방향) — 주석은 죽고 URL 의 `//` 는 살아남는다. 뒤쪽이 없으면
    // `(?<!:)` 를 지웠을 때 URL 뒷부분이 통째로 사라져도 아무도 모른다.
    expect(
      stripComments(
        '// process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY\nconst a=1;'
      )
    ).not.toContain('EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY');
    expect(
      stripComments("const d = 'https://nid.naver.com/oauth2';")
    ).toContain('nid.naver.com/oauth2');
  });
});

describe('AC-8′ · 시크릿은 하드코딩 없이 env 로만 오고, 예외 사실이 주석·README 에 남는다', () => {
  it('어댑터에 시크릿 리터럴이 없고, 네이버 시크릿 변수는 코드에도 주석에도 등장하며, README 가 그 예외를 적는다', () => {
    const sources = authLibSources();

    // 도달 앵커 — 모집단이 채워졌고 진입점이 그 안에 있다.
    expect(sources.map((s) => s.file)).toContain('makeAuthorize.ts');

    // 긍정 1 — 네이버 시크릿을 **코드에서**(주석 아님) env 로 읽는 파일이 있다. 지금은 0건이라 red.
    const secretReaders = sources.filter((s) =>
      s.stripped.includes(`process.env.${NAVER_SECRET_VAR}`)
    );
    expect(secretReaders.map((s) => s.file)).toEqual([
      expect.stringMatching(/\.tsx?$/),
    ]);

    // 긍정 2 — ★ 그 파일의 raw 등장 횟수가 stripped 보다 많다 = 변수명이 **주석에도** 있다.
    // D5 가 요구한 "예외 사실을 코드 주석에 명시"를 기계로 증명하는 방법이다.
    const reader = secretReaders[0];
    expect(countOccurrences(reader.raw, NAVER_SECRET_VAR)).toBeGreaterThan(
      countOccurrences(reader.stripped, NAVER_SECRET_VAR)
    );

    // 부정 — 어떤 어댑터도 시크릿을 리터럴로 담지 않는다. `consumerSecret: '…'` 처럼
    // 따옴표 문자열을 바로 붙이는 형태를 잡고, `consumerSecret: process.env.X` 는 통과시킨다.
    const SECRET_LITERAL =
      /(consumerSecret|clientSecret|client_secret)\s*[:=]\s*['"`][^'"`]+['"`]/;
    const offenders = sources
      .filter((s) => SECRET_LITERAL.test(s.raw))
      .map((s) => s.file);
    expect(offenders).toEqual([]);

    // 탐지기 자가검사 — 리터럴은 잡고 env 참조는 안 잡는다.
    expect(SECRET_LITERAL.test("consumerSecret: 'abc123'")).toBe(true);
    expect(SECRET_LITERAL.test('clientSecret = "xyz789"')).toBe(true);
    expect(
      SECRET_LITERAL.test(`consumerSecret: process.env.${NAVER_SECRET_VAR}`)
    ).toBe(false);

    // README — D5 가 정정을 지시한 자리(현행 L19 는 "앱에 클라이언트 시크릿 없음"이라
    // 단정한다). 네이버 예외를 변수명과 함께 적어야 통과한다.
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8');
    expect(readme).toContain(NAVER_SECRET_VAR);
  });
});
