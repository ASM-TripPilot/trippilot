/**
 * `process.env` 키 저장/복원 샌드박스(TRIP-1355) — 파일마다 복사하던 `ENV_KEYS`·`ORIGINAL_ENV` 보관 루프와
 * `afterEach` 복원 루프의 공용본. 파일 최상위에서 한 번 부른다: 부른 시점의 값을 저장해 두고 매 테스트 뒤
 * (`afterEach`) 되돌린다(원래 없던 키는 `delete`). `clearBefore` 면 매 테스트 앞(`beforeEach`)에서 키를 비운다.
 */
export function sandboxEnv(
  keys: readonly string[],
  { clearBefore = false }: { clearBefore?: boolean } = {}
): void {
  const original: Record<string, string | undefined> = {};
  for (const key of keys) original[key] = process.env[key];

  if (clearBefore) {
    beforeEach(() => {
      for (const key of keys) delete process.env[key];
    });
  }

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
}
