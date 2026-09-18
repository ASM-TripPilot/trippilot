/**
 * @jest-environment node
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-608 — 닉네임 형식 검증(`validateNicknameFormat`)의 `shared/` 승격이 **이동이지 복제가
 * 아니다**(sharedUiStructure 의 StateNotice 승격 선례와 같은 자리·같은 성질).
 *
 * 왜 이 가드가 필요한가: `features/settings` 는 `settingsBoundary.test.ts` 가 다른 feature 의
 * import 를 막으므로 onboarding 의 `validateNicknameFormat` 를 그대로 못 쓴다 → `shared/validation`
 * 으로 승격하고 onboarding 은 재수출한다. 그런데 기존 onboarding 테스트가 green 으로 남는 것은
 * **재수출만 확인**할 뿐, 구현 본문을 shared 로 옮기지 않고 **복제**(양쪽에 본문)해도 못 잡는다 —
 * 그러면 한쪽 규칙만 고쳐 서버 char_length 판정과 갈라진다. 이 가드가 그 드리프트를 막는다.
 *
 * 가짜 통과 방지 규약: 모든 "없어야 한다" 단언은 "있어야 한다" 단언과 짝을 이룬다.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SHARED_FILE = join(SRC_ROOT, 'shared', 'validation', 'nicknameFormat.ts');
const ONBOARDING_FILE = join(
  SRC_ROOT,
  'features',
  'onboarding',
  'model',
  'validateNicknameFormat.ts'
);
const SETTINGS_ROOT = join(SRC_ROOT, 'features', 'settings');
const PAGES_SETTINGS_ROOT = join(SRC_ROOT, 'pages', 'settings');
const SHARED_IMPORT = '@/shared/validation/nicknameFormat';

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (
      /\.(ts|tsx)$/.test(full) &&
      !/\.(test|spec)\.[tj]sx?$/.test(full)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('TRIP-608 · validateNicknameFormat shared 승격은 이동이다', () => {
  it('shared 정본이 실재하고 함수·상수를 내보낸다(긍정)', () => {
    expect(existsSync(SHARED_FILE)).toBe(true);

    const source = readFileSync(SHARED_FILE, 'utf8');
    expect(source).toMatch(/export function validateNicknameFormat\b/);
    expect(source).toContain('NICKNAME_MIN_LENGTH');
    expect(source).toContain('NICKNAME_MAX_LENGTH');
  });

  it('onboarding 파일은 얇은 재수출이다 — 구현 본문을 복제하지 않는다', () => {
    expect(existsSync(ONBOARDING_FILE)).toBe(true);

    const source = readFileSync(ONBOARDING_FILE, 'utf8');
    // 긍정 — 재수출이 shared 정본을 가리킨다.
    expect(source).toContain(SHARED_IMPORT);
    // 부정(복제 차단) — 코드포인트 계수 구현(`[...value]` 스프레드)이 남아 있으면 이동이 아니라
    // 복제다. 재수출 파일에는 이 구현이 없어야 한다.
    expect(source).not.toMatch(/\[\s*\.\.\./);
  });

  it('settings 소비처가 shared 경로로 형식 검증을 부른다(긍정 — 승격이 실사용됨)', () => {
    const files = [
      ...collectSources(SETTINGS_ROOT),
      ...collectSources(PAGES_SETTINGS_ROOT),
    ];
    expect(files.length).toBeGreaterThan(0);

    const usesShared = files.some((file) =>
      readFileSync(file, 'utf8').includes(SHARED_IMPORT)
    );
    expect(usesShared).toBe(true);
  });
});
