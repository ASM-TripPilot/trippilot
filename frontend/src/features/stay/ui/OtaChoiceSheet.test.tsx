import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import type { StayItem } from '@/shared/api/generated/schemas';
import { formatPrice } from '@/entities/stay/lib/formatPrice';
import { OtaChoiceSheet, type OtaChoiceSheetProps } from './OtaChoiceSheet';

/**
 * TRIP-457 AC-8·AC-9 · TRIP-781(l07 1615:2440 default · 1616:2440 error) — 제휴 고지 시트의
 * 렌더·배선 계약.
 *
 * 무엇을 보장하나: 딥링크 이동 **전** 제휴 고지(BR-U1-30 법정성 UX)를 l07 두 문장(본문 + 안내 박스)으로
 * 띄우고, "다시 보지 않기" 체크박스·OTA 라벨 버튼을 둔다. 이동이 실패하면 error 얼굴(BR-U1-55)로
 * 바뀐다. 이 컴포넌트는 **완전 제어**(useState 0) — 열림·체크·error 상태의 주인은 페이지다.
 *
 * `getByText(문자열)` 은 노드 전체 텍스트 **완전일치**(RNTL 13.3.3) — 문구는 테스트 리터럴로 잠근다
 * (config 상수를 import 하면 "상수 = 상수"라 오탈자를 못 잡는다). gorhom 목은 통과 컴포넌트라
 * 시트 실제 열림·딤은 무심판(6-b 실기).
 */

const OLD_BR_U1_30 =
  '예약 · 결제는 외부 OTA에서 진행되며, TripPilot은 제휴(어필리에이트) 수수료를 받을 수 있어요.';
// 가운뎃점은 Figma 원문 그대로 U+00B7.
const BODY =
  '외부 OTA 사이트로 이동하며, 실제 예약·결제는 해당 사이트에서 진행됩니다.';
const NOTICE =
  '이 링크를 통한 예약 시 TripPilot이 제휴 수수료를 받을 수 있습니다 (추가 비용 없음).';
const TITLE = '외부 사이트로 이동';
const DONT_SHOW = '이 안내를 다시 보지 않기';
const ERROR_TITLE = '링크를 열 수 없습니다';
const ERROR_BODY = '잠시 후 다시 시도하세요.';
const ERROR_BOX = '외부 링크 URL을 확인할 수 없거나 연결에 실패했습니다.';

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

function sheetProps(
  overrides: Partial<OtaChoiceSheetProps> = {}
): OtaChoiceSheetProps {
  return {
    item: ITEM,
    dontShowAgain: false,
    onToggleDontShowAgain: noop,
    onCancel: noop,
    onConfirm: noop,
    onRetry: noop,
    ...overrides,
  };
}

function classesOf(testID: string): string[] {
  return String(screen.getByTestId(testID).props.className ?? '').split(/\s+/);
}

describe('T1 · l07 default 고지 문구 (TRIP-781 AC-1 · BR-U1-30)', () => {
  it('제목·본문·안내 박스 문구를 완전일치로 그린다', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    // NAVER 픽스처라 버튼은 '네이버로 이동' — 제목과 글자가 겹치지 않아 getByText 가 하나만 잡는다.
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-ota-notice-box')).getByText(NOTICE)
    ).toBeOnTheScreen();
  });

  it('옛 BR-U1-30 문장은 완전일치로도, 조각으로도 남지 않는다', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    expect(screen.queryByText(OLD_BR_U1_30)).toBeNull();
    expect(screen.queryByText(/어필리에이트/)).toBeNull();
  });
});

