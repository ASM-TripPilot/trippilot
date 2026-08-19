/**
 * TRIP-335 슬라이스2 · AC-4 (h15 · BR-U3-25 · INV-2) — 서버가 실제로 쓴 반경 `radiusMUsed`(미터,
 * number)를 Figma 표기("약 X.Xkm")로 포맷한다.
 *
 * 왜 포맷하나: 계약상 `radiusMUsed` 는 **숫자(미터)**다(브리프가 문자열로 모델링한 것과 드리프트).
 * "그대로 표시"를 문자 그대로 하면 "11300"이 뜬다. 어느 반경을 쓸지는 **서버가 정하고**(INV-2 —
 * 클라가 반경을 지어내면 위반), 클라는 그 값을 포맷만 한다. 반올림은 `legDistance` 방식을 그대로
 * 재사용한다(서버 값/문자열을 표시로 환원하는 것은 발명이 아니다).
 *
 * '약'(≈) 접두 = 서버 파생값(AI 자동 확대 가능)임을 알리는 신호(Figma h15).
 *
 *  - `< 1000m` → 10m 단위 반올림 유지("약 700m")
 *  - `>= 1000m` → 소수 1자리 km("약 11.3km") · 1000m 경계는 "약 1.0km"
 */
export function formatRadiusUsed(radiusMUsed: number): string {
  if (radiusMUsed < 1000) {
    const rounded = Math.round(radiusMUsed / 10) * 10;
    return `약 ${rounded}m`;
  }
  const km = Math.round(radiusMUsed / 100) / 10;
  return `약 ${km.toFixed(1)}km`;
}
