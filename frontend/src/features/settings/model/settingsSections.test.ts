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
 *  (7) TRIP-778 AC-4·5·6(모델 몫): 취향 값/미설정 칩, 위치 동의 칩, 개인화 '사용 중' 값.
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
  '여행 취향',
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
 * AC-4·5·6(모델 몫): 서버 값이 행 VM 의 `value`·`chip` 으로 들어간다. 응답 전·실패("모름")는 값도 칩도
 *  없다 — 모를 때 `미설정`/`미동의` 라고 말하면 거짓 표면이다(D4, 02a ★4).
 *
 * (개념) `x ?? null` — x 가 undefined 거나 null 이면 null. "없음"을 undefined 로 둘지 null 로 둘지는
 *  구현 재량이라 둘 다 받는다(02a ★5).
 */

const DOT = '·';

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
  [
    'preferences',
    '여행 취향',
    [
      ['style', '여행 스타일', true],
      ['budget', '예산', true],
      ['companions', '동행 유형', true],
      ['activities', '선호 활동', true],
      ['transport', '이동 방식', true],
      ['food', '음식 취향', true],
      ['pace', '일정 밀도·이동 선호', true],
    ],
  ],
  [
    'location',
    '위치정보',
    [
      ['location-consent', '위치정보 수집 동의', true],
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

const PREFERENCE_KEYS = [
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

describe('TRIP-778 AC-4 · 취향 7행 값·미설정 칩 (모델)', () => {
  it('설정된 축은 value 에 요약 문자열, 미설정 축은 회색 "미설정" 칩', () => {
    // 준비·실행
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
      preferences: PREFERENCES,
    });

    // 단언 — 값 행: value 완전일치 + 칩 없음.
    const expected: Record<string, string> = {
      style: `휴양${DOT}자연`,
      companions: '친구',
      activities: `맛집투어${DOT}전시`,
      transport: '대중교통',
      food: '일식',
      pace: '느긋하게',
    };
    for (const [key, text] of Object.entries(expected)) {
      const row = rowOf(groups, key);
      expect(row.value).toBe(text);
      expect(row.chip ?? null).toBeNull();
    }
    // 단언 — 미설정 행(예산): 칩 + 값 없음.
    const budget = rowOf(groups, 'budget');
    expect(budget.chip).toEqual({ label: '미설정', tone: 'neutral' });
    expect(budget.value ?? null).toBeNull();
  });

  it('취향을 아직 모르면(응답 전·실패) 7행 모두 값도 칩도 없다 — 미설정이라고 말하지 않는다', () => {
    // 준비·실행 — preferences 입력 없음.
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    for (const key of PREFERENCE_KEYS) {
      const row = rowOf(groups, key);
      expect(row.value ?? null).toBeNull();
      expect(row.chip ?? null).toBeNull();
    }
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
