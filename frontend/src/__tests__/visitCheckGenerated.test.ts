/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-619 · AC-1(codegen 정합) · AC-2(구조) — 생성 VisitCheck.updatedAt(required) 잠금.
 *
 * 무엇을 보장하나: 코드젠이 실제로 무엇을 만들었는가. `staySearchGenerated.test.ts` 선례대로
 * `pnpm codegen`을 이 테스트가 직접 돌리지 않고(orval 실행은 워킹트리에 파일을 쓰는 부작용이 있다 —
 * ★함정: codegen은 구현 몫) **커밋된 생성물을 fs로 읽어서** 확인한다.
 *
 * 왜 red 인가: 현 `generated/schemas/visitCheck.ts`는 TRIP-603이 additive-only 로 되돌린 stale 출력이라
 * `updatedAt`이 결측이다(develop openapi:1943 required 목록엔 있는데). 구현이 `pnpm codegen`을 다시
 * 돌리면 required `updatedAt`이 유입돼 이 스캔이 green 이 된다. 그래서 이 파일은 codegen 재실행을
 * "다시 안전"하게 만드는 계약의 심판이다.
 *
 * 커버 경계: 생성물 **소스 텍스트**만 본다(타입 단계의 짝은 `pnpm tsc` — 픽스처가 낙관 리터럴과 함께
 * 그쪽을 잠근다). updatedAt 이 required 인지(`?` 없음)까지는 보지만, `format: date-time`의 런타임
 * 표현이나 실제 서버 값 형식은 이 층의 사정거리 밖이다.
 */

const GENERATED_SCHEMAS = path.join(
  path.resolve('src'),
  'shared',
  'api',
  'generated',
  'schemas'
);

/**
 * 주석 제거 근사(`staySearchGenerated.test.ts`의 것과 동형 2-regex). 블록을 먼저 지워야
 * 한 줄 안 `/* a // b *​/` 에서 코드가 소실되지 않는다. 공용화하지 않고 파일이 각자 갖는다(선례).
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
}

/** 아직 없으면 빈 문자열(방어) — 그러면 긍정 앵커가 "기대 문자열이 빈 문자열에 없다"로 자연 실패. */
function readGenerated(file: string): string {
  const full = path.join(GENERATED_SCHEMAS, file);
  return fs.existsSync(full)
    ? stripComments(fs.readFileSync(full, 'utf8'))
    : '';
}

const REQUIRED_UPDATED_AT = /updatedAt:\s*string/;
const OPTIONAL_UPDATED_AT = /updatedAt\?:/;
// nullable 회귀(`updatedAt: string | null`)는 required 정규식을 그대로 통과하므로 별도로 막는다
// — 오프라인 충돌 기준버전은 절대 null 이면 안 된다(BR-U5-22). code-critic 경고-1 봉합.
const NULLABLE_UPDATED_AT = /updatedAt:\s*string\s*\|\s*null/;

describe('G1 · stripComments × updatedAt 탐지기 조합 자기검증 (전처리 파수꾼)', () => {
  it('코드의 updatedAt:string 은 탐지되고, 주석 속 같은 글자는 걷혀 탐지 안 된다', () => {
    // 준비 — 코드 한 줄 + 주석 한 줄, 둘 다 `updatedAt: string` 을 담는다.
    const withCode = stripComments(
      [
        '/* 주석 속: updatedAt: string 이지만 걷혀야 한다 */',
        'export interface X {',
        '  visitCheckId: string;',
        '  updatedAt: string;',
        '}',
      ].join('\n')
    );
    // 주석에만 있는 표본(코드엔 updatedAt 없음).
    const commentOnly = stripComments(
      '/* updatedAt: string */\nexport interface Y { visitCheckId: string; }'
    );

    // 단언 — 전처리가 no-op 로 퇴화하거나 코드를 지우면 여기서 즉시 red.
    expect({
      codeLineDetected: REQUIRED_UPDATED_AT.test(withCode),
      commentLineErased: withCode.includes('걷혀야 한다'),
      commentOnlyDetected: REQUIRED_UPDATED_AT.test(commentOnly),
      codeKept: commentOnly.includes('visitCheckId'),
    }).toEqual({
      codeLineDetected: true,
      commentLineErased: false,
      commentOnlyDetected: false,
      codeKept: true,
    });
  });
});

describe('AC-1 · AC-2 · 생성 VisitCheck 가 updatedAt 를 필수 string 으로 갖는다 (G2)', () => {
  it('visitCheck.ts 에 updatedAt: string 이 실재하고, 옵셔널(?)이 아니다 — codegen 후 GREEN', () => {
    const source = readGenerated('visitCheck.ts');

    // 긍정 앵커 — 실제 VisitCheck 스키마를 읽었다(빈 파일/오독 시 공허 통과 방지).
    expect(source).toContain('export interface VisitCheck');
    expect(source).toContain('visitCheckId');

    // 본 단언 — required updatedAt(openapi:1943). 현 stale 은 결측이라 RED, codegen 후 GREEN.
    expect(REQUIRED_UPDATED_AT.test(source)).toBe(true);
    // 부정 짝 — non-nullable required 라 `updatedAt?:` 형태가 아니다(openapi 는 nullable 아님).
    expect(OPTIONAL_UPDATED_AT.test(source)).toBe(false);
    // 부정 짝 2 — nullable(`string | null`)도 아니다(충돌 기준버전은 null 금지, BR-U5-22).
    expect(NULLABLE_UPDATED_AT.test(source)).toBe(false);
  });
});

describe('AC-1 · additive 계약 필드도 codegen 으로 함께 유입된다 (G3)', () => {
  it('AdjustTimesRequest.expectedUpdatedAt · ErrorResponseError.visitCheckId·serverUpdatedAt 실재', () => {
    const adjust = readGenerated('adjustTimesRequest.ts');
    const errorErr = readGenerated('errorResponseError.ts');

    // 현 stale 은 셋 다 결측 → RED, codegen 후 GREEN(전부 옵셔널이라 tsc 는 안 깨는 additive).
    expect({
      expectedUpdatedAt: adjust.includes('expectedUpdatedAt'),
      visitCheckId: errorErr.includes('visitCheckId'),
      serverUpdatedAt: errorErr.includes('serverUpdatedAt'),
    }).toEqual({
      expectedUpdatedAt: true,
      visitCheckId: true,
      serverUpdatedAt: true,
    });
  });
});
