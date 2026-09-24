/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-762 · AC-4 — j03 통계 재구성 소스 가드(값 폰트 22 · 세로 구분선 제거).
 * TRIP-763 · AC-9·10·11 — 3얼굴 정합의 비주얼 3종을 화면 소스 리터럴로 가드
 *   (박스 채움 `bg-surface-soft` · 에러 재시도 글자 `text-ink` · 빈 원 `size={60}`).
 *
 * 왜 소스 스캔인가: 채움색·글자색·글리프 크기는 NativeWind 가 트리에 평문으로 남기는 className/prop
 * 리터럴이다 — 렌더 트리에서 "그 노드 하나"를 집어 색·치수를 읽는 것보다 소스에서 직접 대조하는 쪽이
 * 오탐이 없다(reflectionStructure·shareCardStructure 소스 가드 관례). 글리프 fill/stroke 색은 jest 가
 * 원리적으로 못 보므로(repo-traps 글리프 함정) 크기·className 만 본다. 거동(탭·탭바·편집)은 렌더
 * 테스트(`DailyReflectionScreen.faces.test.tsx`·`.test.tsx`)가 맡는다.
 *
 * **전제**: 스캔은 주석을 걷은 소스를 본다(`stripComments`) — 근거를 주석에 적는 리포 관례에서
 * 주석 속 리터럴이 부정 단언을 거짓 red 로 만들지 않게. **가짜 통과 방지**: 모든 "없어야 한다"는
 * 같은 it 안 "있어야 한다"(추출된 className 이 비지 않음)와 짝을 이룬다.
 */

const ROOT = path.resolve('src');
const STATS_REL = 'features/reflection/ui/ReflectionStatsRow.tsx';
const SCREEN_REL = 'features/reflection/ui/DailyReflectionScreen.tsx';

/** 콜론(:) 뒤 // 는 주석으로 보지 않는다 — URL·경로의 `//` 를 스캔 전에 안 지우기 위함. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 없는 파일은 빈 문자열 — 부정 단언 공짜 통과는 같은 it 의 긍정 짝이 막는다. */
function readOne(rel: string): string {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return '';
  return stripComments(fs.readFileSync(full, 'utf8'));
}

/**
 * 어떤 testID 를 단 요소의 className 리터럴들(같은 요소는 testID 바로 뒤에 className 이 온다).
 * lazy 매칭이라 testID 뒤 **첫 className** 을 집는다 = 그 요소의 className. 같은 testID 가 여러 번
 * 있으면(예: 사진 없음 박스는 default·data-insufficient 두 얼굴에 각 1개) 배열로 모두 돌려준다.
 */
function classNamesForTestId(source: string, testId: string): string[] {
  const re = new RegExp(`testID="${testId}"[\\s\\S]*?className="([^"]*)"`, 'g');
  return [...source.matchAll(re)].map((m) => m[1]);
}

/** 어떤 leaf 텍스트를 감싼 Text 의 className(텍스트 바로 앞 className="..."> 를 집는다). */
function classNameOfText(source: string, text: string): string {
  const m = source.match(new RegExp(`className="([^"]*)"[^>]*>\\s*${text}`));
  return m ? m[1] : '';
}

describe('G0 · 탐지기 자가검사 — stripComments 가 코드 리터럴은 남기고 주석은 걷는다', () => {
  it('주석 속 w-px 는 걷히고 코드 속 className 리터럴은 살아남는다', () => {
    const sample = [
      '// 옛 구분선 w-px 는 주석으로 근거를 남겨도 걷힌다.',
      'const cls = "text-[22px] w-px";',
    ].join('\n');
    const stripped = stripComments(sample);

    // 코드 리터럴은 보존(전처리가 다 지우면 아래 부정 단언이 공허해진다).
    expect(stripped).toContain('text-[22px]');
    // 주석 줄의 w-px 는 걷혔지만 코드 줄의 w-px 는 남는다(이 샘플엔 코드에도 있어 남는다).
    expect(stripped.split('\n')[0]).not.toContain('w-px');
  });
});

