import type { TriggerKind } from '@/shared/api/generated/schemas';

import { TRIGGER_LABELS, triggerLabel } from './triggerLabel';

/**
 * TRIP-561 · AC-5 · BR-U4-01 — triggerLabel 순수 매핑(정적 라벨 vs 동적 reason 경계).
 *
 * 무엇을 보장하나:
 *  - triggerLabel 은 **kind 하나만** 받아 kind 별 정적 `{label, iconKey}` 를 돌려준다. 상세 사유
 *    ("비 예보 70%")는 서버 `reason` 런타임 값이라 이 순수 함수가 모른다 — 정적 축만 잰다(★2).
 *  - 종류 집합은 정확히 4종(WEATHER·CLOSURE·DELAY·MANUAL) — 5번째 kind 를 매핑하지 않는다(BR-U4-01).
 *  - 라벨 문자열 리터럴은 정본에 없어 **발명하지 않는다** — "비어있지 않음 + 4종 전부 + iconKey
 *    정의됨" 구조만 잰다(categoryPlaceholder.test.ts ★6 선례).
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

  it('T3 매핑 값 어디에도 발명 금칙어(교통·체류 초과)가 없다', () => {
    // '체류 초과'는 DELAY 의 payload 변형, '교통'은 존재하지 않는 종류(BR-U4-01).
    const serialized = JSON.stringify(TRIGGER_LABELS);
    expect(serialized).not.toContain('교통');
    expect(serialized).not.toContain('체류 초과');
  });
});
