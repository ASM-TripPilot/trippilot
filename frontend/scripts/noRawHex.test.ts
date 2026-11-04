/**
 * @jest-environment node
 */

/**
 * TRIP-1774 · raw hex 가드의 "hex 찾기 + 같은 값 토큰 이름 찾기" 계약 — `scripts/noRawHex.cjs` 의 순수 함수 `findRawHex`.
 *
 * 왜 따로 있나: `eslintReleaseRules.test.ts` 의 `lintText` 탐침은 "이 파일에서 규칙이 울리나"만 본다.
 * 정규식의 경계(3·6·8자리는 잡고 4·5·7자리는 안 잡는다)와 토큰 이름 안내는 문자열만 넣어 직접 단언하는 쪽이 싸고 정확하다.
 * 디스크를 읽지 않고 소스 문자열 픽스처만 넣으므로 소스 스캔 금지(TRIP-1145)에 안 걸린다.
 *
 * 입력: findRawHex(text, tokens) — text 는 문자열 리터럴 하나의 값, tokens 는 { 토큰 이름: '#RRGGBB' }(정본 맵과 같은 모양).
 * 출력: [{ hex: 글에 적힌 그대로, tokens: 같은 값을 가진 토큰 이름 배열(없으면 []) }] — 나온 순서대로, hex 하나에 원소 하나.
 *
 * 테스트가 `.ts` 인 이유: jest testMatch 가 `.cjs` 를 줍지 않아서다(glyphExportBlocks.test.ts 와 같다).
 * 3동작 뼈대: 준비=문자열·토큰 픽스처 → 실행=`findRawHex(text, tokens)` → 단언=찾은 hex·토큰 이름.
 */

type Found = { hex: string; tokens: string[] };
type Lib = {
  findRawHex: (text: string, tokens: Record<string, string>) => Found[];
};

const { findRawHex } = jest.requireActual<Lib>('./noRawHex.cjs');

// 정본 맵 모양의 가짜 — 두 이름이 같은 값을 가지는 경우(on-primary·canvas)와 3자리 확장 대상을 담는다.
const TOKENS = {
  brand: '#ABCDEF',
  'brand-alias': '#ABCDEF',
  white: '#FFFFFF',
  black: '#000000',
};
const hexes = (text: string) => findRawHex(text, TOKENS).map((f) => f.hex);

describe('findRawHex — 어떤 모양을 hex 로 보나 (3·6·8자리, 4·5·7자리는 아니다)', () => {
  it('3·6·8자리 hex 를 글에 나온 순서대로, 적힌 그대로(대소문자 유지) 돌려준다', () => {
    const found = hexes('a #fff b #FF385C c #FFFFFF00 d');

    expect(found).toEqual(['#fff', '#FF385C', '#FFFFFF00']);
  });

  it.each([
    ['4자리 알파', '#abcd'],
    ['5자리', '#abcde'],
    ['7자리', '#abcdef0'],
    ['16진수가 아닌 글자', '#ggg'],
    ['# 뒤가 공백', '# fff'],
    ['rgba()', 'rgba(0,0,0,0.4)'],
    ['이름 색', 'white'],
  ])('%s 는 hex 로 안 본다 (%s)', (_label, text) => {
    expect(hexes(text)).toEqual([]);
  });

  it('className 임의값 bg-[#ECECEC] 안의 hex 도 찾는다 (] 에서 경계가 끊긴다)', () => {
    expect(hexes('rounded-[8px] border-[#C4C9CF] px-2')).toEqual(['#C4C9CF']);
  });

  it('한 문자열에 hex 가 둘이면 둘 다 돌려준다', () => {
    expect(hexes('linear #FF385C,#222222')).toEqual(['#FF385C', '#222222']);
  });

  it('같은 입력을 두 번 불러도 결과가 같다 (전역 정규식의 lastIndex 상태가 호출 사이에 새지 않는다)', () => {
    const first = findRawHex('x #FF385C y', TOKENS);
    const second = findRawHex('x #FF385C y', TOKENS);

    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
  });
});

describe('findRawHex — 같은 값 토큰 이름 안내', () => {
  it('값이 같은 토큰을 대소문자 무시로 전부 알려준다 (별칭 둘이면 둘 다)', () => {
    const [found] = findRawHex('#abcdef', TOKENS);

    expect(found.tokens).toEqual(['brand', 'brand-alias']);
  });

  it.each([
    ['#fff', ['white']],
    ['#000', ['black']],
  ])('3자리 %s 는 6자리로 늘려 비교한다', (text, expected) => {
    const [found] = findRawHex(text, TOKENS);

    expect(found.tokens).toEqual(expected);
  });

  it('토큰에 없는 값은 빈 배열 — 안내할 이름이 없다', () => {
    const [found] = findRawHex('#010203', TOKENS);

    expect(found.tokens).toEqual([]);
  });

  it('8자리 알파는 같은 6자리 토큰으로 안내하지 않는다 (투명도가 다른 색이다)', () => {
    const [found] = findRawHex('#FFFFFF00', TOKENS);

    expect(found.hex).toBe('#FFFFFF00');
    expect(found.tokens).toEqual([]);
  });
});
