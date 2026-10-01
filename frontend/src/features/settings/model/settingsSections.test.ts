import fc from 'fast-check';

import {
  PreferenceInputActivitiesItem,
  PreferenceInputBudgetTier,
  PreferenceInputCompanionTypesItem,
  PreferenceInputFoodTastesItem,
  PreferenceInputPace,
  PreferenceInputStylesItem,
  PreferenceInputTransportModesItem,
  type PreferenceView,
} from '@/shared/api/generated/schemas';

import { buildSettingsSections } from './settingsSections';

/**
 * TRIP-608 AC-1 · AC-11 — l05 설정 그룹 뷰모델 조립.
 *
 * 무엇을 보장하나:
 *  (1) 7그룹을 **정본 순서**로 낸다(Figma 라이브 = 화면 유일 정본: 계정 → 여행 취향 → 위치정보 →
 *      알림 → 제휴 안내 → 위험 영역, 여기에 TRIP-937 이 앱 정보를 위험 영역 앞에 더했다 — Figma 에
 *      없는 그룹이라 드리프트). 티켓 서술의 "개인화" 그룹은 없다(§8 드리프트, Figma 승).
 *  (5) TRIP-937 AC-3: 앱 정보 그룹의 약관 3행(문서 제목·rowKey·ready:true).
 *  (2) 계정 그룹 닉네임 행 요약값 = 닉네임(Q6 확정 — 닉네임만 표기).
 *  (3) email 이 null(소셜 MVP)이어도 요약이 안 깨진다 — 'null'/'undefined' 문자열이 새지 않는다.
 *  (4) TRIP-778 AC-2: 모든 행이 ready:true 다(취향 7·제휴·개인화 개통) — 그룹·행 key·label·ready 를
 *      완전일치 표로 잠근다. 구 "취향·제휴 ready:false" 단언은 계약 변경(01b 사용자 결정)으로 재작성.
 *  (7) TRIP-778 AC-5·6(모델 몫): 위치 동의 칩, 개인화 '사용 중' 값.
 *  (8) TRIP-1051: 여행 취향은 머리글 없는 그룹(label null)에 한 행 `N/7 설정됨` — 아래 describe.
 *  (6) TRIP-938 AC-6: 계정 그룹 마지막 행 = 로그아웃(ready:true). 그룹 수(7)는 그대로다.
 *
 * 3동작 뼈대: 준비=닉네임/이메일 입력 → 실행=buildSettingsSections → 단언=그룹/행 VM.
 *
 * (개념) 순수 함수 — 라이브값을 받아 그림 없는 자료(뷰모델)만 만든다. 화면은 이걸 그대로 그린다.
 */

/**
 * 정본 순서(Figma 라이브). 이 배열과 어긋나면 그룹이 빠졌거나 순서가 뒤집힌 것이다.
 * TRIP-937: `앱 정보`(약관·정책 행)를 제휴 안내와 위험 영역 사이에 더했다 — Figma l05·U6 BLM §3.3 에는
 * 없는 그룹이라 정본 드리프트다(01 Q7, 위험 영역은 맨 끝 관례 유지).
 */
const EXPECTED_GROUP_LABELS = [
  '계정',
  null, // TRIP-1051 결정 (a) — 여행 취향 그룹은 머리글이 없다(행 라벨과 같은 말 두 번 금지)

  '위치정보',
  '알림',
  '제휴 안내',
  '앱 정보',
  '위험 영역',
] as const;

