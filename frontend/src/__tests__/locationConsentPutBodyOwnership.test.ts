/**
 * @jest-environment node
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * TRIP-609 AC-2(구조) · AC-5(배치) · PBT-U6-F3 · BR-U6-29 — PUT 바디 **단일 통로** + shared 배치 가드.
 *
 * 무엇을 보장하나:
 *  (단일 통로) 위치 동의 PUT 바디(`{legalConsent, gpsRecordingOptIn}`)를 **객체 리터럴로 조립하는
 *   유일한 곳이 `consentPutBody.ts`** 다. PBT(consentPutBody.test.ts)는 그 함수가 옳음을 증명하지만,
 *   누가 다른 곳에서 `mutate({data:{legalConsent:true}})` 처럼 직접 조립하면 L2·L3 분리 전송이 새고
 *   PBT 게이트가 red 가 된다. 그 "샐 곳"을 소스 층에서 0으로 못 박는다(deletionScope 단일 소유 동형).
 *  (배치) `useLocationConsent`·`revokeImpact`·`consentPutBody` 가 `features/settings` 가 아니라
 *   `shared/location` 에 산다(TRIP-567·576 cross-feature 소비 + features 경계). 라우트·페이지 배럴도 실재.
 *
 * 왜 소스 스캔인가: "조립이 한 곳에만 있다"·"파일이 shared 에 있다"는 런타임 동작이 아니라 코드 배치의
 * 성질이라 렌더 테스트로 표현 못 한다.
 *
 * 왜 **shared/location 스코프**인가(whole-repo 아님): 생성 스키마 `putMeLocationConsentBody.ts` 는
 * `shared/api/generated` 라 `legalConsent:`/`gpsRecordingOptIn:` 를 정당하게 가진다 — 전 리포 스캔은
 * 그걸 오탐한다. 실제 표적("PUT 바디가 도메인 코드에서 인라인 조립되는 것")이 생길 곳은 shared/location 뿐.
 *
 * ⚠️ 탐지 대상은 **객체 리터럴 키**(`legalConsent:` 콜론)다 — GET 응답 읽기 `data?.legalConsent`(점접근)·
 *  구조분해 `{ gpsRecordingOptIn }` 는 콜론이 없어 정당하게 통과한다. 그리고 전처리(`stripComments`)의
 *  줄 주석 정규식이 URL 의 `//` 를 주석으로 오인하면 그 줄의 진짜 조립이 사라져 거짓 green 이
 *  난다(2026-07-31 실사고). `:` 뒤의 `//` 는 주석으로 보지 않고, 그 성질을 아래 자가검사가 잠근다.
 *
 * 가짜 통과 방지 규약(리포 관례): 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SHARED_LOCATION = join(SRC_ROOT, 'shared', 'location');
const CONSENT_PUT_BODY_FILE = join(SHARED_LOCATION, 'consentPutBody.ts');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * 주석을 걷는다. 블록 주석을 먼저 지운다(순서를 바꾸면 한 줄 안의 코드가 소실된다). 줄 주석은 바로
 * 앞 글자가 `:` 이면 주석으로 보지 않는다 — `'https://…'` 의 슬래시 오인을 막는다(settingsBoundary 규약).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * PUT 바디 인라인 조립 탐지기 — 객체 리터럴 키 `legalConsent:`/`gpsRecordingOptIn:`(콜론). 점접근·
 * 구조분해는 콜론이 없어 매치되지 않는다. 전처리(stripComments)를 먼저 태운 뒤 검사한다.
 */
function assemblesPutBody(source: string): boolean {
  return /\b(legalConsent|gpsRecordingOptIn)\s*:/.test(stripComments(source));
}

