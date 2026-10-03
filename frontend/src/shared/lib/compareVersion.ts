/**
 * 앱 버전 문자열(`"1.2.3"` 형태)을 semver 규칙으로 비교한다.
 *
 * force-update 게이트는 `compareVersion(currentAppVersion, serverMinVersion)`를 호출하고
 * 결과가 `-1`(현재 버전이 요구 최소치보다 엄격히 낮음)일 때만 강제 업데이트를 발동한다.
 *
 * 파싱 불가 입력은 페일오픈: 판정 불가를 동률(`0`)로 취급해 게이트가 발동하지 않는다.
 * 버전 문자열이 깨졌다는 이유로 사용자를 강제 업데이트에 가두지 않는다.
 */
function parseVersion(value: string): number[] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)*$/.test(trimmed)) {
    return null;
  }
  return trimmed.split('.').map((part) => Number.parseInt(part, 10));
}

export function compareVersion(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === null || right === null) {
    return 0;
  }
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x < y) {
      return -1;
    }
    if (x > y) {
      return 1;
    }
  }
  return 0;
}
