/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1103 AC-4 — FAB 바닥 오프셋 `bottom-[100px]` 이 src 어디에도(주석 포함) 남지 않는다.
 *
 * 무엇을 보장하나: 출처 없는 100 이 다시 들어오면(새 화면 복붙·머리 주석 되살림) red 다.
 * 렌더 테스트(AC-1)는 그려진 세 묶음만 보고, 주석(ExploreLandingScreen 머리 주석)은 못 본다 —
 * 그래서 이 자리만 소스를 글자로 읽는다. 주석을 걷지 않는다(주석도 금지 대상, 02a ★3).
 * 테스트 파일은 뺀다 — 금칙어를 문자열로 적어야 하는 이 파일·AC-1 단언이 스스로 걸리지 않게.
 */

const ROOT = path.resolve('src');
const FORBIDDEN = 'bottom-[100px]';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name)
      ? [full]
      : [];
  });
}

describe('TRIP-1103 AC-4 · src 전체 bottom-[100px] 0건(주석 포함)', () => {
  it('프로덕션 소스 어디에도 bottom-[100px] 이 없다', () => {
    const files = sourceFiles(ROOT);
    // 앵커 — 스캔이 실제로 FAB 화면을 읽었다(경로가 틀려 0파일이라 초록인 게 아니다).
    // TRIP-1105 — 목적지 상세 화면은 d01 지역 필터로 합쳐져 지워진다(앵커 3 → 2).
    const rel = files.map((f) => path.relative(ROOT, f));
    expect(rel).toEqual(
      expect.arrayContaining([
        path.join('features', 'explore', 'ui', 'ExploreLandingScreen.tsx'),
        path.join('features', 'explore', 'ui', 'PlaceExploreScreen.tsx'),
      ])
    );

    const hits = files.flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          line.includes(FORBIDDEN)
            ? [`${path.relative(ROOT, file)}:${i + 1}`]
            : []
        )
    );
    expect(hits).toEqual([]);
  });
});