describe('TRIP-608 · buildSettingsSections (AC-1 · AC-11)', () => {
  it('7그룹을 정본 순서로 낸다(TRIP-937 앱 정보 포함)', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: 'a@b.com',
    });

    // 단언(완전일치 · 순서까지): 그룹 라벨이 정본 배열과 정확히 같다.
    expect(groups.map((g) => g.label)).toEqual([...EXPECTED_GROUP_LABELS]);
  });

  it('계정 그룹 닉네임 행 요약값이 닉네임이다(Q6 — 닉네임만)', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: 'a@b.com',
    });

    const account = groups.find((g) => g.label === '계정');
    // 긍정 짝: 계정 그룹과 행이 실재한다(없으면 아래 단언이 공허해진다).
    expect(account).toBeDefined();
    expect(account!.rows.length).toBeGreaterThan(0);

    // 단언: 첫 행(닉네임·이메일)의 요약값이 닉네임과 같다.
    expect(account!.rows[0].value).toBe('여행자123');
  });

  it('AC-11: email 이 null 이어도 요약이 안 깨진다 — 닉네임만, null/undefined 누출 0', () => {
    // 준비: 소셜 로그인 계정(email null).
    const groups = buildSettingsSections({ nickname: '솔로', email: null });

    const account = groups.find((g) => g.label === '계정');
    const value = account!.rows[0].value;

    // 단언: 요약은 여전히 닉네임이다.
    expect(value).toBe('솔로');
    // 단언(없어야 한다): null/undefined 가 문자열로 새어 화면에 찍히지 않는다.
    expect(String(value)).not.toContain('null');
    expect(String(value)).not.toContain('undefined');
  });

  it('TRIP-938 AC-6: 계정 그룹 마지막 행이 [로그아웃](ready:true)이다 — 운영 필터를 통과한다', () => {
    // 준비
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    // 실행 — 계정 그룹의 행 key 순서와 로그아웃 행을 뽑는다.
    const account = groups.find((g) => g.label === '계정');
    expect(account).toBeDefined();
    const logoutRow = account!.rows.find((r) => r.key === 'logout');

    // 단언(완전일치 · 순서까지): 계정 그룹의 마지막 행이다(01 Q1 — 새 그룹을 만들지 않는다).
    expect(account!.rows.map((r) => r.key)).toEqual([
      'nickname',
      'export',
      'logout',
    ]);
    // 단언: 라벨과 ready:true — false 면 운영 화면 필터(filterReadySettingsSections)가 행을 숨긴다.
    expect(logoutRow).toEqual(
      expect.objectContaining({ label: '로그아웃', ready: true })
    );
  });

  it('TRIP-937 AC-3: 앱 정보 그룹에 약관 3행이 c06 순서·문서 제목·rowKey terms-{termsType}·ready:true 로 있다', () => {
    // 준비
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    // 실행 — 앱 정보 그룹에서 약관 행(terms- 접두)만 뽑는다. 형제 행(TRIP-886 데이터 출처 등)이
    // 나중에 붙어도 이 단언은 약관 3행만 본다.
    const appInfo = groups.find((g) => g.label === '앱 정보');
    expect(appInfo).toBeDefined();
    const termsRows = appInfo!.rows
      .filter((r) => r.key.startsWith('terms-'))
      .map((r) => [r.key, r.label, r.ready]);

    // 단언(완전일치 · 순서까지): rowKey 가 곧 testID(settings-nav-terms-*)의 원천이고, ready:true 가
    // 아니면 운영 화면 필터(filterReadySettingsSections)가 행을 숨긴다(TRIP-939).
    expect(termsRows).toEqual([
      ['terms-TERMS_OF_SERVICE', '서비스 이용약관', true],
      ['terms-PRIVACY_POLICY', '개인정보 처리방침', true],
      ['terms-LOCATION_TERMS', '위치정보 이용약관', true],
    ]);
  });
});

/**
 * TRIP-778 — l05 설정 default 정합(라이브 Figma 1607:2440).
 *
 * AC-2: 7그룹의 그룹·행 key·label·ready 를 **정본 순서 완전일치 표**로 잠근다. 위치정보 그룹에 라이브
 *  `4526:2415` 의 개인화 행이 붙고(D3), 취향 7·제휴·개인화가 ready:true 다(구 TRIP-618 AC-5·AC-6 의
 *  "취향·제휴 ready:false 유지"는 01b 사용자 결정으로 뒤집혀 이 표로 대체).
 * AC-5·6(모델 몫): 서버 값이 행 VM 의 `value`·`chip` 으로 들어간다. 응답 전·실패("모름")는 값도 칩도
 *  없다 — 모를 때 `미설정`/`미동의` 라고 말하면 거짓 표면이다(D4, 02a ★4). 취향은 TRIP-1051 describe.
 *
 * (개념) `x ?? null` — x 가 undefined 거나 null 이면 null. "없음"을 undefined 로 둘지 null 로 둘지는
 *  구현 재량이라 둘 다 받는다(02a ★5).
 */

