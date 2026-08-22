import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

// TRIP-445 게이트①-2 결정 A — 삭제된 프로덕션 상수 `REGIONS`를 파일 로컬 `{code,name}[]`
// 픽스처로 기계 교체(단언·동작 무변경, 위저드 화면 `regions` 계약과 같은 shape).
const REGIONS: readonly { code: string; name: string }[] = [
  { code: 'busan', name: '부산' },
  { code: 'gyeongju', name: '경주' },
  { code: 'seoul', name: '서울' },
  { code: 'jeju', name: '제주' },
  { code: 'gangneung', name: '강릉' },
  { code: 'yeosu', name: '여수' },
];

/**
 * TRIP-206 g01 오류 표면 — **화면이 그리는 네 가지 실패 얼굴**(Figma `g01 · error` 2226:1929 ·
 * `blocked-overseas` 2228:1738).
 *
 * 무엇을 보장하나: 여행지 인라인 문구 · 기간 인라인 문구(+날짜 카드 오류 얼굴) · 제출 실패
 * 배너 · 국내 차단 다이얼로그가 정본 문구 그대로 그려지고, 버튼이 콜백을 그대로 위로 올린다.
 * 그리고 **오류를 넘기지 않으면 위반이 실재해도 아무것도 안 그린다**(01b D1).
 *
 * 왜 새 파일인가: `TripWizardStep1Screen.test.tsx` 는 TRIP-205 게이트①로 승인·커밋된
 * 파일이고, 이 사이클이 고치기로 한 것은 `TripNewStep1Page.test.tsx` **하나뿐**이다(01b D8).
 * 그 파일을 건드리지 않으려고 새 파일로 나눴다 — 그래야 `it②`(:431-453)가 green 을 유지하는
 * 것이 D1 설계의 성공 판정으로 남는다.
 *
 * 커버하지 않는 것: **언제 오류가 뜨는지**(= `touched` 게이트)와 서버 400 매핑은 컨테이너
 * 몫이라 `TripNewStep1Page.integration.test.tsx` 가 본다. 이 파일은 "문구를 받으면 어떻게
 * 그리나"까지다. 픽셀 충실도(색·간격·테두리 굵기)는 [검증] 스크린샷 대조 몫이다.
 *
 * ⚠️ 매처 함정(02a ★2 · 실측): RNTL `toHaveTextContent('문자열')` 은 **완전 일치**다 —
 * 부분 문자열을 주면 실패한다. 부분 확인은 정규식으로, 정확한 문구 확인은
 * `within(x).getByText('…')` 로 한다.
 *
 * 3동작 뼈대: 준비=props 조립 → 실행=render(+press) → 단언=보이는 것 / 불린 콜백.
 */

/**
 * 이 칸이 `TripWizardStep1ScreenProps` 에 추가할 것(02a §2.1). **전부 optional 이어야 한다** —
 * 승인된 `TripWizardStep1Screen.test.tsx:39-63` 의 props 팩토리가 전 필드 전수 리터럴이라,
 * 하나라도 필수로 넣으면 그 승인 파일이 tsc 에서 깨진다(02a ★9).
 *
 * 여기 선언은 **테스트가 계약을 말하기 위한 최소 타입**이다. 구현은 같은 이름·같은 모양을
 * 실제 props 인터페이스에 더한다.
 */
interface TripWizardStep1ErrorProps {
  /** 여행지 블록 인라인 문구(완성형). 화면은 문자열을 그대로 그릴 뿐 만들지 않는다. */
  destinationError?: string;
  /** 기간 블록 인라인 문구(완성형). 있으면 날짜 카드도 오류 얼굴이 된다. */
  periodError?: string;
  /** 제출 실패 배너 **본문**(완성형). 제목·버튼 라벨은 Figma 고정이라 화면이 갖는다. */
  submitError?: string;
  /** 국내 밖 차단 다이얼로그 노출 여부. */
  overseasBlocked?: boolean;
  onRetrySubmit?(): void;
  onCloseOverseasDialog?(): void;
  onPickDomesticRegion?(): void;
}

type Props = TripWizardStep1ScreenProps & TripWizardStep1ErrorProps;

/** 기준일 2026-06-10 + `3박 4일` 프리셋이 만드는 범위(승인 파일과 같은 값). */
const START = '2026-06-10';
const END = '2026-06-13';

