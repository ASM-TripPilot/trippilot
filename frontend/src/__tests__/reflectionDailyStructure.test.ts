/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

/**
 * TRIP-762 · AC-4 — j03 통계 재구성 소스 가드(값 폰트 22 · 세로 구분선 제거).
 *
 * 왜 소스 스캔인가: "값 22"는 폰트 크기(`text-[22px]`, 현행 `text-[20px]`)이고 "구분선"은 텍스트도
 * testID 도 없는 `w-px` 세로 View 다 — 렌더 트리에서 "그 노드 하나"를 집어 색·치수를 읽는 것보다,
 * NativeWind 가 트리에 평문으로 남기는 className 리터럴을 소스에서 직접 대조하는 쪽이 오탐이 없다
 * (reflectionStructure·shareCardStructure 소스 가드 관례). 거동(distanceDash→"—")은 렌더 테스트
 * (`DailyReflectionScreen.default.test.tsx` AC-4)가 맡는다.
 *
 * **전제**: 스캔은 주석을 걷은 소스를 본다(`stripComments`) — 근거를 주석에 적는 리포 관례에서
 * 주석 속 `w-px` 산문이 부정 단언을 거짓 red 로 만들지 않게. **가짜 통과 방지**: "없어야 한다"는
 * 같은 it 안 "있어야 한다"와 짝을 이룬다.
 */

const ROOT = path.resolve('src');
const STATS_REL = 'features/reflection/ui/ReflectionStatsRow.tsx';

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
