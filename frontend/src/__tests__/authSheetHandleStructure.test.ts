/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * TRIP-713 — c02 소셜 로그인 시트 셸(충돌·연령확인·연령제한 공용 `Sheet`)의 그래버 단일화 가드.
 *
 * 무엇을 보장하나: 공용 셸의 `<BottomSheet>` 가 `handleComponent={null}` 로 gorhom 기본 핸들을
 * 끈다 — 이걸 빼면 커스텀 grabber 바(Figma 회색 바) 위에 gorhom 기본 핸들이 겹쳐 바가 2개로
 * 보인다(3 시트 공통).
 *
 * 왜 소스 스캔인가: `@gorhom/bottom-sheet` 목이 통과형(children 무조건 렌더·기본 핸들 미렌더)
 * 이라 **2겹 여부를 jest 가 원리적으로 못 본다**(repo-traps 바텀시트 절). `SocialLoginScreen.
 * visual.test.tsx` AC-S2 는 커스텀 바가 트리에 하나뿐임을 render 층에서 잠그지만, 런타임에서만
 * 뜨는 gorhom 기본 핸들은 그 사정거리 밖이다 — 이 파일이 그 blind spot 의 유일한 jest 그물이다.
 * g 밴드 편집 시트(TRIP-735)와 같은 문제·다른 처방(그쪽은 `handleIndicatorStyle` 공용 상수,
 * 여기선 커스텀 바 유지 + 기본 핸들만 끔 — 그 상수는 `features/trip` 에 있어 `features/auth` 로
 * import 하면 형제 feature 경계 위반).
 *
 * ⚠️ 사정거리 한계(5-b 참고-1): 이 가드는 prop 이 `<BottomSheet>` 여는 태그에 **바인딩**됐는지
 * 까지 본다(아래 HANDLE_OFF — 존재만이 아니라 결합). 그러나 gorhom 이 그 prop 으로 **실제 핸들을
 * 0개 그리는지**는 jest 로 증명 불가(목이 기본 핸들 자체를 미렌더). "바 1겹" 실동작은 실기
 * 스모크(로그인 시트 3종은 repo-traps 상 실기가 유일한 그물)뿐이고, 자율 세션에선 사용자 육안 대기.
 */

const SRC_ROOT = resolve(__dirname, '..');
const SCREEN = join(
  SRC_ROOT,
  'features',
  'auth',
  'ui',
  'SocialLoginScreen.tsx'
);

/** 줄/블록 주석 제거 — `:` 뒤 `//`(URL)는 주석으로 안 본다(형제 가드 계승). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * prop-엘리먼트 **바인딩**을 한 덩어리로 잠근다 — 형제 `editSheetHandleStructure.test.ts` 의
 * `HANDLE_WIRING`(prop=값 결합) 선례. `<BottomSheet …>` 여는 태그 안(`[^>]*`, 닫는 `>` 전)에
 * `handleComponent={null}` 이 있어야 매치한다. "파일 어딘가에 리터럴만 존재"(그 prop 을
 * `<BottomSheetView>` 로 옮기거나 딴 엘리먼트에 붙임)로는 통과 못 한다(5-b 경고-1 봉합).
 */
const HANDLE_OFF = /<BottomSheet\b[^>]*handleComponent=\{\s*null\s*\}/;

describe('g0 · 탐지기 자가검사 (전처리 × 탐지기 조합)', () => {
  it('stripComments 후 <BottomSheet> 결합만 잡고 주석·타엘리먼트는 안 잡는다', () => {
    // 실제 결합 → 매치.
    expect(
      HANDLE_OFF.test(
        stripComments('<BottomSheet a={x} handleComponent={null}>')
      )
    ).toBe(true);
    // 주석 → 걷혀서 미검출(false GREEN 차단).
    expect(
      HANDLE_OFF.test(stripComments('// <BottomSheet handleComponent={null}>'))
    ).toBe(false);
    // 리터럴은 있으나 딴 엘리먼트(BottomSheetView)에 붙음 → 미검출(경고-1 우회 차단).
    expect(
      HANDLE_OFF.test(
        stripComments(
          '<BottomSheet a={x}>\n  <BottomSheetView handleComponent={null}>'
        )
      )
    ).toBe(false);
  });
});

describe('TRIP-713 · 시트 셸 그래버 단일화', () => {
  it('SocialLoginScreen.tsx 가 존재한다(빈 파일 공허 통과 차단)', () => {
    expect(existsSync(SCREEN)).toBe(true);
    expect(readFileSync(SCREEN, 'utf8').length).toBeGreaterThan(0);
  });

  it('공용 Sheet 셸의 <BottomSheet> 가 handleComponent={null} 로 기본 핸들을 끈다', () => {
    const stripped = stripComments(readFileSync(SCREEN, 'utf8'));
    expect(HANDLE_OFF.test(stripped)).toBe(true);
  });
});