/** 그룹·행 정본 표(AC-2) — [그룹 key, 그룹 label, [행 key, 행 label, ready][]]. */
const CANON = [
  [
    'account',
    '계정',
    [
      ['nickname', '닉네임·이메일', true],
      ['export', '데이터 내보내기', true],
      ['logout', '로그아웃', true],
    ],
  ],
  // TRIP-1051: 머리글 없는 그룹(label null)에 한 행.
  ['preferences', null, [['preferences', '여행 취향', true]]],
  [
    'location',
    '위치정보',
    [
      // TRIP-1017 결정3·Q7: 행은 GPS 기록 동의(L3)만 가리킨다 — 온보딩 위치 약관(L2)과 다른 동의임이 보이게.
      ['location-consent', 'GPS 이동경로 기록', true],
      ['personalization', '개인화', true],
    ],
  ],
  ['notifications', '알림', [['notifications', '알림 설정', true]]],
  [
    'affiliate',
    '제휴 안내',
    [['affiliate-toggle', '외부 이동 시 제휴 안내 다시 보기', true]],
  ],
  [
    'app-info',
    '앱 정보',
    [
      ['terms-TERMS_OF_SERVICE', '서비스 이용약관', true],
      ['terms-PRIVACY_POLICY', '개인정보 처리방침', true],
      ['terms-LOCATION_TERMS', '위치정보 이용약관', true],
    ],
  ],
  ['danger', '위험 영역', [['delete-account', '계정 삭제', true]]],
];

/** TRIP-778 시절 취향 7행의 행 key — TRIP-1051 로 한 행(`preferences`)에 합쳐져 사라졌다. */
const OLD_PREFERENCE_ROW_KEYS = [
  'style',
  'budget',
  'companions',
  'activities',
  'transport',
  'food',
  'pace',
] as const;

/** D5 프리뷰 픽스처 — 예산만 미설정(축 없음). */
const PREFERENCES = {
  styles: { value: ['휴양', '자연'], isNeutralDefault: false },
  companion: {
    companionTypes: ['친구'],
    petFlag: false,
    isNeutralDefault: false,
  },
  activities: { value: ['맛집투어', '전시'], isNeutralDefault: false },
  transportModes: { value: ['대중교통'], isNeutralDefault: false },
  foodTastes: { value: ['일식'], isNeutralDefault: false },
  pace: { value: '느긋하게', isNeutralDefault: false },
};

function rowOf(groups: ReturnType<typeof buildSettingsSections>, key: string) {
  const row = groups.flatMap((g) => g.rows).find((r) => r.key === key);
  // 긍정 앵커: 행이 실재한다(없으면 아래 "없음" 단언이 공허해진다).
  expect(row).toBeDefined();
  return row!;
}

describe('TRIP-778 AC-2 · 그룹·행 정본 표 완전일치', () => {
  it('7그룹의 key·label 과 행 key·label·ready 가 정본 순서 그대로다(개인화 행 포함, 전부 ready:true)', () => {
    // 준비·실행
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    // 단언(완전일치 · 순서까지): 행이 빠지거나·더해지거나·순서가 바뀌거나·ready 가 false 면 red.
    expect(
      groups.map((g) => [
        g.key,
        g.label,
        g.rows.map((r) => [r.key, r.label, r.ready]),
      ])
    ).toEqual(CANON);
  });

  it('짝: 준비중(ready:false) 행이 하나도 없다', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    // 긍정 앵커: 행이 실제로 있다(빈 목록 공허 통과 차단).
    expect(groups.flatMap((g) => g.rows).length).toBeGreaterThan(0);
    expect(groups.flatMap((g) => g.rows).filter((r) => !r.ready)).toEqual([]);
  });
});

