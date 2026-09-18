import { useLiveViewStore } from './liveViewStore';

/**
 * TRIP-395 · liveViewStore — 여행 중 화면의 UI 상태 상자(zustand).
 *
 * *(개념)* **Zustand 스토어** = 화면 밖에 사는 작은 상태 상자. `getState()`는 지금 값을,
 * 액션은 값을 바꾼다. 서버가 모르는 **UI 상태만** 둔다(일정｜지도 세그먼트 · 계획｜실제 토글 ·
 * 시트 열림). 서버 데이터는 여기 두지 않는다(그건 react-query 몫).
 *
 * 3동작 뼈대: 준비=reset → 실행=액션 호출 → 단언=getState() 값.
 */

beforeEach(() => {
  useLiveViewStore.getState().reset();
});

describe('liveViewStore — UI 상태', () => {
  it('A3-1 초기값은 일정 세그먼트 · 계획 토글 · 시트 닫힘이다', () => {
    const s = useLiveViewStore.getState();
    expect(s.segment).toBe('itinerary');
    expect(s.toggle).toBe('plan');
    expect(s.sheetOpen).toBe(false);
  });

  it('A3-2 setSegment가 세그먼트를 바꾼다', () => {
    useLiveViewStore.getState().setSegment('map');
    expect(useLiveViewStore.getState().segment).toBe('map');
  });

  it('A3-3 setToggle가 계획｜실제 토글을 바꾼다', () => {
    useLiveViewStore.getState().setToggle('actual');
    expect(useLiveViewStore.getState().toggle).toBe('actual');
  });

  it('A3-4 setSheetOpen이 시트 열림을 바꾼다', () => {
    useLiveViewStore.getState().setSheetOpen(true);
    expect(useLiveViewStore.getState().sheetOpen).toBe(true);
  });

  it('A3-5 reset이 전부 초기값으로 되돌린다', () => {
    const s = useLiveViewStore.getState();
    s.setSegment('map');
    s.setToggle('actual');
    s.setSheetOpen(true);

    useLiveViewStore.getState().reset();

    const after = useLiveViewStore.getState();
    expect(after.segment).toBe('itinerary');
    expect(after.toggle).toBe('plan');
    expect(after.sheetOpen).toBe(false);
  });
});