describe('T2 · 단일 OTA 행 (01b Q2 — 복수 이연 · TRIP-781 AC-5 유지 · TRIP-988 B-2)', () => {
  // TRIP-988 D4 — 옛 계약은 행에 코드 원문('NAVER')을 그렸다. 새 계약은 사전 표시명이다.
  it('사전에 있는 코드(NAVER)는 표시명 "네이버" + 최저가를 한 행으로 그리고, 코드 원문은 없다', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    const row = screen.getByTestId('stay-ota-option-NAVER');
    expect(row).toBeOnTheScreen();
    expect(within(row).getByText('네이버')).toBeOnTheScreen();
    expect(within(row).getByText(formatPrice(ITEM.price))).toBeOnTheScreen();
    expect(within(row).queryAllByText(/NAVER/).length).toBe(0);
  });
});

describe('T3 · [취소]/[이동] 배선과 이동 라벨 (AC-9 · TRIP-781 AC-3)', () => {
  it('취소는 onCancel, 이동은 onConfirm 을 한 번씩 부른다', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    render(<OtaChoiceSheet {...sheetProps({ onCancel, onConfirm })} />);

    fireEvent.press(screen.getByTestId('stay-ota-cancel'));
    fireEvent.press(screen.getByTestId('stay-ota-confirm'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('사전에 있는 코드(NAVER)는 "네이버로 이동" 라벨이다', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    expect(
      within(screen.getByTestId('stay-ota-confirm')).getByText('네이버로 이동')
    ).toBeOnTheScreen();
  });

  it('모르는 코드(LOCALDATA)는 코드값 대신 "외부 사이트로 이동" 라벨이다', () => {
    render(
      <OtaChoiceSheet
        {...sheetProps({ item: { ...ITEM, externalSource: 'LOCALDATA' } })}
      />
    );

    // 폴백 라벨이 제목과 같은 글자라 화면 전체 getByText 는 2개에 걸린다 — 버튼 안으로 좁힌다.
    const confirm = screen.getByTestId('stay-ota-confirm');
    expect(within(confirm).getByText(TITLE)).toBeOnTheScreen();
    expect(within(confirm).queryByText(/LOCALDATA/)).toBeNull();
  });
});

describe('T4 · OTA 행 선두 라디오 (TRIP-728 · AC-1 · AC-2)', () => {
  it('선두가 selected 라디오이고 채움 inner 가 존재한다 (AC-1)', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    // 라디오 = View 조합(accessibilityRole="radio" + accessibilityState.selected) — StayPriceSheet 미러.
    // toBeSelected() 는 accessibilityState.selected(불리언)만 본다(RNTL 13.3.3 to-be-selected.js).
    // SVG 글리프가 아니라 View 라서 선택을 관측할 수 있다 — 글리프 fill 은 렌더 트리에 안 남아
    // 무심판이다(★F-3, 725 저장 하트 선례).
    expect(screen.getByTestId('stay-ota-radio-NAVER')).toBeSelected();
    // 채움 inner = 두 번째 신호(존재). 채움 색(분홍)은 6-b/TRIP-831 육안 몫이다(★F-1).
    expect(screen.getByTestId('stay-ota-radio-fill-NAVER')).toBeOnTheScreen();
  });

  it('행 배경 흰(bg-canvas) + 선택 테두리(border-primary) 회귀 방지 (AC-2)', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    // className 은 jest 렌더 트리에 평문 prop 으로 남는다(style 은 undefined). 색 자체가 아니라
    // 토큰 문자열 존재만 잰다(실제 픽셀은 6-b).
    const classes = classesOf('stay-ota-option-NAVER');
    expect(classes).toContain('bg-canvas');
    expect(classes).toContain('border-primary');
  });
});

