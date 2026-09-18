import { fireEvent, render, screen } from '@testing-library/react-native';

import type { PlaceDetailView } from '@/features/execution/model/placeDetailView';

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

    // 구조 앵커(태그 칩·지도 placeholder·hero 존).
    expect(screen.getByTestId('execution-place-tags')).toBeTruthy();
    expect(screen.getByTestId('execution-place-map')).toBeTruthy();
    expect(screen.getByTestId('execution-place-hero')).toBeTruthy();
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

  it('S5 CTA — [일정에서 보기]는 콜백, [길찾기]는 자리만(무동작, D7)', () => {
    const onPressItinerary = jest.fn();
    render(
      <PlaceDetailScreen view={view()} onPressItinerary={onPressItinerary} />
    );

    expect(screen.getByTestId('execution-place-cta-directions')).toBeTruthy();

    fireEvent.press(screen.getByTestId('execution-place-cta-itinerary'));
    expect(onPressItinerary).toHaveBeenCalledTimes(1);

    // 길찾기 press 는 일정 콜백을 부르지 않는다(별개 어포던스).
    fireEvent.press(screen.getByTestId('execution-place-cta-directions'));
    expect(onPressItinerary).toHaveBeenCalledTimes(1);
  });
});
