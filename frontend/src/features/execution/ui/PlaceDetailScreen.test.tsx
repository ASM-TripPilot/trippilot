import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PlaceDetailView } from '@/features/execution/model/placeDetailView';

import { BackArrowGlyph, ShareGlyph } from './ExecutionGlyphs';
import { PlaceDetailScreen } from './PlaceDetailScreen';

/**
 * TRIP-398 · PlaceDetailScreen(i05) — 여행 중 현재 장소 상세, 무상태 화면.
 *
 * 표면 = 영업시간(원문 또는 "미확인") · 위치("미확인") · 다음 일정까지(정성 slack) · "지금 여기"
 * 도착 계획값 · 태그 칩 · hero/지도 placeholder · 하단 CTA 2개. 재판정하지 않고 뷰 값만 그린다.
 *
 * 규율:
 *  - 각 leaf 는 값 하나(`toHaveTextContent` 문자열=완전일치로 읽음, LiveSlotCard 관례).
 *  - 결측 영업시간은 값 자리를 **다른 testID**(`-unknown-openhours`)로 바꿔 기계로 구분(AC-2).
 *  - 소요시간 단위 문자열은 화면 어디에도 없다(INV-3).
 *
 * 3동작 뼈대: 준비=완성된 뷰 → 실행=render → 단언=leaf 텍스트·testID·CTA.
 *
 * TRIP-939 AC-3(심사 2.1): 운영 빌드에서 누를 수 있어 보이는데 반응이 없는 것·가짜 자리표시를 뺀다 —
 *  "지도 준비 중" 미니맵(`execution-place-map`), onPress 없는 [길찾기], 핸들러 없는 헤더 뒤로·공유
 *  그림(Q5 — 딥링크 전용 화면이라 뒤로는 iOS 스와이프·[일정에서 보기]가 대신)을 렌더하지 않는다.
 *  (개념) `UNSAFE_queryAllByType(컴포넌트)` = 그 컴포넌트가 트리에 몇 번 그려졌나(testID 없는 글리프용).
 */

// 소요시간 표기 탐지기(INV-3). `HH:mm`(콜론 뒤 숫자)은 안 걸린다.
const DURATION = /(\d+\s*분|\d+\s*시간|소요)/;

const view = (over: Partial<PlaceDetailView> = {}): PlaceDetailView => ({
  name: '광안리 해수욕장',
  category: '해변',
  tags: ['해변', '포토스팟'],
  imageUrl: null,
  openingHours: '09:00~22:00 (상시 개방)',
  openingHoursMissing: false,
  hoursCaption: null,
  location: '미확인',
  slackLabel: '여유 있음 · 다음 부산시립미술관',
  arrival: '14:20 도착',
  lat: 35.15,
  lng: 129.11,
  ...over,
});

describe('PlaceDetailScreen', () => {
  it('S1 정상 — 영업시간 원문·정성 slack·도착 계획값을 각 leaf로 그린다 (AC-1)', () => {
    render(<PlaceDetailScreen view={view()} />);

    // 문자열 매처 = 완전일치.
    expect(screen.getByTestId('execution-place-openhours')).toHaveTextContent(
      '09:00~22:00 (상시 개방)'
    );
    expect(screen.getByTestId('execution-place-slack')).toHaveTextContent(
      '여유 있음 · 다음 부산시립미술관'
    );
    // 정규식 = 부분일치(정적 접미 "· 머무는 중 …"과 무관하게 계획값만 확인).
    expect(screen.getByTestId('execution-place-here')).toHaveTextContent(
      /14:20 도착/
    );

    // 값이 있으므로 결측 자리 testID 는 안 뜬다.
    expect(
      screen.queryByTestId('execution-place-unknown-openhours')
    ).toBeNull();

    // 구조 앵커(태그 칩·hero 존).
    expect(screen.getByTestId('execution-place-tags')).toBeTruthy();
    expect(screen.getByTestId('execution-place-hero')).toBeTruthy();
    // TRIP-939 AC-3 — "지도 준비 중" 자리표시는 그리지 않는다(좌표와 무관하게 항상 가짜였다).
    expect(screen.queryByTestId('execution-place-map')).toBeNull();
    expect(screen.queryByText(/지도 준비 중/)).toBeNull();
  });

  it('S2 결측 — 영업시간 null 이면 미확인 자리(unknown testID), 위치는 항상 미확인 (AC-2·D3)', () => {
    render(
      <PlaceDetailScreen
        view={view({ openingHours: '미확인', openingHoursMissing: true })}
      />
    );

    expect(
      screen.getByTestId('execution-place-unknown-openhours')
    ).toHaveTextContent('미확인');
    // 값 자리 testID 는 결측일 때 안 뜬다(기계 구분).
    expect(screen.queryByTestId('execution-place-openhours')).toBeNull();
    // 위치는 계약 공백이라 항상 unknown-location = "미확인"(D3).
    expect(
      screen.getByTestId('execution-place-unknown-location')
    ).toHaveTextContent('미확인');
  });

  it('S3 화면 어디에도 소요시간 단위 문자열이 없다 (INV-3)', () => {
    render(<PlaceDetailScreen view={view()} />);

    // 긍정 앵커 — 탐지기가 진짜 소요시간은 잡는다(공허 통과 방지).
    expect(DURATION.test('30분')).toBe(true);
    expect(DURATION.test('소요 2시간')).toBe(true);

    // 렌더된 화면 전체 텍스트 스캔.
    expect(DURATION.test(JSON.stringify(screen.toJSON()))).toBe(false);
    // 렌더 앵커 — 빈 트리 공허 통과 방지.
    expect(screen.getByTestId('execution-place-detail')).toBeTruthy();
  });

  it('S4 데이터 출처 — openingHoursKnown=false 면 "확인 필요" 캡션, 그 외 부재 (AC-5)', () => {
    const { rerender } = render(
      <PlaceDetailScreen view={view({ hoursCaption: '확인 필요' })} />
    );
    expect(
      screen.getByTestId('execution-place-hours-caption')
    ).toHaveTextContent('확인 필요');

    rerender(<PlaceDetailScreen view={view({ hoursCaption: null })} />);
    expect(screen.queryByTestId('execution-place-hours-caption')).toBeNull();
  });

  it('S5 CTA — [일정에서 보기]만 있고 콜백을 부른다, 무동작 [길찾기]는 없다 (D7 · TRIP-939 AC-3)', () => {
    // 준비
    const onPressItinerary = jest.fn();
    render(
      <PlaceDetailScreen view={view()} onPressItinerary={onPressItinerary} />
    );

    // 단언(부재): onPress 없던 [길찾기]는 운영 화면에 그리지 않는다.
    expect(screen.queryByTestId('execution-place-cta-directions')).toBeNull();
    expect(screen.queryByText('길찾기')).toBeNull();

    // 실행·단언(짝): [일정에서 보기]는 그대로 있고 콜백 1회.
    fireEvent.press(screen.getByTestId('execution-place-cta-itinerary'));
    expect(onPressItinerary).toHaveBeenCalledTimes(1);
  });

  it('S6 헤더 — 핸들러 없는 뒤로·공유 그림을 그리지 않는다 (TRIP-939 AC-3 · Q5)', () => {
    // 준비·실행
    render(<PlaceDetailScreen view={view()} />);

    // 단언: 눌러도 반응 없는 아이콘 그림 2종 부재 + 짝 앵커(제목은 남는다).
    expect(screen.UNSAFE_queryAllByType(BackArrowGlyph)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(ShareGlyph)).toHaveLength(0);
    expect(screen.getByText('현재 장소')).toBeOnTheScreen();
  });
});
