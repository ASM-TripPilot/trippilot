/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-1024 · AC-1(생성물) — 재생성된 `SlotCandidatesCandidatesItem` 에 후보 이름·카테고리·태그·사진이 있다.
 *
 * 무엇을 보장하나: `pnpm codegen` 이 실제로 무엇을 만들었는가. 선례(`visitCheckGenerated.test.ts`)대로
 * 테스트가 codegen 을 직접 돌리지 않고 **커밋된 생성물을 fs 로 읽어** 확인한다. 이전 사이클의 부분
 * 재생성이 이 파일만 옛 모양으로 남겨 h08·h10 이 이름·사진을 못 받았다 — 같은 드리프트의 재발을 잠근다.
 *
 * 커버 경계: 생성 소스의 **줄 모양**만 본다(각 필드가 optional·nullable 인지까지). 타입 단계의 짝은
 * `pnpm tsc` 0건(명령 검증 — 프로덕션 3파일 보정 뒤에만 참)이고, 실응답에 값이 오는지는 BE 몫이다.
 * 주석은 걷지 않는다 — 줄 시작 앵커(`^  이름?:`)가 JSDoc 줄(` * …`·`/** … *\/`)에 걸리지 않는다.
 */

const SOURCE_PATH = path.join(
  path.resolve('src'),
  'shared',
  'api',
  'generated',
  'schemas',
  'slotCandidatesCandidatesItem.ts'
);

const source = fs.existsSync(SOURCE_PATH)
  ? fs.readFileSync(SOURCE_PATH, 'utf8')
  : '';

describe('🔴 TRIP-1024 생성물 — SlotCandidatesCandidatesItem', () => {
  it('D1 · AC-1 — nameKo·category·tags·imageUrl 4필드가 optional 로 있다(nameKo·category·imageUrl 은 nullable)', () => {
    expect(source).toMatch(/^ {2}nameKo\?: string \| null;$/m);
    expect(source).toMatch(/^ {2}category\?: string \| null;$/m);
    expect(source).toMatch(/^ {2}tags\?: string\[\];$/m);
    expect(source).toMatch(/^ {2}imageUrl\?: string \| null;$/m);
  });

  it('D2 · AC-1 — 기존 필수 3필드(poiId·distanceRange·rationale)는 필수 그대로다', () => {
    expect(source).toMatch(/^ {2}poiId: string;$/m);
    expect(source).toMatch(/^ {2}distanceRange: string;$/m);
    expect(source).toMatch(/^ {2}rationale: string;$/m);
  });
});
