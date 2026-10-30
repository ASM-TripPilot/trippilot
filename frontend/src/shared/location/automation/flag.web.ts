/** TRIP-1648 · 웹 번들용 — 빌드 값과 무관하게 항상 꺼짐. 웹엔 백그라운드 위치·지오펜스가 없다(BR-U10-07 의 플래그 OFF 상태로 해석). */
export function isLocationAutomationEnabled(): boolean {
  return false;
}

// 시그니처 대조 — 실 모듈(flag.ts) 타입이 바뀌면 여기서 빨개진다.
void ({ isLocationAutomationEnabled } satisfies typeof import('./flag'));
