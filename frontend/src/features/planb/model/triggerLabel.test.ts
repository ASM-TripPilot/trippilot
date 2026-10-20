import type { TriggerKind } from '@/shared/api/index.schemas';
import { TriggerVariant } from '@/shared/api/index.schemas';

import { TRIGGER_LABELS, VARIANT_LABELS, triggerLabel } from './triggerLabel';

/**
 * TRIP-561 · AC-5 · BR-U4-01 — triggerLabel 순수 매핑(정적 라벨 vs 동적 reason 경계).
 *
 * 무엇을 보장하나:
 *  - triggerLabel 은 **kind 하나만** 받아 kind 별 정적 `{label, iconKey}` 를 돌려준다. 상세 사유
 *    ("비 예보 70%")는 서버 `reason` 런타임 값이라 이 순수 함수가 모른다 — 정적 축만 잰다(★2).
 *  - 종류 집합은 정확히 4종(WEATHER·CLOSURE·DELAY·MANUAL) — 5번째 kind 를 매핑하지 않는다(BR-U4-01).
 *  - 라벨 문자열 리터럴은 정본에 없어 **발명하지 않는다** — "비어있지 않음 + 4종 전부 + iconKey
 *    정의됨" 구조만 잰다(categoryPlaceholder.test.ts ★6 선례). 단 표시 3종(WEATHER·DELAY·CLOSURE)
 *    값은 TRIP-748 이 Figma i02 배지 문구로 확정했다 — T4 가 그 값만 잠근다(MANUAL 은 미표시라 제외).
 *
 * 개념: **순수 함수** — 같은 입력이면 같은 출력, 바깥 상태를 안 읽는다. 그래서 kind→라벨 매핑을
 * 표(`TRIGGER_LABELS`)로 두고 열거해 4종을 검사할 수 있다.
 */

const KINDS: TriggerKind[] = ['WEATHER', 'CLOSURE', 'DELAY', 'MANUAL'];

describe('triggerLabel — kind→{label, iconKey} 정적 매핑', () => {
  it('T1 정확히 4종을 매핑하고 각 라벨은 비어있지 않으며 iconKey 가 정의된다', () => {
    // 준비/실행: 매핑 표를 열거한다.
    // 단언: 키가 정확히 4종(정렬 비교로 순서 무관).
    expect(Object.keys(TRIGGER_LABELS).sort()).toEqual(
      ['CLOSURE', 'DELAY', 'MANUAL', 'WEATHER'].sort()
    );

    for (const kind of KINDS) {
      const entry = TRIGGER_LABELS[kind];
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      // iconKey 는 페이지가 글리프로 매핑할 문자열 키 — 값은 발명하지 않고 "정의됨"만 잰다.
      expect(entry.iconKey).toBeDefined();
      expect(String(entry.iconKey).length).toBeGreaterThan(0);
    }
  });

  it('T2 triggerLabel(kind) 는 reason 없이 kind 만으로 매핑 표를 조회한다', () => {
    // 정적 축: 입력이 kind 하나뿐 — reason 을 안 받는다(동적 사유와 분리).
    for (const kind of KINDS) {
      expect(triggerLabel(kind)).toEqual(TRIGGER_LABELS[kind]);
    }
  });

  it('T4 표시 라벨 3종은 Figma i02 배지 문구다 — 비 예보 · 이동 지연 · 휴무 (TRIP-748 AC-9)', () => {
    // 알약 카피 앞부분이자 영향 카드 배지 글자다(Figma 4041:2427 · 4078:2477 · 4081:2502).
    expect(TRIGGER_LABELS.WEATHER.label).toBe('비 예보');
    expect(TRIGGER_LABELS.DELAY.label).toBe('이동 지연');
    expect(TRIGGER_LABELS.CLOSURE.label).toBe('휴무');
  });

  it('T3 매핑 값 어디에도 발명 금칙어(교통·체류 초과)가 없다', () => {
    // '체류 초과'는 DELAY 의 payload 변형, '교통'은 존재하지 않는 종류(BR-U4-01).
    const serialized = JSON.stringify(TRIGGER_LABELS);
    expect(serialized).not.toContain('교통');
    expect(serialized).not.toContain('체류 초과');
  });
});

