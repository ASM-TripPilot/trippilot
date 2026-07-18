/**
 * @jest-environment node
 */
import path from 'path';

import { ESLint } from 'eslint';

const HOME_FILE = path.resolve('src/features/home/__boundary_probe__.ts');

async function lintAsHome(code: string): Promise<ESLint.LintResult> {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath: HOME_FILE });
  return result;
}

describe('import boundary rule: features/* may not import another feature', () => {
  it('reports an error when features/home imports features/stay directly', async () => {
    const violating = await lintAsHome("import '@/features/stay';\n");
    const allowed = await lintAsHome("import '@/shared/ui';\n");

    const realErrors = violating.messages.filter(
      (m) => m.severity === 2 && m.fatal !== true && m.ruleId != null
    );

    expect(realErrors.length).toBeGreaterThan(0);
    expect(violating.errorCount).toBeGreaterThan(allowed.errorCount);
  });

  it('allows features/home to import from shared/* (valid dependency direction is clean)', async () => {
    const allowed = await lintAsHome("import '@/shared/ui';\n");

    expect(allowed.errorCount).toBe(0);
  });
});
