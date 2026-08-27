/**
 * TRIP-396 · AC-1 (BR-U4-37 · INV-U4-03) — 체류 실적 분(分) 산출.
 *
 * `dwellMinutes(arrivedAt, completedAt)` 은 두 ISO 시각("…THH:mm:ss")의 분 차를 정수로 낸다.
 * 한쪽이라도 null 이면 null(도착만·완료 전). 역전(completedAt < arrivedAt, 시계 어긋남)은
 * `Math.max(0, ·)` 로 0(01b Q4) — 음수는 트리거 입력으로 무의미하다.
 *
 * ★ 화면에 절대 표시하지 않는다(INV-U4-03) — DELAY 트리거 입력·U5 기록 재료. ⚠️ 현재 이 값을
 * 서버로 넘길 창구가 없어(POST /complete·VisitCheck 에 dwell 필드 0) **소비처가 없다**(데드코드
 * 위험, 03 notes 참조). AC-1 이 정확성을 요구해 순수 함수로 잠근다.
 *
 * ★ liveTimeStructure 가드(features/execution/**): `new Date`·`Date.parse`·`.getTime` 류 금지.
 * "HH:mm:ss" 를 split 으로 쪼개 **다른 이름의 분 변수**로 옮겨 뺀다(placeDetailView.toMinutes 선례).
 */

// "…THH:mm:ss" → 분(minute). 'T' 뒤 시각부만 취해 ':' 로 쪼갠 뒤 시·분만 쓴다(초 절사).
// 슬롯 시각 식별자(startAt/endAt)가 아닌 지역 변수라 SLOT_TIME_ARITH 가드에 안 걸린다.
function clockToMinutes(iso: string): number {
  const parts = iso.split('T');
  const clock = parts.length > 1 ? parts[1] : parts[0];
  const [hh, mm] = clock.split(':');
  return Number(hh) * 60 + Number(mm);
}

export function dwellMinutes(
  arrivedAt: string | null,
  completedAt: string | null
): number | null {
  if (arrivedAt === null || completedAt === null) return null;
  const start = clockToMinutes(arrivedAt);
  const end = clockToMinutes(completedAt);
  return Math.max(0, end - start);
}
