/**
 * TRIP-354 · 날짜헤더 총이동거리 라벨 — 슬롯들의 `distanceRange` 서버 문자열을 느슨하게
 * 파싱·미터 정규화·합산해 "이동 3.2km"(또는 null)를 만든다(01b Seed §C · Q2).
 *
 * INV-3: duration 절대 미표시·미저장. 거리·이동수단만.
 *
 * 화면 호출부: `legDistance(slots.map((s) => s.distanceRange))`.
 */

/**
 * 거리 문자열에서 **숫자+단위(km|m)만** 뽑는 느슨한 파서 정규식.
 *
 * `km` 를 `m` 보다 **먼저** 두는 것이 핵심이다 — 교대(alternation)는 왼쪽부터 시도하므로,
 * "3.1km" 를 만나면 `km` 가 먼저 잡혀 `3.1`+`km` 로 갈린다. `m` 을 먼저 두면 잘못 매칭될 위험이
 * 있어(02a ★8) 순서를 고정한다. `약 …`, `· 도보 추정` 같은 앞뒤 꼬리는 첫 매치 밖이라 무시된다.
 */
const DISTANCE_UNIT = /(\d+(?:\.\d+)?)\s*(km|m)/;

/**
 * 한 거리 문자열을 미터로 환산한다. **반환 규약이 셋으로 갈린다:**
 *  - `null`/`undefined`/`''` (스킵 대상) → 여기 오기 전에 걸러지므로 다루지 않는다.
 *  - 숫자+단위를 **못 뽑음**(present-but-broken) → `null`.
 *  - 뽑음 → 미터 값(number). km 는 ×1000.
 */
function parseMeters(range: string): number | null {
  const match = DISTANCE_UNIT.exec(range);
  if (match === null) return null;
  const value = Number(match[1]);
  return match[2] === 'km' ? value * 1000 : value;
}

/**
 * 슬롯들의 `distanceRange` 배열을 합산해 "이동 X" 라벨 또는 `null` 을 만든다.
 *
 * 무엇을 보장하나:
 *  - **스킵**: `null`·`undefined`·`''` 슬롯은 조용히 건너뛴다(실패 아님).
 *  - **broken → 그날 줄 접기**: 값이 있으나 숫자+단위를 못 뽑는 슬롯이 **하나라도** 있으면 `null`
 *    (실제보다 적은 틀린 숫자보다 침묵이 낫다).
 *  - **합계 0 → null**: 전부 스킵됐거나 합이 0이면 헤더에 아무 것도 안 그린다("{N}곳"만).
 *  - **표시 형식**: `<1000m` → 가장 가까운 10m("이동 820m") / `≥1000m` → 소수 1자리("이동 3.2km").
 *    반올림은 `Math.round`(round-half-up) — 825m→830m, 3280m→3.3km.
 *
 * *(개념)* **순수 함수** — 같은 입력이면 항상 같은 출력, 바깥 상태를 읽지도 바꾸지도 않는다.
 */
export function legDistance(
  distanceRanges: readonly (string | null | undefined)[]
): string | null {
  let totalMeters = 0;
  for (const range of distanceRanges) {
    if (range === null || range === undefined || range === '') continue;
    const meters = parseMeters(range);
    if (meters === null) return null; // present-but-broken → 그날 줄 접기
    totalMeters += meters;
  }

  if (totalMeters === 0) return null;

  if (totalMeters < 1000) {
    const rounded = Math.round(totalMeters / 10) * 10;
    return `이동 ${rounded}m`;
  }

  const km = Math.round(totalMeters / 100) / 10;
  return `이동 ${km.toFixed(1)}km`;
}