/** 초기(빈) 드래프트 — 오류 prop 은 하나도 없다. */
function props(over: Partial<Props> = {}): Props {
  return {
    destinations: [],
    startDate: undefined,
    endDate: undefined,
    presetCode: undefined,
    party: 1,
    companionType: undefined,
    preferenceChips: [],
    regions: REGIONS,
    canProceed: false,
    onBack: jest.fn(),
    onAddDestination: jest.fn(),
    onRemoveDestination: jest.fn(),
    onSelectPreset: jest.fn(),
    onPressPeriod: jest.fn(),
    onChangeParty: jest.fn(),
    onSelectCompanion: jest.fn(),
    onChangePreference: jest.fn(),
    onNext: jest.fn(),
    ...over,
  };
}

/** 정상적으로 다 채운 드래프트 — 부산 2박 + 경주 1박 = 3박, 기간도 3박이라 통과 상태다. */
function filledProps(over: Partial<Props> = {}): Props {
  return props({
    destinations: [
      { seq: 1, region: '부산', nights: 2 },
      { seq: 2, region: '경주', nights: 1 },
    ],
    startDate: START,
    endDate: END,
    presetCode: '3n4d',
    party: 2,
    companionType: '친구',
    preferenceChips: ['미식', '전시', '야경'],
    canProceed: true,
    ...over,
  });
}

function root() {
  return screen.getByTestId('trip-wizard-step1-root');
}