/** shared/location 프로덕션 소스(테스트 파일 제외)를 재귀로 모은다. */
function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (
      SOURCE_EXTENSIONS.some((ext) => full.endsWith(ext)) &&
      !/\.(test|spec)\.[tj]sx?$/.test(full)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('TRIP-609 · consentPutBody 단일 통로 + shared 배치 가드', () => {
  it('탐지기 자가검사 — 콜론키 조립은 잡히고, 점접근/구조분해/주석은 통과하며, URL 옆 조립은 살아남는다', () => {
    // ① 조립부(양성).
    expect(
      assemblesPutBody('return { legalConsent: on, gpsRecordingOptIn: on };')
    ).toBe(true);
    // ② 인라인 누출(위반) — 이걸 잡는 게 이 가드의 존재 이유.
    expect(assemblesPutBody('mutate({ data: { legalConsent: true } });')).toBe(
      true
    );
    // ③ GET 읽기 점접근(정당) — 콜론 없음.
    expect(assemblesPutBody('const on = data?.legalConsent ?? false;')).toBe(
      false
    );
    // ④ 구조분해(정당) — 콜론 없음.
    expect(assemblesPutBody('const { gpsRecordingOptIn } = data ?? {};')).toBe(
      false
    );
    // ⑤ 주석 안의 키는 전처리로 제거된다.
    expect(
      assemblesPutBody('// { legalConsent: true }\nexport const k = 1;')
    ).toBe(false);
    // ⑥ 블록 주석을 먼저 지우는 순서라야 같은 줄 코드가 살아남는다.
    expect(
      assemblesPutBody(
        '/* legalConsent: x */ const y = data.gpsRecordingOptIn;'
      )
    ).toBe(false);
    // ⑦ 회귀 가드 — URL 의 `//` 를 줄 주석으로 오인하면 진짜 조립이 사라져 거짓 green(2026-07-31 실사고).
    expect(
      assemblesPutBody(
        "const doc = 'https://x.io/p'; const b = { gpsRecordingOptIn: v };"
      )
    ).toBe(true);
  });

  it('consentPutBody.ts 가 실재하고 실제로 PUT 바디를 조립한다(양성 짝 — 빈 스텁 차단)', () => {
    expect(existsSync(CONSENT_PUT_BODY_FILE)).toBe(true);
    expect(assemblesPutBody(readFileSync(CONSENT_PUT_BODY_FILE, 'utf8'))).toBe(
      true
    );
  });

  it('AC-5 배치 — 순수/훅 모듈이 shared/location 에 산다(features/settings 아님)', () => {
    for (const file of [
      'consentPutBody.ts',
      'revokeImpact.ts',
      'useLocationConsent.ts',
    ]) {
      expect(existsSync(join(SHARED_LOCATION, file))).toBe(true);
    }
  });

  it('AC-5 배치 — 라우트·슬라이스 배럴·페이지가 관례대로 실재한다', () => {
    expect(existsSync(join(SRC_ROOT, 'app', 'settings', 'location.tsx'))).toBe(
      true
    );
    expect(
      existsSync(join(SRC_ROOT, 'pages', 'settings-location', 'index.ts'))
    ).toBe(true);
    expect(
      existsSync(
        join(
          SRC_ROOT,
          'pages',
          'settings-location',
          'ui',
          'LocationConsentPage.tsx'
        )
      )
    ).toBe(true);
  });

  it('shared/location 의 다른 소스는 PUT 바디를 인라인 조립하지 않는다(consentPutBody.ts 가 유일 통로)', () => {
    // 긍정 짝 — 유일 통로가 실재해야 이 스캔이 의미를 갖는다(부재 시 "위반 0"은 공허하다).
    // 구현 전엔 consentPutBody.ts 가 없어 red → 구현 후 green 이면서 유일 통로를 지키는 그물이 된다.
    expect(existsSync(CONSENT_PUT_BODY_FILE)).toBe(true);

    const files = collectSources(SHARED_LOCATION).filter(
      (file) => file !== CONSENT_PUT_BODY_FILE
    );
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      if (assemblesPutBody(readFileSync(file, 'utf8'))) {
        offenders.push(relative(SRC_ROOT, file).split(sep).join('/'));
      }
    }

    // consentPutBody.ts 를 import 해 쓰는 것만 허용 — 인라인 조립은 어디에도 없어야 한다.
    expect(offenders).toEqual([]);
  });
});