/**
 * TRIP-1051 — 여행 취향 7행을 한 행 `여행 취향 · N/7 설정됨 ›` 으로(사용자 결정 A · 결정 (a)).
 *
 * 무엇을 보장하나:
 *  - AC-1·2: N = 서버가 "사용자가 고른 값"이라고 준 축의 수. 미설정 모양(축 없음·중립 기본값·빈 값)은
 *    전부 세지 않는다. 행은 하나뿐이고 `미설정` 칩은 없다.
 *  - AC-3: 취향을 아직 모르면(응답 전·실패) 값을 비운다 — `0/7` 로 채우면 모르는 것을 아는 척하는 것(D4).
 *  - AC-5: 옛 7행 key 는 모델에서 사라진다.
 *
 * 3동작 뼈대: 준비=취향 픽스처 → 실행=buildSettingsSections → 단언=취향 그룹의 한 행.
 */

/** 7축 중 3축(스타일·밀도·예산)만 설정 → 3/7. */
const THREE_SET: PreferenceView = {
  styles: { value: ['휴양'], isNeutralDefault: false },
  pace: { value: '느긋하게', isNeutralDefault: false },
  budget: { tier: '중간', isNeutralDefault: false },
};

/** 7축 모두 미설정 — 모양이 전부 다르다(축 없음·중립 기본값·빈 배열·value 없음·null). */
const ALL_UNSET_MIXED: PreferenceView = {
  styles: { value: ['휴양'], isNeutralDefault: true },
  activities: { value: [], isNeutralDefault: false },
  // transportModes: 축 자체가 없다
  foodTastes: { isNeutralDefault: false },
  pace: { value: null, isNeutralDefault: false },
  companion: { companionTypes: [], petFlag: false, isNeutralDefault: false },
  budget: { tier: '중간', rawAmount: 500000, isNeutralDefault: true },
};

/** 취향 그룹을 찾는다 — 긍정 앵커(없으면 아래 단언이 공허해진다). */
function preferenceGroup(groups: ReturnType<typeof buildSettingsSections>) {
  const group = groups.find((g) => g.key === 'preferences');
  expect(group).toBeDefined();
  return group!;
}

describe('TRIP-1051 · 여행 취향 한 행 요약 (모델)', () => {
  it('M1 AC-1: 3축만 설정이면 취향 그룹에 행 하나, 값 "3/7 설정됨", 칩 없음', () => {
    // 준비·실행
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      preferences: THREE_SET,
    });

    // 단언
    const group = preferenceGroup(groups);
    expect(group.rows).toHaveLength(1);
    expect(group.rows[0].value).toBe('3/7 설정됨');
    expect(group.rows[0].chip ?? null).toBeNull();
  });

  it('M2 AC-2: 7축 모두 미설정이면(모양이 제각각이어도) "0/7 설정됨"', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      preferences: ALL_UNSET_MIXED,
    });

    const row = rowOf(groups, 'preferences');
    expect(row.value).toBe('0/7 설정됨');
    expect(row.chip ?? null).toBeNull();
  });

  it('M3 AC-3: 취향을 아직 모르면(응답 전·실패) 행은 있지만 값도 칩도 없다 — 0/7 로 채우지 않는다', () => {
    // 준비·실행 — preferences 입력 없음.
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    const row = rowOf(groups, 'preferences');
    expect(row.value ?? null).toBeNull();
    expect(row.chip ?? null).toBeNull();
  });

  it('M4 AC-1: D5 프리뷰 픽스처(예산만 미설정)는 "6/7 설정됨" — Figma 4664:3279 와 같은 숫자', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      preferences: PREFERENCES,
    });

    expect(rowOf(groups, 'preferences').value).toBe('6/7 설정됨');
  });

  it('M5 AC-5: 옛 7행 key(style·budget·…·pace)가 어느 그룹에도 없다', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      preferences: PREFERENCES,
    });

    // 긍정 앵커: 새 행은 있다(빈 목록이면 아래 "없다"가 공허하다).
    rowOf(groups, 'preferences');
    const keys = groups.flatMap((g) => g.rows).map((r) => r.key);
    for (const key of OLD_PREFERENCE_ROW_KEYS) {
      expect(keys).not.toContain(key);
    }
  });
});