describe('T5 · "다시 보지 않기" 체크박스 = 제어 prop (TRIP-781 AC-2)', () => {
  it('prop 이 false 면 해제 모양, true 면 체크 모양(분홍 네모)이다', () => {
    const { rerender } = render(<OtaChoiceSheet {...sheetProps()} />);

    const row = screen.getByTestId('stay-ota-dont-show');
    expect(row).not.toBeChecked();
    expect(within(row).getByText(DONT_SHOW)).toBeOnTheScreen();
    expect(classesOf('stay-ota-dont-show-box')).toContain('bg-canvas');

    rerender(<OtaChoiceSheet {...sheetProps({ dontShowAgain: true })} />);

    expect(screen.getByTestId('stay-ota-dont-show')).toBeChecked();
    expect(classesOf('stay-ota-dont-show-box')).toContain('bg-primary');
  });

  it('누르면 onToggleDontShowAgain 만 부르고, prop 이 그대로면 체크 모양도 그대로다', () => {
    const onToggleDontShowAgain = jest.fn();
    render(<OtaChoiceSheet {...sheetProps({ onToggleDontShowAgain })} />);

    fireEvent.press(screen.getByTestId('stay-ota-dont-show'));

    expect(onToggleDontShowAgain).toHaveBeenCalledTimes(1);
    // 시트가 스스로 체크 상태를 쥐면 여기서 체크로 바뀐다 — 주인은 페이지다.
    expect(screen.getByTestId('stay-ota-dont-show')).not.toBeChecked();
  });
});

