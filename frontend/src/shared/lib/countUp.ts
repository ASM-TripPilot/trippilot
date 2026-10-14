/**
 * TRIP-1386 · 숫자 카운트업의 순수 계산(보간·포맷). 타이머·애니메이션은 호출 쪽 몫이다.
 * 표시 문자열(`12`·`38km`·`1.9km`)을 받아 숫자 앞부분만 0 에서 목표까지 올리고, 뒤 접미사(`km`)는 그대로 둔다 —
 * 중간값도 최종값과 같은 형식이라 형식이 중간에 바뀌거나 깜빡이지 않는다. 진행률 1 이상이면 입력 문자열 그대로(INV-2).
 */

/** ease-out cubic — 처음에 빠르게 오르고 끝에서 느려진다. 0→0, 1→1, 단조 증가. */
export function easeOutCubic(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - p, 3);
}

/** 0 이상 정수 목표값의 진행률(0~1)별 중간값 — 0 이상 목표값 이하 정수, 진행률 1 에서 목표값. */
export function countUpInt(target: number, progress: number): number {
  if (progress >= 1) return target;
  return Math.min(target, Math.round(target * easeOutCubic(progress)));
}

const NUMBER_PREFIX = /^(\d+(?:\.(\d+))?)([\s\S]*)$/;

/** 카운트업이 의미 있는 목표값(0 보다 큰 숫자로 시작하는 문자열) 인가. `—`·`0`·`0km` 는 아니다. */
export function isCountable(text: string): boolean {
  const m = NUMBER_PREFIX.exec(text);
  return m !== null && Number(m[1]) > 0;
}

/**
 * 표시 문자열의 진행률별 중간 문자열. 숫자로 시작하지 않거나(`—`) 목표가 0 이면 입력 그대로.
 * 소수 자릿수는 목표의 자릿수까지만 쓰고 끝 `.0` 은 뗀다(`formatKm` 과 같은 규칙).
 */
export function countUpText(text: string, progress: number): string {
  const m = NUMBER_PREFIX.exec(text);
  if (m === null || progress >= 1) return text;
  const target = Number(m[1]);
  if (target <= 0) return text;
  const scale = Math.pow(10, m[2]?.length ?? 0);
  const value = Math.min(
    target,
    Math.round(target * easeOutCubic(progress) * scale) / scale
  );
  return `${value}${m[3]}`;
}
