import type { TriggerKind } from '@/shared/api/generated/schemas';

/**
 * TRIP-561 · triggerLabel — 트리거 kind → 정적 {문구 요지, 아이콘키} 순수 매핑(BR-U4-01).
 *
 * 정적 축만 진다: 입력이 kind 하나뿐이라 상세 사유("비 예보 70%")는 안 받는다 — 그건 서버
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
  CLOSURE: { label: '휴무 확인', iconKey: 'closure' },
  DELAY: { label: '이동 지연', iconKey: 'delay' },
  MANUAL: { label: '변경 요청', iconKey: 'manual' },
};

export function triggerLabel(kind: TriggerKind): TriggerLabel {
  return TRIGGER_LABELS[kind];
}