/**
 * 상황 감지 FE-B · frontend-components §3.4 — 변형(`variant`) 라벨.
 *
 * 무엇을 보장하나:
 *  - 변형 12종의 라벨은 정본 표 그대로다(라벨 문자열 완전 일치 — 정본이 정한 값이라 발명이 아니다).
 *  - 표의 키는 생성 타입 `TriggerVariant` 12종과 정확히 같다(서버가 변형을 늘리면 tsc·이 단언이 먼저 운다).
 *  - `triggerLabel(kind, variant)` 는 변형 라벨에 **kind 의 iconKey** 를 붙인다(글리프 축은 kind 그대로).
 *  - 변형이 없거나(null·undefined) 모르는 값이면 kind 라벨 그대로 — `TRIGGER_LABELS` 는 바뀌지 않는다(옛 서버·되돌린 서버에 무해).
 *
 * 3동작: 준비(kind·variant) → 실행(triggerLabel) → 단언(label·iconKey).
 */
describe('triggerLabel — 변형 라벨 (상황 감지 FE-B · §3.4)', () => {
  it.each([
    ['RAIN', '비 예보'],
    ['SNOW', '눈 예보'],
    ['WIND', '강풍'],
    ['HEAT', '폭염'],
    ['COLD', '한파'],
    ['CLOUD', '흐림'],
    ['DUST', '미세먼지'],
    ['CLOSED_DAY', '휴무'],
    ['OUT_OF_HOURS', '영업시간 밖'],
    ['HOURS_MISMATCH', '영업시간 확인'],
    ['HOLIDAY', '공휴일 휴무'],
    ['PERMANENTLY_CLOSED', '폐업'],
  ] as const)('V1 %s → "%s"', (variant, label) => {
    expect(VARIANT_LABELS[variant]).toBe(label);
  });

  it('V2 표의 키는 생성 TriggerVariant 12종과 정확히 같다', () => {
    expect(Object.keys(VARIANT_LABELS).sort()).toEqual(
      Object.values(TriggerVariant).sort()
    );
    expect(Object.keys(VARIANT_LABELS)).toHaveLength(12);
  });

  it('V3 변형이 있으면 그 라벨 + kind 의 iconKey 다', () => {
    expect(triggerLabel('WEATHER', 'HEAT')).toEqual({
      label: '폭염',
      iconKey: TRIGGER_LABELS.WEATHER.iconKey,
    });
    expect(triggerLabel('CLOSURE', 'PERMANENTLY_CLOSED')).toEqual({
      label: '폐업',
      iconKey: TRIGGER_LABELS.CLOSURE.iconKey,
    });
  });

  it('V4 변형이 null·undefined·모르는 값이면 kind 라벨 그대로다', () => {
    for (const kind of KINDS) {
      expect(triggerLabel(kind, null)).toEqual(TRIGGER_LABELS[kind]);
      expect(triggerLabel(kind, undefined)).toEqual(TRIGGER_LABELS[kind]);
      // 서버가 새 변형을 먼저 내보낸 옛 앱 — 생성 타입 밖 문자열이 와도 kind 라벨로 떨어진다.
      expect(
        triggerLabel(kind, 'TYPHOON' as unknown as TriggerVariant)
      ).toEqual(TRIGGER_LABELS[kind]);
    }
    // 프로토타입 키가 라벨로 새지 않는다(객체 조회 함정).
    expect(
      triggerLabel('WEATHER', 'toString' as unknown as TriggerVariant)
    ).toEqual(TRIGGER_LABELS.WEATHER);
  });

  it('V5 TRIGGER_LABELS 는 변형 도입 뒤에도 옛 값 그대로다(무변경)', () => {
    expect(TRIGGER_LABELS).toEqual({
      WEATHER: { label: '비 예보', iconKey: 'weather' },
      CLOSURE: { label: '휴무', iconKey: 'closure' },
      DELAY: { label: '이동 지연', iconKey: 'delay' },
      MANUAL: { label: '변경 요청', iconKey: 'manual' },
    });
  });
});
