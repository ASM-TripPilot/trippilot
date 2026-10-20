/**
 * 서비스 지역 — 홈·탐색 레인이 묻는 지역과 지역 피커가 보여 줄 시도(2026-10-16 제품 결정, TRIP-1432).
 * 서버 카탈로그 전체가 아니라 고정된 결정 목록이라 이름까지 둔다(TRIP-445 "이름 상수표 금지"의 예외).
 * `name` 은 `/places?region=` 이 받는 서버 별칭(짧은 이름). 배열 순서가 곧 장소 조회 쿼리 키 순서라
 * 홈·탐색이 이 상수를 그대로 넘겨야 응답 캐시를 나눠 쓴다.
 */
export const SERVICE_REGIONS: readonly { code: string; name: string }[] = [
  { code: '11', name: '서울' },
  { code: '26', name: '부산' },
  { code: '50', name: '제주' },
  // U10 실기 테스트 지역(2026-10-20) — 빌드 환경값 `EXPO_PUBLIC_TEST_REGIONS="41190:부천"` 가 있을 때만 뒤에 붙는다.
  // 스토어(production) 빌드는 값이 없어 제품 결정 3곳 그대로다. 테스트가 끝나면 eas.json 의 값과 함께 지운다.
  ...(process.env.EXPO_PUBLIC_TEST_REGIONS ?? '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const [code, name] = pair.split(':');
      return { code, name };
    }),
];
