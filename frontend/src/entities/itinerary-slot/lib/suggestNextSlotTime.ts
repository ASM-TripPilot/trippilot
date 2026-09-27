const FALLBACK = { startAt: '10:00:00', endAt: '11:00:00' };
const SPAN_MINUTES = 60;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * TRIP-1009 · 새 장소 시각 시트의 기본값 제안 — 앞 장소가 끝나는 시각부터 1시간(01b Q1).
 * 앞 장소가 없거나 자정을 넘겨 끝났으면 10:00–11:00(01b Q2-a). 23시 이후 시작이면 종료가 `00:xx` 로
 * 돈다 — `endsNextDay` 는 여기서 만들지 않는다(TimeSheet 가 `deriveEndsNextDay` 로 유도, 한 벌 규칙).
 * 제안값일 뿐 시각 재추정이 아니다 — 최종 판정은 저장 시 서버 재검증(INV-2).
 */
export function suggestNextSlotTime(previous?: {
  endAt: string;
  endsNextDay: boolean;
}): { startAt: string; endAt: string } {
  if (!previous || previous.endsNextDay) return { ...FALLBACK };
  const startAt = `${previous.endAt.slice(0, 5)}:00`;
  const end =
    (Number(startAt.slice(0, 2)) * 60 +
      Number(startAt.slice(3, 5)) +
      SPAN_MINUTES) %
    (24 * 60);
  return { startAt, endAt: `${pad(Math.floor(end / 60))}:${pad(end % 60)}:00` };
}