/**
 * TRIP-1051 AC-7 — 속성: 어떤 취향이 와도 값은 `${N}/7 설정됨` 이고 N 은 "설정된 축의 수"다.
 *
 * ★ 기대값 N 은 생성기가 센다(02a ★4): 축마다 먼저 "설정/미설정" 동전을 던지고, 설정이면 고른 값을,
 *   미설정이면 미설정 모양 중 하나를 넣는다. 그러면 N = 앞면 수다. 구현이 쓰는 `summarizePreferences` 로
 *   기대값을 만들면 둘이 같이 틀려도 green 이라 쓰지 않는다.
 * ★ `isNeutralDefault` 를 빼먹은(undefined) 축은 "설정"이다(02a ★5) — 설정 쪽에 false|undefined 를 섞는다.
 *
 * (개념) `fc.oneof(a, b)` — a 나 b 중 하나로 만든다. `fc.record({k: 생성기})` — 필드마다 생성기를 돌려 객체를 만든다.
 * (개념) `.map(f)` — 만든 값을 f 로 한 번 더 가공한다. 여기선 동전 결과를 세어 기대값을 붙인다.
 */

/** 계약 enum 값으로 만든, 중복 없는 비어있지 않은 부분집합(preferenceSummary.test.ts 와 같은 재료). */
function subsetOf(values: readonly string[]) {
  return fc.uniqueArray(fc.constantFrom(...values), {
    minLength: 1,
    maxLength: values.length,
  });
}

/** "사용자가 고른 값" 표지 — 생략(undefined)도 중립이 아니다. */
const notNeutral = fc.constantFrom(false, undefined);

/** 배열 축(스타일·활동·이동·음식). */
function arrayAxisArb(values: readonly string[]) {
  return fc.oneof(
    fc.record({
      set: fc.constant(true),
      axis: fc.record({
        value: subsetOf(values),
        isNeutralDefault: notNeutral,
      }),
    }),
    fc.record({
      set: fc.constant(false),
      axis: fc.oneof(
        fc.constant(undefined),
        fc.record({
          value: subsetOf(values),
          isNeutralDefault: fc.constant(true),
        }),
        fc.record({
          value: fc.constant([] as string[]),
          isNeutralDefault: fc.constant(false),
        }),
        fc.record({ isNeutralDefault: fc.constant(false) })
      ),
    })
  );
}

const PACES = Object.values(PreferenceInputPace);
const paceArb = fc.oneof(
  fc.record({
    set: fc.constant(true),
    axis: fc.record({
      value: fc.constantFrom(...PACES),
      isNeutralDefault: notNeutral,
    }),
  }),
  fc.record({
    set: fc.constant(false),
    axis: fc.oneof(
      fc.constant(undefined),
      fc.record({
        value: fc.constantFrom(...PACES),
        isNeutralDefault: fc.constant(true),
      }),
      fc.record({
        value: fc.constant(null),
        isNeutralDefault: fc.constant(false),
      })
    ),
  })
);

const COMPANIONS = Object.values(PreferenceInputCompanionTypesItem);
const companionArb = fc.oneof(
  fc.record({
    set: fc.constant(true),
    axis: fc.oneof(
      fc.record({
        companionTypes: subsetOf(COMPANIONS),
        petFlag: fc.boolean(),
        isNeutralDefault: notNeutral,
      }),
      // 반려동물만 있어도 설정이다.
      fc.record({
        companionTypes: fc.constant([] as string[]),
        petFlag: fc.constant(true),
        isNeutralDefault: notNeutral,
      })
    ),
  }),
  fc.record({
    set: fc.constant(false),
    axis: fc.oneof(
      fc.constant(undefined),
      fc.record({
        companionTypes: subsetOf(COMPANIONS),
        petFlag: fc.boolean(),
        isNeutralDefault: fc.constant(true),
      }),
      fc.record({
        companionTypes: fc.constant([] as string[]),
        petFlag: fc.constant(false),
        isNeutralDefault: fc.constant(false),
      })
    ),
  })
);

