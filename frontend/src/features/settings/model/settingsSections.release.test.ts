import {
  buildSettingsSections,
  filterReadySettingsSections,
  type SettingsGroupVM,
} from './settingsSections';

/**
 * TRIP-939 AC-1 — 운영 빌드의 설정 화면에는 "준비 중" 행이 없다(App Store 가이드라인 2.1).
 * TRIP-778 AC-3 — 취향 7·제휴·개인화가 ready:true 로 열려 필터 결과가 **7그룹 전부·준비중 0행**이다
 *  (구 R1 "5그룹"·R3 "준비중 8행"은 01b 사용자 결정으로 계약이 바뀌어 재작성).
 *
 * 무엇을 보장하나:
 *  (1) 실 뷰모델을 걸러도 7그룹이 정본 순서 그대로 남는다 — 새로 연 행이 운영 화면에 나타난다.
 *  (2) 판정은 **플래그(`ready`)로만** 한다 — 합성 입력에서 행을 ready:false 로 바꾸면 그 행만 빠지고,
 *      행이 0개가 된 그룹은 통째로 빠진다(라벨 하드코딩 차단).
 *  (3) 입력을 바꾸지 않는다 — 필터 뒤에도 원본의 ready:false 행은 그대로다.
 *
 * 3동작 뼈대: 준비=뷰모델 입력 → 실행=filterReadySettingsSections → 단언=남은 그룹/행.
 *
 * (개념) 순수 함수 — 입력만 보고 새 값을 돌려준다. 화면을 그리지 않으므로 렌더 없이 값으로 잰다.
 */

const INPUT = { nickname: '여행자123', email: 'a@b.com' };

const ALL_GROUP_LABELS = [
  '계정',
  '여행 취향',
  '위치정보',
  '알림',
  '제휴 안내',
  '앱 정보',
  '위험 영역',
];

/** 합성 입력 — 취향은 첫 행(여행 스타일)만 열고, 제휴 행은 닫는다(되살림·통째 제외 두 경우를 한 번에). */
function partlyClosed(): SettingsGroupVM[] {
  return buildSettingsSections(INPUT).map((g) => {
    if (g.key === 'preferences') {
      return {
        ...g,
        rows: g.rows.map((r, i) => ({ ...r, ready: i === 0 })),
      };
    }
    if (g.key === 'affiliate') {
      return { ...g, rows: g.rows.map((r) => ({ ...r, ready: false })) };
    }
    return g;
  });
}

describe('TRIP-939 AC-1 · TRIP-778 AC-3 · filterReadySettingsSections', () => {
  it('R1 실 뷰모델은 7그룹 전부(정본 순서)가 남고 준비중 행은 0개다', () => {
    // 준비
    const groups = buildSettingsSections(INPUT);

    // 실행
    const visible = filterReadySettingsSections(groups);

    // 단언 — 그룹 라벨 완전일치(순서까지).
    expect(visible.map((g) => g.label)).toEqual(ALL_GROUP_LABELS);
    // 걸러진 행이 없다 — 원본 행 수와 같다.
    expect(visible.flatMap((g) => g.rows)).toHaveLength(
      groups.flatMap((g) => g.rows).length
    );
    expect(visible.flatMap((g) => g.rows).every((r) => r.ready)).toBe(true);
    // 행 객체를 그대로 보존한다(닉네임 요약값이 살아 있다).
    expect(visible[0].rows[0].value).toBe('여행자123');
  });

  it('R2 판정은 ready 플래그 구동 — 닫은 행만 빠지고, 행이 0개가 된 그룹(제휴 안내)은 통째로 빠진다', () => {
    // 실행
    const visible = filterReadySettingsSections(partlyClosed());

    // 단언 — 제휴 안내만 빠진 6그룹(정본 순서).
    expect(visible.map((g) => g.label)).toEqual(
      ALL_GROUP_LABELS.filter((label) => label !== '제휴 안내')
    );
    // 여행 취향은 연 1행만 남는다.
    const preferences = visible.find((g) => g.key === 'preferences');
    expect(preferences?.rows.map((r) => r.label)).toEqual(['여행 스타일']);
  });

  it('R3 입력을 바꾸지 않는다 — 필터 뒤에도 원본의 닫힌 행 7개(취향 6 + 제휴 1)가 그대로다', () => {
    // 준비
    const groups = partlyClosed();

    // 실행
    filterReadySettingsSections(groups);

    // 단언 — 원본 배열은 그대로.
    expect(groups).toHaveLength(7);
    expect(groups.flatMap((g) => g.rows).filter((r) => !r.ready)).toHaveLength(
      7
    );
  });
});
