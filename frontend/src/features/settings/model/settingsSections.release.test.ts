import {
  buildSettingsSections,
  filterReadySettingsSections,
  type SettingsGroupVM,
} from './settingsSections';

/**
 * TRIP-939 AC-1 — 운영 빌드의 설정 화면에는 "준비 중" 행이 없다(App Store 가이드라인 2.1).
 *
 * 무엇을 보장하나:
 *  (1) `filterReadySettingsSections` 는 `ready:true` 행만 남기고, 행이 0개가 된 그룹은 통째로 뺀다
 *      → 계정·위치정보·알림·위험 영역 4그룹(정본 순서 유지).
 *  (2) 판정은 **플래그(`ready`)로만** 한다 — 여행 취향의 한 행을 ready:true 로 바꾸면 그 그룹이
 *      그 행 하나로 되살아난다(라벨 하드코딩 차단, 기능 개통 = true 한 줄).
 *  (3) 입력을 바꾸지 않는다 — `buildSettingsSections` 결과는 여전히 6그룹·준비중 8행이다(되살림 자리).
 *
 * 3동작 뼈대: 준비=뷰모델 입력 → 실행=filterReadySettingsSections → 단언=남은 그룹/행.
 *
 * (개념) 순수 함수 — 입력만 보고 새 값을 돌려준다. 화면을 그리지 않으므로 렌더 없이 값으로 잰다.
 */

const INPUT = { nickname: '여행자123', email: 'a@b.com' };

describe('TRIP-939 AC-1 · filterReadySettingsSections', () => {
  it('R1 ready 행만 남기고 빈 그룹을 빼 4그룹(정본 순서)을 낸다', () => {
    // 준비
    const groups = buildSettingsSections(INPUT);

    // 실행
    const visible = filterReadySettingsSections(groups);

    // 단언 — 그룹 라벨 완전일치(순서까지).
    expect(visible.map((g) => g.label)).toEqual([
      '계정',
      '위치정보',
      '알림',
      '위험 영역',
    ]);
    // 남은 행은 전부 ready:true.
    expect(visible.flatMap((g) => g.rows).every((r) => r.ready)).toBe(true);
    // 행 객체를 그대로 보존한다(닉네임 요약값이 살아 있다).
    expect(visible[0].rows[0].value).toBe('여행자123');
  });

  it('R2 판정은 ready 플래그 구동 — 취향 한 행을 ready:true 로 바꾸면 그 행 하나로 그룹이 되살아난다', () => {
    // 준비 — 여행 취향 그룹의 첫 행(여행 스타일)만 개통했다고 가정한 합성 입력.
    const groups: SettingsGroupVM[] = buildSettingsSections(INPUT).map((g) =>
      g.key === 'preferences'
        ? {
            ...g,
            rows: g.rows.map((r, i) => (i === 0 ? { ...r, ready: true } : r)),
          }
        : g
    );

    // 실행
    const visible = filterReadySettingsSections(groups);

    // 단언 — 여행 취향이 두 번째 자리(정본 순서)로 돌아오고, 행은 개통한 1행뿐.
    expect(visible.map((g) => g.label)).toEqual([
      '계정',
      '여행 취향',
      '위치정보',
      '알림',
      '위험 영역',
    ]);
    const preferences = visible.find((g) => g.key === 'preferences');
    expect(preferences?.rows.map((r) => r.label)).toEqual(['여행 스타일']);
  });

  it('R3 입력을 바꾸지 않는다 — 원본은 여전히 6그룹·준비중 8행(되살림 자리 유지)', () => {
    // 준비
    const groups = buildSettingsSections(INPUT);

    // 실행
    filterReadySettingsSections(groups);

    // 단언 — 필터 뒤에도 원본 배열은 그대로.
    expect(groups).toHaveLength(6);
    expect(groups.flatMap((g) => g.rows).filter((r) => !r.ready)).toHaveLength(
      8
    );
  });
});