const TIERS = Object.values(PreferenceInputBudgetTier);
const budgetArb = fc.oneof(
  fc.record({
    set: fc.constant(true),
    axis: fc.record({
      tier: fc.constantFrom(...TIERS),
      rawAmount: fc.option(fc.nat()),
      isNeutralDefault: notNeutral,
    }),
  }),
  fc.record({
    set: fc.constant(false),
    axis: fc.oneof(
      fc.constant(undefined),
      fc.record({
        tier: fc.constantFrom(...TIERS),
        isNeutralDefault: fc.constant(true),
      }),
      // 금액이 있어도 등급이 없으면 미설정(D6).
      fc.record({
        tier: fc.constant(null),
        rawAmount: fc.nat(),
        isNeutralDefault: fc.constant(false),
      })
    ),
  })
);

/** 임의 취향 + 생성기가 센 설정 축 수(기대값 N). */
const preferencesWithCount = fc
  .record({
    styles: arrayAxisArb(Object.values(PreferenceInputStylesItem)),
    activities: arrayAxisArb(Object.values(PreferenceInputActivitiesItem)),
    transportModes: arrayAxisArb(
      Object.values(PreferenceInputTransportModesItem)
    ),
    foodTastes: arrayAxisArb(Object.values(PreferenceInputFoodTastesItem)),
    pace: paceArb,
    companion: companionArb,
    budget: budgetArb,
  })
  .map((axes) => {
    const view: Record<string, unknown> = {};
    let setCount = 0;
    for (const [name, { set, axis }] of Object.entries(axes)) {
      if (set) setCount += 1;
      if (axis !== undefined) view[name] = axis;
    }
    return { view: view as PreferenceView, setCount };
  });

describe('TRIP-1051 AC-7 · 취향 요약 — 속성', () => {
  it('P1 어떤 취향이든 행은 하나, 값은 "{설정된 축 수}/7 설정됨"(0~7), 칩은 없다', () => {
    fc.assert(
      fc.property(preferencesWithCount, ({ view, setCount }) => {
        // 준비·실행
        const groups = buildSettingsSections({
          nickname: '여행자123',
          email: null,
          preferences: view,
        });

        // 단언
        const group = preferenceGroup(groups);
        expect(group.rows).toHaveLength(1);
        expect(group.rows[0].value).toBe(`${setCount}/7 설정됨`);
        expect(group.rows[0].chip ?? null).toBeNull();
      })
    );
  });
});

describe('TRIP-778 AC-5 · 위치정보 수집 동의 칩 (모델, D4)', () => {
  it.each([
    ['동의(true)', true, { label: '동의', tone: 'primary' }],
    ['미동의(false)', false, { label: '미동의', tone: 'neutral' }],
    ['모름(없음)', undefined, null],
  ] as const)('%s → 칩', (_title, locationConsent, expected) => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      locationConsent,
    });

    expect(rowOf(groups, 'location-consent').chip ?? null).toEqual(expected);
  });
});

describe('TRIP-778 AC-6 · 개인화 행 값 (모델, D3)', () => {
  it.each([
    ['동의(true)', true, '사용 중'],
    ['미동의(false)', false, null],
    ['모름(없음)', undefined, null],
  ] as const)('%s → 값', (_title, personalizationOn, expected) => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      personalizationOn,
    });

    const row = rowOf(groups, 'personalization');
    expect(row.value ?? null).toBe(expected);
    // 개인화 행은 칩을 쓰지 않는다("사용 안 함" 같은 문구 발명 금지).
    expect(row.chip ?? null).toBeNull();
  });
});