describe('🔴 AC-4 · 통계 값 폰트 22 + 세로 구분선 제거', () => {
  it('ReflectionStatsRow 는 text-[22px] 를 쓰고, 옛 20px·세로 구분선(w-px)은 없다', () => {
    const stats = readOne(STATS_REL);

    // 긍정 앵커 — 파일이 실재하고 이 칸의 통계 컨테이너다(빈 파일 공허 통과 차단).
    expect(stats).toContain('reflection-daily-stats');
    // 값 폰트 22(현행 20 → 22).
    expect(stats).toContain('text-[22px]');
    expect(stats).not.toContain('text-[20px]');
    // 세로 구분선(w-px) 제거 — 3분할 hairline 카드에 칸막이 없음.
    expect(stats).not.toContain('w-px');
  });
});

describe('G0b · 추출 헬퍼 자가검사 — testID→className, text→className 이 실제로 집는다', () => {
  it('classNamesForTestId 는 그 testID 요소의 className 을 집고, 없으면 빈 배열', () => {
    const sample =
      '<View testID="box" className="bg-x rounded-y" />\n<View testID="box" className="bg-z" />';

    // 같은 testID 2개 → 각 요소 className 을 순서대로.
    expect(classNamesForTestId(sample, 'box')).toEqual([
      'bg-x rounded-y',
      'bg-z',
    ]);
    // 없는 testID → 빈 배열(부정 단언이 공허해지지 않게 호출부가 length 앵커를 둔다).
    expect(classNamesForTestId(sample, 'nope')).toEqual([]);
  });

  it('classNameOfText 는 그 텍스트를 감싼 Text 의 className 을 집는다', () => {
    const sample = '<Text className="a text-primary">다시 시도</Text>';

    expect(classNameOfText(sample, '다시 시도')).toBe('a text-primary');
    expect(classNameOfText(sample, '없는텍스트')).toBe('');
  });
});

describe('🔴 AC-9 · 사진 없음·에러 박스 채움(bg-surface-soft)', () => {
  it('에러 박스와 사진 없음 박스 className 에 bg-surface-soft 가 있다', () => {
    const screen = readOne(SCREEN_REL);

    // 에러 박스 — 정확히 1개를 집었는지(앵커) → border-dashed(앵커) → 채움(🔴).
    const errorBox = classNamesForTestId(screen, 'reflection-daily-error');
    expect(errorBox).toHaveLength(1);
    expect(errorBox[0]).toContain('border-dashed'); // 실제 그 박스 className 을 집었다.
    expect(errorBox[0]).toContain('bg-surface-soft'); // 현재 흰 배경 → red.

    // 사진 없음 박스 — default·data-insufficient 두 얼굴에 각 1개(2개) 전부 채움.
    const photoBoxes = classNamesForTestId(
      screen,
      'reflection-daily-photo-empty'
    );
    expect(photoBoxes.length).toBeGreaterThanOrEqual(1); // 앵커 — 최소 1개는 집혔다.
    photoBoxes.forEach((cls) => {
      expect(cls).toContain('border-dashed');
      expect(cls).toContain('bg-surface-soft'); // 현재 흰 배경 → red.
    });
  });
});

describe('🔴 AC-10 · 에러 "다시 시도" 글자색 ink(옛 코랄 text-primary 부재)', () => {
  it('"다시 시도" Text className 이 text-ink 이고 옛 text-primary 는 없다', () => {
    const screen = readOne(SCREEN_REL);
    const retry = classNameOfText(screen, '다시 시도');

    // 긍정 앵커 — 실제 그 Text className 을 집었다(빈 문자열 공허 통과 차단).
    expect(retry).toContain('text-label');
    // 글자색 ink(🔴 현재 text-primary).
    expect(retry).toContain('text-ink');
    // 부정 짝 — 옛 코랄 글자색 부재(아이콘 코랄은 글리프 내부라 스캔 밖).
    expect(retry).not.toContain('text-primary');
  });
});

describe('🔴 AC-11 · 빈 원 60(옛 72 부재)', () => {
  it('EmptyCircleGlyph 가 size={60} 이고 옛 size={72} 는 없다', () => {
    const screen = readOne(SCREEN_REL);

    // 긍정 앵커 — 빈 원 글리프를 실제로 쓴다(빈 파일 공허 통과 차단).
    expect(screen).toContain('EmptyCircleGlyph');
    // 60px(🔴 현재 72). 공백 허용 정규식으로 포매팅 흔들림 흡수.
    expect(screen).toMatch(/EmptyCircleGlyph\s+size=\{60\}/);
    expect(screen).not.toMatch(/EmptyCircleGlyph\s+size=\{72\}/);
  });
});
