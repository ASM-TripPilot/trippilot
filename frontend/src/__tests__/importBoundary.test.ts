/**
 * @jest-environment node
 */
import path from 'path';

import { ESLint } from 'eslint';

// 이 파일은 실재하지 않아도 된다 — ESLint 는 "이 위치의 파일이라면 어떤 규칙이 적용되는가"를
// 계산하는 데에만 filePath 를 쓴다.
const HOME_FILE = path.resolve('src/features/home/__boundary_probe__.ts');

// 프로브 경로는 배럴(index.ts)이 아니라 **실파일 깊은 경로**를 가리킨다.
// 배럴은 지워질 수 있고, 지워지면 잡히는 것이 "경계 위반"에서 "모듈 해석 실패"로
// 바뀌면서 테스트가 조용히 무의미해진다(실제로 그렇게 뚫렸다).
const CROSS_FEATURE_IMPORT = '@/features/onboarding/model/preferenceStore';
const SHARED_IMPORT = '@/shared/ui/BottomTabBar';
// 일부러 존재하지 않는 경로 — 썩지 않는 하네스 생존 확인용이다.
const UNRESOLVABLE_IMPORT = '@/features/__boundary_probe_missing__';

const BOUNDARY_RULE = 'import/no-restricted-paths';
const UNRESOLVED_RULE = 'import/no-unresolved';

async function lintAsHome(code: string): Promise<ESLint.LintResult> {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath: HOME_FILE });
  return result;
}

// severity 2 = error. **개수가 아니라 "어느 규칙이 잡았는지"** 를 배열로 뽑는다 —
// 개수만 세면 다른 규칙이 대신 잡아도 통과해버린다.
function errorRuleIds(result: ESLint.LintResult): (string | null)[] {
  return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
}

describe('import boundary rule: features/* may not import another feature', () => {
  it('lint harness is live: an unresolvable path is actually reported', async () => {
    const bogus = await lintAsHome(`import '${UNRESOLVABLE_IMPORT}';\n`);

    expect(errorRuleIds(bogus)).toContain(UNRESOLVED_RULE);
  });

  it('reports the boundary rule (not a resolution failure) when features/home imports another feature', async () => {
    const violating = await lintAsHome(`import '${CROSS_FEATURE_IMPORT}';\n`);
    const ruleIds = errorRuleIds(violating);

    expect(ruleIds).toContain(BOUNDARY_RULE);
    expect(ruleIds).not.toContain(UNRESOLVED_RULE);
  });

  it('allows features/home to import from shared/* (valid dependency direction is clean)', async () => {
    const allowed = await lintAsHome(`import '${SHARED_IMPORT}';\n`);

    expect(errorRuleIds(allowed)).toEqual([]);
  });
});
