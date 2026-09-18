import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { VisitRecordCard } from './VisitRecordCard';

/**
 * TRIP-566 · AC-6 — j01 카드 사진/메모 슬롯 배선(옵셔널 prop, 후방호환).
 *
 * 무엇을 보장하나:
 *  - 카드가 정적 스캐폴딩(L148-155) 자리에 `photoSlot`/`memoSlot`(ReactNode)를 렌더한다 — 주면 present,
 *    안 주면 부재(후방호환, 565 `onPressComplete?`·613 `onPressEditTime?` 동형).
 *  - 사진 상태가 나빠도(unavailable) 완료 체크서클·메모가 눌리지 않는다(메모·체크 독립, AC-3).
 *
 * ★ 왜 별 파일(VisitRecordCard.test.tsx 무수정)인가: T5 무회귀는 "기존 5블록 파일 무변경"으로 굳힌다.
 *   이 파일에 신규 컴포넌트 import 를 넣으면 import 실패가 T5 describe 까지 red 로 오염시켜 무회귀 증거가
 *   깨진다 → 격리(TRIP-613 이 같은 파일에 AC-8 을 더한 것과 다른 판단 — 이번은 새 의존이 있어 격리 안전).
 * ★ 왜 마커 노드인가: 카드의 책임은 "받은 슬롯을 그 자리에 렌더"뿐이다 — 슬롯이 나르는 실제 testID
 *   (record-trip-photo-add=PhotoThumbStrip · record-trip-memo-input=MemoInline)의 소유·거동은 각 컴포넌트
 *   테스트가 잠근다. 카드 테스트는 마커에 그 계약 testID 를 실어 "카드가 슬롯을 surface 하는지"만 본다
 *   (실 컴포넌트 의존 제거 → W2 선제 green 보존).
 *
 * (개념) `queryByTestId(...)`=없으면 null(부재 단언). 카드 VM 은 status 를 세 timestamp 로 내부 파생.
 */

const photoAddMarker = <View testID="record-trip-photo-add" />;
const memoMarker = <View testID="record-trip-memo-input" />;

const activeCard = {
  visitCheckId: 'v1',
  poiId: 'p1',
  nameKo: '광안리',
  slotKey: null,
  arrivedAt: '2026-08-31T14:20:00',
  completedAt: null,
  skippedAt: null,
  arrivedLabel: '14:20',
};

describe('🔴 AC-6 · W1 — 슬롯 주입 시 사진/메모 자리가 배선된다', () => {
  it('photoSlot·memoSlot 주입 → record-trip-photo-add · record-trip-memo-input present', () => {
    render(
      <VisitRecordCard
        card={activeCard}
        photoSlot={photoAddMarker}
        memoSlot={memoMarker}
      />
    );

    expect(screen.getByTestId('record-trip-photo-add')).toBeTruthy();
    expect(screen.getByTestId('record-trip-memo-input')).toBeTruthy();
  });
});

describe('AC-6 · W2 — 슬롯 미주입 시 부재(후방호환, 선제 green)', () => {
  it('slot prop 없이 렌더 → 두 자리 모두 부재(565 호출자·프리뷰 무영향)', () => {
    render(<VisitRecordCard card={activeCard} />);

    expect(screen.queryByTestId('record-trip-photo-add')).toBeNull();
    expect(screen.queryByTestId('record-trip-memo-input')).toBeNull();
  });
});

describe('🔴 AC-6 · W3 — 사진 상태가 나빠도 체크·메모는 독립으로 산다', () => {
  it('unavailable 사진 슬롯 + 메모 슬롯 + active 카드 → 완료 체크서클·메모가 동시 present', () => {
    render(
      <VisitRecordCard
        card={activeCard}
        photoSlot={<View testID="record-photo-unavailable-ph1" />}
        memoSlot={memoMarker}
      />
    );

    // 완료 발화 체크서클(IN_PROGRESS)은 사진 상태와 무관하게 존재한다.
    expect(screen.getByTestId('record-visit-check-active-v1')).toBeTruthy();
    // 메모·사진 슬롯도 함께 산다(사진이 unavailable 이어도 눌리지 않음).
    expect(screen.getByTestId('record-trip-memo-input')).toBeTruthy();
    expect(screen.getByTestId('record-photo-unavailable-ph1')).toBeTruthy();
  });
});
