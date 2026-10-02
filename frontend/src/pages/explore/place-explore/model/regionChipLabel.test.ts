import { formatRegionChipLabel } from './regionChipLabel';

/**
 * TRIP-1023 칸 B #026 · d04 지역 칩 라벨의 단일 출처(결정5 · Seed Q5).
 *
 * 입력은 d04 라우트 `region` 파라미터를 배열로 편 것이다(`PlaceExplorePage` 의 `regions` — 없으면 [],
 * 한 곳이면 [이름], '더 담기'면 여러 곳, TRIP-687). 화면은 이 함수의 출력만 칩에 그린다 — 화면과
 * 페이지가 라벨 규칙을 각자 적으면 "전국" 철자·"외 N곳" 셈이 갈라진다.
 */
describe('🔴 1023-B #026 · formatRegionChipLabel — 지역 칩 라벨', () => {
  it('지역이 없으면 "전국" 이다 (AC-B5 — 탐색 탭·홈 "장소 더 보기" 진입)', () => {
    expect(formatRegionChipLabel([])).toBe('전국');
  });

  it('한 곳이면 그 이름 그대로다 (AC-B6 — 피커가 싣는 한글 이름)', () => {
    expect(formatRegionChipLabel(['강릉시'])).toBe('강릉시');
  });

  it.each([
    [['부산광역시', '경주시'], '부산광역시 외 1곳'],
    [['강릉시', '속초시', '양양군'], '강릉시 외 2곳'],
  ])(
    '여러 곳이면 "{첫 지역} 외 N곳" 이다 — N 은 첫 지역을 뺀 수 (AC-B10 · Seed Q5)',
    (names, label) => {
      expect(formatRegionChipLabel(names)).toBe(label);
    }
  );
});