describe('T6 · error 얼굴 (TRIP-781 AC-4 · BR-U1-55)', () => {
  it('error 제목·본문·오류 박스 문구를 완전일치로 그린다', () => {
    render(<OtaChoiceSheet {...sheetProps({ variant: 'error' })} />);

    expect(screen.getByTestId('stay-ota-sheet')).toBeOnTheScreen();
    expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen();
    expect(screen.getByText(ERROR_BODY)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-ota-error-box')).getByText(ERROR_BOX)
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('stay-ota-retry')).getByText('다시 시도')
    ).toBeOnTheScreen();
  });

  it('체크박스·OTA 행·이동 버튼·안내 박스·default 본문이 없다', () => {
    render(<OtaChoiceSheet {...sheetProps({ variant: 'error' })} />);

    // 긍정 앵커 — error 얼굴이 실제로 그려졌다.
    expect(screen.getByText(ERROR_TITLE)).toBeOnTheScreen();
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
    expect(screen.queryByTestId('stay-ota-option-NAVER')).toBeNull();
    expect(screen.queryByTestId('stay-ota-confirm')).toBeNull();
    expect(screen.queryByTestId('stay-ota-notice-box')).toBeNull();
    expect(screen.queryByText(BODY)).toBeNull();
  });

  it('[다시 시도]는 onRetry, [취소]는 onCancel 을 한 번씩 부른다', () => {
    const onRetry = jest.fn();
    const onCancel = jest.fn();
    render(
      <OtaChoiceSheet
        {...sheetProps({ variant: 'error', onRetry, onCancel })}
      />
    );

    fireEvent.press(screen.getByTestId('stay-ota-retry'));
    fireEvent.press(screen.getByTestId('stay-ota-cancel'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('T7 · 구조 토큰 (TRIP-781 AC-6 — 픽셀 아님, 토큰 문자열 존재만)', () => {
  it('default: 안내 박스는 surface-soft r12, 두 버튼은 절반씩(flex-1)이다', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    expect(classesOf('stay-ota-notice-box')).toEqual(
      expect.arrayContaining(['bg-surface-soft', 'rounded-button'])
    );
    expect(classesOf('stay-ota-cancel')).toContain('flex-1');
    expect(classesOf('stay-ota-cancel')).not.toContain('w-[110px]');
    expect(classesOf('stay-ota-confirm')).toContain('flex-1');
  });

  it('error: 오류 박스는 점선 테두리 r12, 두 버튼은 절반씩(flex-1)이다', () => {
    render(<OtaChoiceSheet {...sheetProps({ variant: 'error' })} />);

    expect(classesOf('stay-ota-error-box')).toEqual(
      expect.arrayContaining([
        'border-dashed',
        'border-hairline-strong',
        'rounded-button',
      ])
    );
    expect(classesOf('stay-ota-cancel')).toContain('flex-1');
    expect(classesOf('stay-ota-retry')).toContain('flex-1');
  });
});

describe('T8 · "다시 보지 않기" 표시 여부 prop (TRIP-778 D9 — 게스트는 저장할 곳이 없다)', () => {
  it('showDontShowAgain=false 면 체크박스가 없고, 고지 본문·안내 박스·[이동]은 그대로다', () => {
    render(<OtaChoiceSheet {...sheetProps({ showDontShowAgain: false })} />);

    // 긍정 앵커 — default 얼굴이 실제로 그려졌다(법정 고지는 게스트에게도 그대로).
    expect(screen.getByText(BODY)).toBeOnTheScreen();
    expect(screen.getByTestId('stay-ota-notice-box')).toBeOnTheScreen();
    expect(screen.getByTestId('stay-ota-confirm')).toBeOnTheScreen();
    // 단언: 체크박스와 그 문구가 없다.
    expect(screen.queryByTestId('stay-ota-dont-show')).toBeNull();
    expect(screen.queryByText(DONT_SHOW)).toBeNull();
  });

  it('prop 을 생략하면(기본값) 체크박스가 있다 — 로그인 사용자·기존 소비처 무회귀', () => {
    render(<OtaChoiceSheet {...sheetProps()} />);

    expect(screen.getByTestId('stay-ota-dont-show')).toBeOnTheScreen();
  });
});

/**
 * TRIP-988 B(BR-U1-30 · BR-U1-31 · US-STAY-05 · D4) — 옵션 행에 내부 코드 대신 사용자가 읽을 이름.
 *
 * 무엇을 보장하나: 사전에 없는 코드(`LOCALDATA`·`STUB`·미등록)는 "외부 사이트"로 접히고, 코드 문자열은
 * 시트 어디에도 **보이는 글자로** 남지 않는다. 행 자체와 가격은 남는다. testID
 * `stay-ota-option-{코드}` 는 글자가 아니라 그대로 둔다(`queryAllByText` 는 testID 를 안 본다).
 * `constructor` 는 사전이 객체 리터럴이면 프로토타입 멤버를 집어 오는 함정 입력이다.
 */
describe('T9 · OTA 행 표시명 (TRIP-988 B-1 · B-2)', () => {
  it('AGODA 는 표시명 "아고다"로 그리고 코드 원문은 없다', () => {
    render(
      <OtaChoiceSheet
        {...sheetProps({ item: { ...ITEM, externalSource: 'AGODA' } })}
      />
    );

    const row = screen.getByTestId('stay-ota-option-AGODA');
    expect(within(row).getByText('아고다')).toBeOnTheScreen();
    expect(screen.queryAllByText(/AGODA/).length).toBe(0);
  });

  it.each(['LOCALDATA', 'STUB', 'KAKAO', 'constructor'])(
    '사전에 없는 코드 %s 는 행에 "외부 사이트"로 그리고, 코드 글자는 시트 어디에도 없다',
    (code) => {
      // 준비 — 사전에 없는 코드를 가진 숙소.
      const item: StayItem = { ...ITEM, externalSource: code };

      // 실행
      render(<OtaChoiceSheet {...sheetProps({ item })} />);

      // 단언 — 행은 남고(testID 유지), 표시명은 폴백, 가격도 그대로다.
      const row = screen.getByTestId(`stay-ota-option-${code}`);
      expect(within(row).getByText('외부 사이트')).toBeOnTheScreen();
      expect(within(row).getByText(formatPrice(ITEM.price))).toBeOnTheScreen();
      // 단언 — 행만이 아니라 시트 전체에서 코드 글자가 0개다(제목·버튼으로 새는 것도 잡는다).
      // 노드 배열을 matcher 에 그대로 넘기면 실패 메시지 직렬화가 순환 참조로 죽는다 — 개수만 비교한다.
      expect(screen.queryAllByText(new RegExp(code)).length).toBe(0);
    }
  );
});
