import { assistantHref } from './assistantHref';

/**
 * TRIP-1321 · BR-U8-02 — 도우미 시트로 가는 주소는 화면 종류(`surface`)와 `tripId` 만 싣는다.
 * TRIP-1553 — ✦ FAB 가 사라지며 `AssistantFab.test` 마지막 describe 에서 이 파일로 옮겨 왔다(홈 헤더·허브
 * 챗봇 칸·시트 이력 전환이 계속 쓴다).
 *
 * 3동작 뼈대: 준비=surface(·tripId) 고르기 → 실행=`assistantHref` 호출 → 단언=반환한 주소 객체.
 */
describe('assistantHref', () => {
  it('surface·tripId 만 싣는다(BR-U8-02)', () => {
    expect(assistantHref('HOME')).toEqual({
      pathname: '/assistant',
      params: { surface: 'HOME' },
    });
    expect(assistantHref('ITINERARY', 't1')).toEqual({
      pathname: '/assistant',
      params: { surface: 'ITINERARY', tripId: 't1' },
    });
  });

  // 홈 헤더는 계획 중 얼굴이 아니면 undefined 를 넘긴다 — 이때 `tripId` 키가 아예 없어야 한다(값이 undefined 인 키 아님).
  it.each([undefined, null, ''])(
    'tripId 가 %p 이면 tripId 키 없이 surface 만 싣는다',
    (tripId) => {
      const href = assistantHref('HOME', tripId);

      expect(href.params).toEqual({ surface: 'HOME' });
      expect(Object.keys(href.params)).toEqual(['surface']);
    }
  );
});
