import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { formatPrice } from '../model/formatPrice';
import { OtaChoiceSheet } from './OtaChoiceSheet';

/**
 * TRIP-457 AC-8·AC-9 — 제휴 고지 시트(OtaChoiceSheet)의 렌더·배선 계약.
 *
 * 무엇을 보장하나: 딥링크 이동 **전** 제휴 고지를 띄운다(BR-U1-30 법정성 UX). 계약이 단일
 * OTA(`externalSource`)·단일 최저가만 주므로 OTA 행은 1개이고(복수 OTA·OTA별 정확가는 이연,
 * 01b Q2), [취소]/[이동] 두 버튼을 콜백으로 올린다. 이 컴포넌트는 **완전 제어**(useState 0) —
 * 열림/닫힘 소유는 페이지다.
 *
 * *(개념·★F-2)* `getByText(문자열)` 은 노드 전체 텍스트 **완전일치**(RNTL matches.js: exact=true,
 * 정규화는 trim + 공백 collapse) — BR-U1-30 정확 문구를 상수로 완전일치 잠금(오탈자·문구 변경을
 * red 로 잡는다). repo-trap: gorhom 목은 통과 컴포넌트라 시트 **실제 열림·딤**은 무심판(6-b 실기) —
 * 여기선 "마운트 시 내용이 있나"·"문구가 present 인가"만 잰다(★F-11).
 */

const BR_U1_30 =
  '예약 · 결제는 외부 OTA에서 진행되며, TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요.';

const ITEM: StayItem = {
  externalSource: 'NAVER',
  externalId: 's1',
  name: '해운대 오션 호텔',
  lat: 35.1587,
  lng: 129.1604,
  region: '해운대',
  amenities: ['ocean'],
  stayType: 'HOTEL',
  price: { amount: 120000, currency: 'KRW' },
};

function noop(): void {}

describe('T1 · BR-U1-30 정확 고지 (AC-8)', () => {
  it('시트가 마운트되고 BR-U1-30 정확 문구를 그린다', () => {
    render(<OtaChoiceSheet item={ITEM} onCancel={noop} onConfirm={noop} />);

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    // 완전일치 — 오탈자·문구 변형이면 red(법정성 UX).
    expect(screen.getByText(BR_U1_30)).toBeOnTheScreen();
  });
});

describe('T2 · 단일 OTA 행 (01b Q2 — 복수 이연)', () => {
  it('externalSource 이름 + 최저가를 한 행으로 그린다', () => {
    render(<OtaChoiceSheet item={ITEM} onCancel={noop} onConfirm={noop} />);

    const row = screen.getByTestId('stay-ota-option-NAVER');
    expect(row).toBeOnTheScreen();
    expect(within(row).getByText('NAVER')).toBeOnTheScreen();
    expect(within(row).getByText(formatPrice(ITEM.price))).toBeOnTheScreen();
  });
});

describe('T3 · [취소]/[이동] 배선 (AC-9)', () => {
  it('취소는 onCancel, 이동은 onConfirm 을 한 번씩 부른다', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(
      <OtaChoiceSheet item={ITEM} onCancel={onCancel} onConfirm={onConfirm} />
    );

    fireEvent.press(screen.getByTestId('stay-ota-cancel'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
