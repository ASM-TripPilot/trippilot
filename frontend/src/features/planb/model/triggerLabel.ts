import type { TriggerKind, TriggerVariant } from '@/shared/api/index.schemas';

/**
 * TRIP-561 · triggerLabel — 트리거 kind → 정적 {문구 요지, 아이콘키} 순수 매핑(BR-U4-01).
 *
 * 정적 축만 진다: 입력이 kind(+ 상황 감지 FE-B 의 변형)뿐이라 상세 사유("비 예보 70%")는 안 받는다 — 그건 서버
 * `reason` 런타임 값이고, 페이지가 이 요지(label)와 reason 을 이어 배너 문구를 조립한다.
 *
 * 종류는 정확히 4종(WEATHER·CLOSURE·DELAY·MANUAL)뿐 — '교통'은 존재하지 않는 종류이고
 * '체류 초과'는 DELAY 의 payload 변형이라 별도 kind 가 아니다. MANUAL 도 매핑을 가지되 화면
 * 표시는 페이지가 걸러 3변형만 그린다(표시 필터와 종류 완전성은 다른 축).
 *
 * node-safe: RN 런타임을 import 하지 않는다(`import type` 만) — 구조가드가 node 환경에서
 * 소스를 스캔·import 하므로. `iconKey` 는 컴포넌트가 아니라 **문자열 키**다(페이지가 글리프로
 * 매핑) — 그래야 이 모듈이 react-native 를 안 문다(`replanScope.ts` 선례).
 */

export interface TriggerLabel {
  /** kind 별 고정 요지(배너 "{요지} · {reason}" 의 앞부분). */
  label: string;
  /** 페이지가 글리프로 매핑할 문자열 키. */
  iconKey: string;
}

export const TRIGGER_LABELS: Record<TriggerKind, TriggerLabel> = {
  WEATHER: { label: '비 예보', iconKey: 'weather' },
  CLOSURE: { label: '휴무', iconKey: 'closure' },
  DELAY: { label: '이동 지연', iconKey: 'delay' },
  MANUAL: { label: '변경 요청', iconKey: 'manual' },
};

/**
 * 상황 감지 FE-B · frontend-components §3.4 — 변형(`variant`, C9 닫힌 12종) → 화면 라벨.
 * `Record` 라 서버 enum 이 늘면(codegen) tsc 가 빠진 줄을 잡는다. 라벨 값은 정본 표 그대로다.
 */
export const VARIANT_LABELS: Record<NonNullable<TriggerVariant>, string> = {
  RAIN: '비 예보',
  SNOW: '눈 예보',
  WIND: '강풍',
  HEAT: '폭염',
  COLD: '한파',
  CLOUD: '흐림',
  DUST: '미세먼지',
  CLOSED_DAY: '휴무',
  OUT_OF_HOURS: '영업시간 밖',
  HOURS_MISMATCH: '영업시간 확인',
  HOLIDAY: '공휴일 휴무',
  PERMANENTLY_CLOSED: '폐업',
};

/** 표에 있는 변형인가 — 생성 타입 밖 문자열(새 서버·되돌린 서버)·프로토타입 키를 거른다. */
export function isKnownVariant(
  variant: TriggerVariant | undefined
): variant is NonNullable<TriggerVariant> {
  // 평범한 인덱싱은 'toString'·'constructor' 를 라벨로 읽는다 — 자기 키만 본다(`shared/lib/placeCover` 의 `hasOwnProperty` 조회와 같은 방어).
  return (
    typeof variant === 'string' &&
    Object.prototype.hasOwnProperty.call(VARIANT_LABELS, variant)
  );
}

/**
 * 변형을 알면 그 라벨 + kind 의 iconKey(글리프 축은 kind 그대로), 모르거나 없으면 kind 라벨(`TRIGGER_LABELS` 무변경).
 */
export function triggerLabel(
  kind: TriggerKind,
  variant?: TriggerVariant
): TriggerLabel {
  const base = TRIGGER_LABELS[kind];
  return isKnownVariant(variant)
    ? { label: VARIANT_LABELS[variant], iconKey: base.iconKey }
    : base;
}