describe('S-1 · AC-3 — 여행지 블록 인라인 문구 (Figma 2228:1737)', () => {
  it('받은 문구를 그대로 그리고, 다른 숫자를 주면 그대로 바뀐다', () => {
    // 준비 — 화면은 판정을 안 한다. 완성된 문자열 하나를 받을 뿐이다(01b D1).
    const first = '숙소 박수(5박)가 여행 기간(3박)보다 많아요';
    const { rerender } = render(
      <TripWizardStep1Screen {...props({ destinationError: first })} />
    );

    // 단언 ① — 여행지 블록 자리에 정확히 그 문구가 있다.
    expect(
      within(screen.getByTestId('trip-wizard-error-destination')).getByText(
        first
      )
    ).toBeOnTheScreen();

    // 실행 + 단언 ② — 숫자가 다른 문구를 주면 화면도 따라 바뀐다. 이게 없으면 문구를
    // **하드코딩한** 화면도 위 단언을 통과한다(숫자 2개가 동적이라는 것이 AC-3 의 핵심).
    const second = '숙소 박수(4박)가 여행 기간(1박)보다 많아요';
    rerender(
      <TripWizardStep1Screen {...props({ destinationError: second })} />
    );
    expect(
      within(screen.getByTestId('trip-wizard-error-destination')).getByText(
        second
      )
    ).toBeOnTheScreen();
    expect(screen.queryByText(first)).toBeNull();

    // 단언 ③ (짝, 부정) — 여행지 오류 하나를 줬다고 다른 표면이 딸려 나오지 않는다.
    expect(screen.queryByTestId('trip-wizard-error-period')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();
  });
});

describe('S-2 · AC-2 — 기간 인라인 문구 + 날짜 카드 오류 얼굴 (Figma 2226:2119 · 2226:2023)', () => {
  it('기간 오류가 서면 날짜 카드의 보조 문구가 교체된다', () => {
    // 준비 — Figma error 프레임의 인스턴스 값(역전된 날짜 범위)과 같은 상태다.
    render(
      <TripWizardStep1Screen
        {...props({
          startDate: START,
          endDate: END,
          presetCode: '3n4d',
          periodError: '종료일이 시작일보다 빨라요',
        })}
      />
    );

    // 단언 ① — 기간 블록 인라인 문구.
    expect(
      within(screen.getByTestId('trip-wizard-error-period')).getByText(
        '종료일이 시작일보다 빨라요'
      )
    ).toBeOnTheScreen();

    // 단언 ② — 날짜 카드 안 보조 문구가 오류 문구로 바뀐다.
    const dateField = screen.getByTestId('trip-wizard-date-field');
    expect(
      within(dateField).getByText('날짜를 다시 확인해주세요')
    ).toBeOnTheScreen();

    // 단언 ③ — **교체지 추가가 아니다.** 평소 문구가 사라져야 한다(Figma §3.3 ③ 실측:
    // 2행이 바뀌는 것이지 3행이 되는 것이 아니다).
    expect(
      within(dateField).queryByText('선택한 프리셋으로 자동 채움')
    ).toBeNull();

    // 단언 ④ (짝, 긍정) — 그렇다고 카드가 날짜를 잃지는 않는다. 사용자는 무엇이 잘못된
    // 범위인지 여전히 봐야 한다. (부분 확인이라 정규식을 쓴다 — 02a ★2)
    expect(dateField).toHaveTextContent(/6월 10일 – 6월 13일/);
  });
});

describe('S-3 · 짝 — 기간 오류가 없으면 날짜 카드는 기본 얼굴이다', () => {
  it('오류를 안 넘기면 보조 문구가 평소 문구 그대로다', () => {
    // 이 대조군이 없으면 **항상 오류 얼굴인** 날짜 카드도 S-2 를 통과한다.
    render(
      <TripWizardStep1Screen
        {...props({ startDate: START, endDate: END, presetCode: '3n4d' })}
      />
    );

    const dateField = screen.getByTestId('trip-wizard-date-field');
    expect(
      within(dateField).getByText('선택한 프리셋으로 자동 채움')
    ).toBeOnTheScreen();
    expect(
      within(dateField).queryByText('날짜를 다시 확인해주세요')
    ).toBeNull();
  });
});

describe('S-4 · AC-5 — 제출 실패 배너 (Figma 2226:2120)', () => {
  it('고정 제목과 받은 본문을 함께 보여주고, 다시 시도가 위로 올라간다', () => {
    // 준비 — 본문만 prop 이다. 제목·버튼 라벨은 Figma 고정 문구라 화면이 갖는다.
    const onRetrySubmit = jest.fn();
    render(
      <TripWizardStep1Screen
        {...filledProps({
          submitError: '네트워크를 확인하고 다시 시도해주세요',
          onRetrySubmit,
        })}
      />
    );

    const banner = screen.getByTestId('trip-wizard-submit-banner');

    // 단언 ① — INV-4 의 실체. 실패 사유가 화면에 **보인다**.
    expect(
      within(banner).getByText('여행을 만들지 못했어요')
    ).toBeOnTheScreen();
    expect(
      within(banner).getByText('네트워크를 확인하고 다시 시도해주세요')
    ).toBeOnTheScreen();

    // 단언 ② — 막다른 길이 아니다. 되돌아갈 버튼이 있다.
    const retry = within(banner).getByTestId('trip-wizard-submit-banner-retry');
    expect(within(retry).getByText('다시 시도')).toBeOnTheScreen();

    // 실행 + 단언 ③ — 버튼은 판단하지 않고 그대로 위로 올린다.
    fireEvent.press(retry);
    expect(onRetrySubmit).toHaveBeenCalledTimes(1);
  });
});

describe('S-5 · AC-4 — 국내 차단 다이얼로그 (Figma 2228:1924)', () => {
  it('정본 문구 6개를 그리고, 뒤 화면의 입력이 그대로 남아 있다', () => {
    render(
      <TripWizardStep1Screen {...filledProps({ overseasBlocked: true })} />
    );

    const dialog = screen.getByTestId('trip-wizard-overseas-dialog');

    // 단언 ① — BR-U1-35 가 정본에 문자 그대로 박아 둔 문장이다(발명 여지 0).
    expect(
      within(dialog).getByText('지금은 국내 여행만 지원해요')
    ).toBeOnTheScreen();
    // 본문 2줄 — Figma 가 두 텍스트 노드로 나눠 뒀다.
    expect(
      within(dialog).getByText('해외 여행지는 준비 중이에요.')
    ).toBeOnTheScreen();
    expect(
      within(dialog).getByText('국내 도시로 만들어볼까요?')
    ).toBeOnTheScreen();
    // 버튼 2개.
    expect(
      within(
        within(dialog).getByTestId('trip-wizard-overseas-dialog-confirm')
      ).getByText('국내 도시 고르기')
    ).toBeOnTheScreen();
    expect(
      within(
        within(dialog).getByTestId('trip-wizard-overseas-dialog-close')
      ).getByText('닫기')
    ).toBeOnTheScreen();

    // 단언 ② (짝, 긍정) — **드래프트가 그대로 보인다.** Figma 스크린샷에서 다이얼로그
    // 뒤로 부산·경주 칩이 살아 있는 것이 AC-4 "드래프트를 유지한다"의 시각적 근거다.
    // 입력을 지우고 다이얼로그만 띄우는 구현은 여기서 걸린다.
    expect(
      screen.getByTestId('trip-wizard-destination-busan')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('trip-wizard-date-field')).toHaveTextContent(
      /6월 10일 – 6월 13일/
    );
  });

  it('국내 도시 고르기는 도시 추가 시트를 열고, 닫기는 닫기만 한다 (01b D5)', () => {
    const onPickDomesticRegion = jest.fn();
    const onCloseOverseasDialog = jest.fn();

    // ── 국내 도시 고르기 ──
    const { unmount } = render(
      <TripWizardStep1Screen
        {...filledProps({
          overseasBlocked: true,
          onPickDomesticRegion,
          onCloseOverseasDialog,
        })}
      />
    );

    // 준비 확인(앵커) — 아직 시트는 닫혀 있다.
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();

    fireEvent.press(screen.getByTestId('trip-wizard-overseas-dialog-confirm'));

    // 새 라우트로 나가지 않는다 — TRIP-205 가 만든 **위저드 안** 도시 시트를 연다(D5).
    expect(
      screen.getByTestId('trip-wizard-destination-sheet')
    ).toBeOnTheScreen();
    expect(onPickDomesticRegion).toHaveBeenCalledTimes(1);
    unmount();

    // ── 닫기 ──
    onPickDomesticRegion.mockClear();
    onCloseOverseasDialog.mockClear();
    render(
      <TripWizardStep1Screen
        {...filledProps({
          overseasBlocked: true,
          onPickDomesticRegion,
          onCloseOverseasDialog,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-overseas-dialog-close'));

    expect(onCloseOverseasDialog).toHaveBeenCalledTimes(1);
    // 짝(부정) — 닫기가 시트를 열거나 다른 콜백을 부르지 않는다.
    expect(screen.queryByTestId('trip-wizard-destination-sheet')).toBeNull();
    expect(onPickDomesticRegion).not.toHaveBeenCalled();
  });
});

describe('S-6 · AC-9 — 화면은 오류를 스스로 도출하지 않는다 (01b D1 잠금)', () => {
  it('위반이 실재해도 오류를 안 넘기면 오류 표면이 하나도 없다', () => {
    // 준비 — 부산 5박인데 기간은 3박. `NIGHTS_EXCEED_PERIOD` 가 실제로 서는 상태다.
    render(
      <TripWizardStep1Screen
        {...filledProps({
          destinations: [{ seq: 1, region: '부산', nights: 5 }],
          canProceed: false,
        })}
      />
    );

    // 단언 ① — 이 칸이 새로 만든 표면 넷이 전부 없다. 화면이 `validateTripDraft` 를
    // 몰래 부르거나 상태를 보고 스스로 판정하면 여기서 걸린다.
    expect(screen.queryByTestId('trip-wizard-error-destination')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-error-period')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-submit-banner')).toBeNull();
    expect(screen.queryByTestId('trip-wizard-overseas-dialog')).toBeNull();

    // 단언 ② (짝, 긍정) — **이게 없으면 아무것도 안 그리는 화면이 위를 공짜로 통과한다**
    // (02a ★3). 화면은 실제로 그려졌고, 대신 게이트가 닫혀 있다.
    expect(root()).toHaveTextContent(/어디로 갈까요\?/);
    expect(root()).toHaveTextContent(/부산/);
    expect(screen.getByTestId('trip-wizard-step1-next')).toBeDisabled();
  });
});

describe('S-7 · INV-3 — 새로 그리는 어떤 문구에도 소요 시간이 없다', () => {
  it('오류 표면을 전부 켜도 소요 시간 문자열이 나타나지 않는다', () => {
    render(
      <TripWizardStep1Screen
        {...filledProps({
          destinationError: '숙소 박수(5박)가 여행 기간(3박)보다 많아요',
          periodError: '종료일이 시작일보다 빨라요',
          submitError: '네트워크를 확인하고 다시 시도해주세요',
          overseasBlocked: true,
        })}
      />
    );

    expect(root()).not.toHaveTextContent(/소요/);
    expect(root()).not.toHaveTextContent(/\d+\s*분/);
    expect(root()).not.toHaveTextContent(/\d+\s*시간/);

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤다는 증거이자, 위 정규식이 이 화면의 정상
    // 표기(박·명)를 오탐하지 않는다는 확인이다.
    expect(root()).toHaveTextContent(/박/);
    expect(root()).toHaveTextContent(/여행을 만들지 못했어요/);
  });
});
