import { decideDragEnd, isOverDeleteZone } from './dragDelete';

/**
 * TRIP-1246 · 삭제 영역 판정 순수 함수. 실제 손가락·좌표는 jest 사각이라 값으로 경계를 잠근다.
 * 영역 윗변 = 뷰포트 800 − 바 84 − 하단 안전영역 20 = 696, 카드 높이 96 → 카드 윗변 648 이 가운데 696.
 */

const base = {
  scrollOffset: 0,
  cardSize: 96,
  viewportHeight: 800,
  bottomInset: 20,
};

describe('isOverDeleteZone', () => {
  it('가운데가 영역 윗변에 닿으면 참, 1 모자라면 거짓(경계)', () => {
    expect(isOverDeleteZone({ ...base, hoverTop: 648 })).toBe(true);
    expect(isOverDeleteZone({ ...base, hoverTop: 647 })).toBe(false);
  });

  it('스크롤한 만큼 화면 좌표가 밀린다 — 내용 좌표 1000 은 스크롤 300 이어도 영역 위(748), 내용 좌표 700 은 스크롤 300 이면 영역 밖(448)', () => {
    expect(
      isOverDeleteZone({ ...base, hoverTop: 1000, scrollOffset: 300 })
    ).toBe(true);
    expect(
      isOverDeleteZone({ ...base, hoverTop: 700, scrollOffset: 300 })
    ).toBe(false);
    expect(isOverDeleteZone({ ...base, hoverTop: 700, scrollOffset: 0 })).toBe(
      true
    );
  });

  it('하단 안전 영역이 크면 영역이 위로 커진다', () => {
    expect(isOverDeleteZone({ ...base, hoverTop: 610, bottomInset: 60 })).toBe(
      true
    );
    expect(isOverDeleteZone({ ...base, hoverTop: 610, bottomInset: 20 })).toBe(
      false
    );
  });

  it('뷰포트 높이나 카드 높이를 아직 모르면(0) 항상 거짓 — 짝: 알면 참', () => {
    expect(
      isOverDeleteZone({ ...base, hoverTop: 5000, viewportHeight: 0 })
    ).toBe(false);
    expect(isOverDeleteZone({ ...base, hoverTop: 5000, cardSize: 0 })).toBe(
      false
    );
    expect(isOverDeleteZone({ ...base, hoverTop: 5000 })).toBe(true);
  });
});

describe('decideDragEnd', () => {
  const data = [{ id: 'b' }, { id: 'a', pinned: true }, { id: 'c' }];
  const isPinned = (s: { pinned?: boolean }): boolean => s.pinned === true;

  it('영역 위면 삭제(놓인 칸의 카드), 아니면 새 순서 그대로 재정렬', () => {
    expect(decideDragEnd({ data, to: 0, overZone: true, isPinned })).toEqual({
      kind: 'delete',
      moved: { id: 'b' },
    });
    expect(decideDragEnd({ data, to: 0, overZone: false, isPinned })).toEqual({
      kind: 'reorder',
      slots: data,
    });
  });

  it('고정·완료 카드는 영역 위든 아니든 아무것도 안 한다 — 짝: 같은 데이터의 예정 카드는 한다', () => {
    expect(decideDragEnd({ data, to: 1, overZone: true, isPinned })).toEqual({
      kind: 'none',
    });
    expect(decideDragEnd({ data, to: 1, overZone: false, isPinned })).toEqual({
      kind: 'none',
    });
    expect(decideDragEnd({ data, to: 2, overZone: true, isPinned }).kind).toBe(
      'delete'
    );
  });

  it('없는 칸(to 범위 밖)이면 아무것도 안 한다', () => {
    expect(decideDragEnd({ data, to: 9, overZone: true, isPinned })).toEqual({
      kind: 'none',
    });
  });
});
