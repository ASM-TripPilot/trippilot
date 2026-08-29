import { buildSettingsSections } from './settingsSections';

/**
 * TRIP-608 AC-1 · AC-11 — l05 설정 그룹 뷰모델 조립.
 *
 * 무엇을 보장하나:
 *  (1) 6그룹을 **정본 순서**로 낸다(Figma 라이브 = 화면 유일 정본: 계정 → 여행 취향 → 위치정보 →
 *      알림 → 제휴 안내 → 위험 영역). 티켓 서술의 "개인화" 그룹은 없다(§8 드리프트, Figma 승).
 *  (2) 계정 그룹 닉네임 행 요약값 = 닉네임(Q6 확정 — 닉네임만 표기).
 *  (3) email 이 null(소셜 MVP)이어도 요약이 안 깨진다 — 'null'/'undefined' 문자열이 새지 않는다.
 *  (4) 목적지 없는 행(취향7·위치·알림·제휴)은 ready:false, 상호작용 행은 ready:true.
 *
 * 3동작 뼈대: 준비=닉네임/이메일 입력 → 실행=buildSettingsSections → 단언=그룹/행 VM.
 *
 * (개념) 순수 함수 — 라이브값을 받아 그림 없는 자료(뷰모델)만 만든다. 화면은 이걸 그대로 그린다.
 */

/** 정본 순서(Figma 라이브). 이 배열과 어긋나면 그룹이 빠졌거나 순서가 뒤집힌 것이다. */
const EXPECTED_GROUP_LABELS = [
  '계정',
  '여행 취향',
  '위치정보',
  '알림',
  '제휴 안내',
  '위험 영역',
] as const;

/** 준비중(목적지 부재) 그룹 — 이 그룹의 모든 행은 ready:false 여야 한다(AC-6, INV-4). */
const PREPARING_GROUP_LABELS = ['여행 취향', '위치정보', '알림', '제휴 안내'];

describe('TRIP-608 · buildSettingsSections (AC-1 · AC-11)', () => {
  it('6그룹을 정본 순서로 낸다', () => {
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

  it('AC-6: 준비중 그룹의 모든 행은 ready:false, 상호작용 행은 ready:true(짝)', () => {
    const groups = buildSettingsSections({
      nickname: '여행자123',
      email: null,
    });

    // 준비중 그룹(취향·위치·알림·제휴)의 모든 행은 비활성이어야 한다(목적지 부재, INV-4).
    for (const label of PREPARING_GROUP_LABELS) {
      const group = groups.find((g) => g.label === label);
      expect(group).toBeDefined();
      expect(group!.rows.length).toBeGreaterThan(0);
      for (const row of group!.rows) {
        expect(row.ready).toBe(false);
      }
    }

    // 긍정 짝: 상호작용 행(내보내기·계정 삭제)은 ready:true — "전부 false" 공허 통과를 막는다.
    const account = groups.find((g) => g.label === '계정')!;
    const danger = groups.find((g) => g.label === '위험 영역')!;
    expect(account.rows.every((r) => r.ready)).toBe(true);
    expect(danger.rows.every((r) => r.ready)).toBe(true);
  });
});
