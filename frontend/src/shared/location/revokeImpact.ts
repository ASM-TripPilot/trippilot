/** 위치 동의 철회의 영향(BR-U6-30) — 무엇을 멈추고 무엇을 계속하나. */
export interface RevokeImpact {
  // readonly — 소비처가 `as const` 상수를 그대로 넘길 수 있게 넓힌다(불변 목록이라 읽기 전용이 맞다).
  stops: readonly string[];
  continues: readonly string[];
}

/**
 * 철회 고지 문안을 한 곳에서 조립한다(순수). 철회 다이얼로그(중단3+계속2 구조화 리스트, Q1 확정)와
 * default "꺼도 계속 동작해요" 배너(계속2)가 이 한 함수를 함께 소비해 문구 중복을 없앤다
 * (`deletionScope` 단일 소유와 동형). 자구가 곧 BR-U6-30 의 법적/동의 고지 계약이다.
 */
export function revokeImpact(
  options: { automation?: boolean } = {}
): RevokeImpact {
  return {
    stops: [
      '이동 지연 알림',
      '실시간 Plan-B 재계획',
      '현 위치 기반 추천',
      // TRIP-1341 · BR-U6-30 개정(G-U10-8) — 플래그 ON 빌드에서만. 철회 시 기기·서버 경로를 지운다(BR-U10-42·43).
      ...(options.automation
        ? ['자동 방문 기록·이동 경로 (저장된 경로 삭제)']
        : []),
    ],
    continues: ['예정 일정 알림', '날씨·휴무 트리거'],
  };
}
