/**
 * TRIP-440 · AC-7 · PBT-U4-F2 — slackTime: 여유는 **두 확정 시각의 차**(BR-U4-24)다.
 *
 * from·toFixed 는 "HH:mm" 또는 "HH:mm:ss". 초는 버리고 시·분만 쓴다(`resolveSlackLabel` 선례).
 * `.split(':')`로 쪼개 분 단위로 환산한 뒤 그 차를 세 포맷으로 낸다(D2):
 *  - diff >= 60 → `여유 N시간 M분`  (60 경계는 `여유 1시간 0분` — 0분도 항상 표기)
 *  - 0 < diff < 60 → `여유 N분`
 *  - diff <= 0 → `여유 없음`        (다음 고정이 이미 지남 — 숫자 없는 정성 라벨로 음수 회피)
 *
 * `여유 N시간 M분`은 두 고정 시각의 간격이라 INV-3(소요시간) 위반이 아니다 — 그래도 이 숫자 포맷은
 * **오직 이 model 파일에서만** 만든다. ui(SlotCandidateSheet)는 `{slackLabel}` 변수로만 렌더한다.
 * `new Date`/`Date.now`/날짜 라이브러리를 안 써 재현 결정론이다(wall-clock 미사용, PBT-U4-F2 심판).
 */

/** "HH:mm(:ss)" → 분(시·분만, 초 버림). */
function toMin(clock: string): number {
  const [hh, mm] = clock.split(':');
  return Number(hh) * 60 + Number(mm);
}

export function slackTime(from: string, toFixed: string): string {
  const diff = toMin(toFixed) - toMin(from);
  if (diff <= 0) return '여유 없음';
  if (diff < 60) return `여유 ${diff}분`;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return `여유 ${hours}시간 ${mins}분`;
}
