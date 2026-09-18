import { notificationKind } from './notificationKind';

/**
 * TRIP-576 · l01 · AC-3(매핑 부분) — `notificationKind(kind) → { icon, label }`.
 * 8종 kind 를 5 아이콘군·한글 라벨로 접는 순수 매핑(DEC-U6-8). 화면은 이 결과의 icon 으로 글리프를,
 * label 로 메타를 그린다 — 매핑 정확성은 여기서, 실제 글리프 픽셀은 6-b 실기.
 *
 * 무엇을 보장하나(준비: kind → 실행: notificationKind → 단언: {icon,label} 완전일치):
 *  - 5 아이콘군 대표 매핑이 정확하다.
 *  - **8→5 접힘**: 일정군(TRIP_PRE·TRIP_DAY·SLOT_PRE) 3종이 **한 아이콘("list")·한 라벨("일정")** 으로
 *    합쳐진다(세 kind 가 서로 다른 아이콘/라벨로 새지 않는다).
 */

describe('notificationKind · 5 아이콘군·라벨 매핑 (AC-3)', () => {
  it.each([
    ['STAY', 'home', '숙소'],
    ['TRIP_PRE', 'list', '일정'],
    ['TRIP_DAY', 'list', '일정'],
    ['SLOT_PRE', 'list', '일정'],
    ['PLAN_B', 'swap', 'Plan-B'],
    ['REFLECTION', 'document', '회고'],
    ['COMMUNITY', 'sun', '커뮤니티'],
    ['SYSTEM', 'sun', '시스템'],
  ])('%s → icon=%s · label=%s', (kind, icon, label) => {
    expect(
      notificationKind(kind as Parameters<typeof notificationKind>[0])
    ).toEqual({ icon, label });
  });
});

describe('notificationKind · 일정군 3종이 하나로 접힌다 (8→5)', () => {
  it('TRIP_PRE·TRIP_DAY·SLOT_PRE 는 동일한 {icon:list, label:일정}', () => {
    const pre = notificationKind('TRIP_PRE');
    const day = notificationKind('TRIP_DAY');
    const slot = notificationKind('SLOT_PRE');

    expect(pre).toEqual(day);
    expect(day).toEqual(slot);
    expect(pre).toEqual({ icon: 'list', label: '일정' });
  });
});
