/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-397 · AC-2 결함#2 — 여행 중 지도(LiveMapScreen)의 **토글 형제 배치 소스 가드**.
 *
 * 무엇을 보장하나:
 *  계획｜실제 토글이 `KakaoMapView`(WebView) 위 `absolute` 오버레이면 WebView 가 터치를 먹어
 *  토글이 안 눌린다(repo-traps: WebView 위 오버레이 함정). 근본 수정 = 토글을 지도의 **형제**로
 *  (지도 위/아래 컬럼). 이 파일은 `LiveMapScreen.tsx` 소스에 **`absolute` className 이 0건**임을
 *  못박는다 — 지도 표면엔 정당한 absolute 가 없으므로(세그먼트 컨트롤·flex 행·peek 우정렬은 전부
 *  일반 flow) "파일 전수 absolute 0건"은 AC-2("토글 조상에 absolute 0건")의 **상위집합**(더 엄격).
 *
 * **한계(설계상)**: jest 는 렌더 위치를 원리적으로 못 본다(가짜 카카오 SDK 가 Proxy — repo-traps).
 *  실제 세로 분리·터치 통과는 [검증] 6-b 실기 탭이 유일한 확인. 이 소스 스캔은 "absolute 오버레이
 *  회귀"만 잡는다.
 *
 * **전제 — 주석을 걷어낸 소스를 스캔한다**(stripComments). 안 걷으면 "토글을 absolute 오버레이가
 *  아니라 형제로 배치" 같은 수호 주석의 `absolute` 가 부정 단언을 red 로 만든다. 줄 주석 규칙은
 *  바로 앞 글자가 `:` 이면 주석으로 보지 않는다(URL 슬래시 오인 방지 — 동결 가드 공통 룩비하인드).
 */

const ROOT = path.resolve('src');
const SCREEN_REL = 'features/execution/ui/LiveMapScreen.tsx';
const ABSOLUTE = /\babsolute\b/;

/** 블록 주석 먼저 → 줄 주석(콜론 예외). 순서를 바꾸면 한 줄 안 코드가 소실된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf8');
}

describe('G1 · 탐지기 자가검사 — 이게 통과해야 아래 스캔이 의미를 갖는다', () => {
  it('주석 속 absolute 는 걷히고, 실제 className absolute 는 잡히며, 정당한 코드는 보존된다', () => {
    // ★ 조합 검증 — 전처리(stripComments)와 탐지기(/\babsolute\b/)가 서로를 지우는지
    //   실제 문자열로 본다(리포 관례, 문제로그 [[2026-07-31 stripComments URL 오인]] 계열).
    const buggy = [
      '// 토글을 absolute 오버레이가 아니라 형제로 배치한다',
      'const track = "flex-row gap-xs bg-surface-soft";',
      'const overlay = "absolute bottom-0 left-0 right-0";',
    ].join('\n');
    const fixed = [
      '// 토글을 absolute 오버레이가 아니라 형제로 배치한다',
      'const track = "flex-row gap-xs bg-surface-soft";',
      'const col = "gap-sm px-lg py-md";',
    ].join('\n');

    // ① 주석 속 absolute 는 걷혀 실제 코드에 없으면 false — 안 걷으면 수호 주석이 red 를 만든다.
    expect(ABSOLUTE.test(stripComments(fixed))).toBe(false);
    // ② 실제 className absolute 는 주석을 걷어도 살아남아 잡힌다.
    expect(ABSOLUTE.test(stripComments(buggy))).toBe(true);
    // ③ 정당한 코드(flex-row)는 보존된다(우회로 아님).
    expect(stripComments(fixed)).toContain('flex-row');
  });
});

describe('G2 · AC-2 — LiveMapScreen 토글은 absolute 오버레이가 아니라 형제다', () => {
  it('LiveMapScreen.tsx 소스(주석 제외)에 absolute className 이 0건이다', () => {
    const source = stripComments(readOne(SCREEN_REL));

    // 긍정 앵커 — 파일이 실재하고 이 칸이 겨냥하는 토글이 그 안에 있다(공허 통과 방지).
    // testID 는 템플릿 리터럴 `execution-map-${key}-toggle` 로 조립되므로 접두/접미로 앵커한다.
    expect(source).toContain('execution-map-');
    expect(source).toContain('-toggle');

    // 부정 — absolute 0건(현행 오버레이 `className="absolute bottom-0 …"` 가 여기서 red).
    expect(ABSOLUTE.test(source)).toBe(false);
  });
});
