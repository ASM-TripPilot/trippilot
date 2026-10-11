/**
 * U10 위치 자동화 임계 기본값 — **한 곳에서만** 정의한다(DEC-U10-22 · O-U10-2 · NFR P-PRIV-U10-1).
 * 값 조정은 규칙 개정이 아니다(설정값). 실측 조정은 6-b(O-U10-2) 몫.
 *
 * INV-3: 속도·걸음 수·소요시간 값은 두지 않는다 — 시각 값은 판정 창(체류 확인·공백 분할)용이며 화면에 나가지 않는다.
 */
export const AUTOMATION_CONFIG = {
  /** 지오펜스 리전 반경(BR-U10-13). */
  geofenceRadiusM: 150,
  /** 판정 근거로 쓰는 표본 정확도 상한(BR-U10-12). 넘는 표본은 버린다. */
  maxAccuracyM: 100,
  /** 진입 후 이탈 없이 지나야 도착을 확정하는 창(BR-U10-14·15). */
  arriveDwellMs: 3 * 60_000,
  /** 자동 완료에 필요한 도착~이탈 최소 간격(BR-U10-17·18). */
  minStayForCompleteMs: 10 * 60_000,
  /** 이탈 확정 창 — 이 안에 재진입하면 이탈 취소(BR-U10-16). */
  exitConfirmMs: 3 * 60_000,
  /** OS 등록 리전 합계 상한(BR-U10-09). */
  maxRegions: 10,
  /** 경로 기록·다운샘플(BR-U10-34~37 · NFR P-PRIV-U10-1). */
  route: {
    /** RDP 허용 오차 ε₀. */
    toleranceM: 15,
    /** 하루 출력 점 상한 N_max(전 세그먼트 합). */
    maxPoints: 2000,
    /** 하루 세그먼트 상한 S_max. */
    maxSegments: 200,
    /** 표본 간격이 이보다 길면 세그먼트를 끊는다. */
    gapMs: 10 * 60_000,
    /** 연속 표본 사이 거리가 이보다 길면 세그먼트를 끊는다. */
    jumpM: 1000,
    /** 닻(체류 지점·세그먼트 끝점) 배제 반경 R_priv. */
    privacyRadiusM: 150,
    /** 체류 탐지 반경 D_stop. */
    stopRadiusM: 100,
    /** 체류 탐지 최소 머묾 T_stop. */
    stopMs: 3 * 60_000,
  },
  /** 백그라운드 경로 기록 파라미터(MOBILE-U10-02) — 네이티브 어댑터가 그대로 넘긴다. */
  recording: {
    distanceIntervalM: 50,
    deferredUpdatesIntervalMs: 120_000,
    deferredUpdatesDistanceM: 250,
  },
} as const;

export type AutomationConfig = typeof AUTOMATION_CONFIG;
