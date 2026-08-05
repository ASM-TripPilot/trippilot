import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { REGIONS } from '@/features/explore/model/regions';

import type { StayImportView } from '../model/stayDateImport';
import { TripWizardStep1Screen } from './TripWizardStep1Screen';
import type { TripWizardStep1ScreenProps } from './TripWizardStep1Screen';

/**
 * TRIP-208 g01 등록 숙소 날짜 연계 행 — **화면이 그리는 표면**(Figma `stayImportRow` 3변형:
 * `2225:2362` 활성 · `2226:2026` 비활성+사유 · `2226:1829` 대안).
 *
 * 무엇을 보장하나: 이 행이 기간 블록 안(날짜 카드·기간 오류 뒤, 인원 앞)에 서고, **완성된
 * 얼굴 prop 하나로만** 네 모습(로딩 자리표시 · 활성 · 비활성+사유 · 대안)이 갈리며, 조회
 * 실패 표시가 **얼굴을 덮지 않고 덧붙기만** 한다(01b D4). 화면은 숙소 목록도 조회 상태도
 * 모른다 — 판정·문구 조립은 전부 `TripNewStep1Page`가 끝낸다(AC-13).
 *
 * 왜 새 파일인가: `TripWizardStep1Screen.test.tsx`·`…errors.test.tsx`·`…budget.test.tsx`는
 * 게이트①로 승인·동결된 파일이다. 이 사이클이 그중 손대는 것은 첫 파일의 AC-13 **한 it뿐**
 * 이고(02a §6-1), 나머지는 한 줄도 건드리지 않는다.
 *
 * 커버하지 않는 것: **언제** 어느 얼굴이 서는지(= 판정 규칙)는 `stayDateImport.test.ts`가,
 * 조회·가져오기 배선은 `TripNewStep1Page.stayImport.test.tsx`가 본다. 색(`#C2CCD6`)·점선
 * 테두리·아이콘 path 같은 픽셀 충실도는 [검증] 스크린샷 대조 몫이다.
 *
 * ⚠️ 매처 함정(02a ★6 · §5-1 실측): `toHaveTextContent('문자열')`은 **완전 일치**다 —
 * `해운대 호텔 · 6.10~6.13`에 `toHaveTextContent('6.10~6.13')`은 실패한다. 부분 확인은
 * 정규식으로, 정확한 문구는 `within(x).getByText('…')`로 한다.
 *
 * 3동작 뼈대: 준비=props 조립(얼굴 prop 포함) → 실행=render(+press) → 단언=보이는 것 / 콜백.
 */

/**
 * 이 칸이 `TripWizardStep1ScreenProps`에 추가할 것(02a §2-4). **전부 optional이어야 한다** —
 * 승인된 세 파일의 props 팩토리가 전 필드 전수 리터럴이라, 하나라도 필수로 만들면 그 승인
 * 파일들이 tsc에서 깨진다(02a ★4 — TRIP-206·207이 각각 밟은 함정).
 */
interface TripWizardStep1StayImportProps {
  /** 이 행이 그릴 얼굴(완성형). **없으면 로딩 자리표시** — 컨테이너가 아직 판정을 안 내려줬다. */
  stayImport?: StayImportView;
  /** 조회가 실패했나. 얼굴은 그대로 두고 재시도 행만 덧붙인다(01b D4). */
  stayImportFailed?: boolean;
  onImportStayDates?(): void;
  onPressRegisterStay?(): void;
  onRetryStayImport?(): void;
}

type Props = TripWizardStep1ScreenProps & TripWizardStep1StayImportProps;

/** Figma `2225:2362` 실측 문구 3종. 부제의 가운뎃점은 U+00B7, 물결표는 ASCII(U+007E)다 —
 * 날짜 카드의 en dash(U+2013)와 다른 문자다(02a ★5). */
const IMPORT_TITLE = '등록 숙소에서 날짜 가져오기';
const READY_NOTE = '해운대 호텔 · 6.10~6.13';

/** Figma `2226:2034` 실측 확정값. 나머지 두 사유는 발명 문자열이다(01b §9). */
const REASON_NO_DATES = '등록 숙소에 체크인·체크아웃이 없어요';
const REASON_PERIOD_FILLED = '이미 입력한 기간이 있어요';
const REASON_MULTIPLE_STAYS = '여러 숙소가 등록돼 있어요';

/** Figma `2226:1829`(대안) 실측 문구 3종. */
const EMPTY_TITLE = '등록한 숙소가 없어요';
const REGISTER_LABEL = '숙소 등록';
const MANUAL_LABEL = '날짜 직접 입력';

/** 조회 실패 행 — Figma에 프레임이 없는 발명 문구다(01b §9). */
const RETRY_TITLE = '숙소를 불러오지 못했어요';
const RETRY_ACTION = '다시 시도';

const READY: StayImportView = {
  kind: 'ready',
  note: READY_NOTE,
  checkIn: '2026-06-10',
  checkOut: '2026-06-13',
};

/** 기준일 2026-06-10 + `3박 4일` 프리셋이 만드는 범위(승인 파일과 같은 값). */
const START = '2026-06-10';
const END = '2026-06-13';

/** 초기(빈) 드래프트 — 등록 숙소 prop은 하나도 없다. */
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

/** 정상적으로 다 채운 드래프트(승인 파일과 같은 값). */
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

function block() {
  return screen.getByTestId('trip-wizard-stayimport-block');
}

function note() {
  return screen.getByTestId('trip-wizard-stayimport-note');
}

function fetchButton() {
  return screen.getByTestId('trip-wizard-fetch-staydates');
}

describe('AC-1 · 얼굴 A(활성) — Figma 2225:2362', () => {
  it('제목 · 부제(숙소명 · 기간) · 가져오기가 한 행에 있다', () => {
    render(<TripWizardStep1Screen {...props({ stayImport: READY })} />);

    const row = block();
    expect(within(row).getByText(IMPORT_TITLE)).toBeOnTheScreen();
    // 부제는 `{숙소명} · {기간}` 합성 문자열이다 — 정확한 문구로 못박는다. 부분 확인이
    // 필요하면 정규식을 써야 한다(문자열 매처는 완전 일치라 조각으로는 실패한다).
    expect(within(note()).getByText(READY_NOTE)).toBeOnTheScreen();
    expect(within(row).getByText('가져오기')).toBeOnTheScreen();
  });

  it('기간 블록 안 — 날짜 카드·기간 오류 뒤, 인원 앞에 놓인다 (Figma 4프레임 공통)', () => {
    // 준비 — 기간 오류까지 떠 있는 상태라야 "오류 뒤"라는 순서를 실제로 확인할 수 있다
    // (Figma `error` 프레임 2226:1929가 그 순서를 확정했다).
    render(
      <TripWizardStep1Screen
        {...filledProps({
          stayImport: READY,
          periodError: '종료일이 시작일보다 빨라요',
        })}
      />
    );

    // *(개념)* `getAllByTestId`에 정규식을 주면 매칭된 요소를 **트리 순서(pre-order)** 로
    // 돌려준다(02a §5-5 실행 확인). "무엇이 먼저 그려지는가"를 배열 비교 한 줄로 잠근다.
    const order = screen
      .getAllByTestId(
        /^trip-wizard-(date-field|error-period|stayimport-block|party-stepper)$/
      )
      .map((element) => element.props.testID);

    expect(order).toEqual([
      'trip-wizard-date-field',
      'trip-wizard-error-period',
      'trip-wizard-stayimport-block',
      'trip-wizard-party-stepper',
    ]);
  });

  it('가져오기를 누르면 콜백이 올라간다 — 화면은 날짜를 모른다', () => {
    const onImportStayDates = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({ stayImport: READY, onImportStayDates })}
      />
    );

    const button = fetchButton();
    // 짝 — 활성 얼굴에서는 실제로 열려 있다. 이게 없으면 "항상 비활성"인 구현이
    // 아래 얼굴 B 단언을 공짜로 통과한다.
    expect(button).toBeEnabled();

    fireEvent.press(button);

    expect(onImportStayDates).toHaveBeenCalledTimes(1);
  });
});

describe('AC-4 · AC-5 · AC-6 · 얼굴 B(비활성 + 사유) — Figma 2226:2026', () => {
  it('⚠️ 라벨은 분홍 그대로인데 눌리지는 않는다 (01b D9)', () => {
    const onImportStayDates = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          stayImport: { kind: 'blocked', note: REASON_PERIOD_FILLED },
          onImportStayDates,
        })}
      />
    );

    // Figma가 준 유일한 비활성 신호는 "제목 회색 + 사유 문구"뿐이다 — `가져오기` 라벨은
    // 활성색 그대로 남는다(`2226:2036` 실측). 즉 **눈으로는 활성과 구별되지 않는다.**
    expect(within(block()).getByText('가져오기')).toBeOnTheScreen();
    expect(within(note()).getByText(REASON_PERIOD_FILLED)).toBeOnTheScreen();

    // ⚠️ 두 단언이 **둘 다** 필요하다. `toBeDisabled()`는 `accessibilityState.disabled`만
    // 읽으므로, 접근성 상태만 켜고 `disabled` prop을 빠뜨린 버튼은 **매처를 통과하면서
    // 그대로 눌린다**(02a ★3 · 리포 3회 실측). 그러면 BR-U1-41의 "임의 덮어쓰기 금지"가
    // 조용히 깨진다.
    expect(fetchButton()).toBeDisabled();
    fireEvent.press(fetchButton());
    expect(onImportStayDates).not.toHaveBeenCalled();
  });

  const REASONS = [
    { name: '① 기간 이미 입력', text: REASON_PERIOD_FILLED },
    { name: '② 다중 숙소', text: REASON_MULTIPLE_STAYS },
    { name: '③ 날짜 없음(Figma 확정)', text: REASON_NO_DATES },
  ];

  it.each(REASONS)('$name 사유를 받은 그대로 그린다', ({ text }) => {
    // 화면은 사유를 **고르지 않는다** — 완성된 문자열을 받아 그릴 뿐이다(TRIP-206 D1 관례).
    // 우선순위 판정은 `stayDateImport.ts`가 이미 끝냈다.
    render(
      <TripWizardStep1Screen
        {...props({ stayImport: { kind: 'blocked', note: text } })}
      />
    );

    expect(within(note()).getByText(text)).toBeOnTheScreen();
    // 제목은 활성과 같다(Figma 2226:2033) — 행이 통째로 사라지는 게 아니다.
    expect(within(block()).getByText(IMPORT_TITLE)).toBeOnTheScreen();
  });
});

describe('AC-2 · 얼굴 C(대안) — Figma 2226:1829', () => {
  it('안내 문구와 두 버튼이 세로로 선다', () => {
    render(
      <TripWizardStep1Screen {...props({ stayImport: { kind: 'empty' } })} />
    );

    const row = block();
    expect(within(row).getByText(EMPTY_TITLE)).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-wizard-register-stay')).getByText(
        REGISTER_LABEL
      )
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId('trip-wizard-manual-dates')).getByText(
        MANUAL_LABEL
      )
    ).toBeOnTheScreen();
  });

  it('가져오기가 아예 없다 — 숨김이 아니라 행 전체가 교체된다', () => {
    render(
      <TripWizardStep1Screen {...props({ stayImport: { kind: 'empty' } })} />
    );

    // Figma는 가로 행(실선)을 세로 스택(점선)으로 통째로 바꾼다. `가져오기` 텍스트 노드가
    // 그 프레임에 **존재하지 않는다**(2226:1829 실측) — 제목 `등록 숙소에서 날짜 가져오기`도
    // 함께 사라지므로 `/가져오기/` 정규식 하나로 둘 다 잡힌다.
    expect(screen.queryByTestId('trip-wizard-fetch-staydates')).toBeNull();
    expect(block()).not.toHaveTextContent(/가져오기/);

    // 짝(긍정) — **이게 없으면 행을 아예 안 그리는 구현이 위 두 줄을 공짜로 통과한다**
    // (02a ★7 · §5-1 실측: 빈 요소에 부정 단언은 PASS다).
    expect(within(block()).getByText(EMPTY_TITLE)).toBeOnTheScreen();
  });

  it('AC-10 · 두 버튼이 각자 제 콜백만 부른다', () => {
    const onPressRegisterStay = jest.fn();
    const onPressPeriod = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          stayImport: { kind: 'empty' },
          onPressRegisterStay,
          onPressPeriod,
        })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-wizard-register-stay'));
    expect(onPressRegisterStay).toHaveBeenCalledTimes(1);
    // 짝 — 서로를 부르지 않는다. 한 핸들러를 두 버튼에 붙인 구현이 여기서 걸린다.
    expect(onPressPeriod).not.toHaveBeenCalled();

    // `날짜 직접 입력`은 **새 콜백을 만들지 않고** 날짜 카드가 이미 가진 진입점을 쓴다
    // (02a §2-4 — 이 칸의 계약 결정이다. AC-2는 이 버튼의 존재만 요구했다).
    fireEvent.press(screen.getByTestId('trip-wizard-manual-dates'));
    expect(onPressPeriod).toHaveBeenCalledTimes(1);
    expect(onPressRegisterStay).toHaveBeenCalledTimes(1);
  });
});

describe('AC-9 · 로딩 — 자리는 잡되 어떤 얼굴도 보여주지 않는다 (01b D5)', () => {
  it('행은 있고 세 얼굴의 문구는 하나도 없다', () => {
    // 준비 — 얼굴 prop을 **안 준다**. 컨테이너가 아직 판정을 못 내린 상태이고,
    // 승인 동결분 3파일도 정확히 이 상태로 이 화면을 렌더한다(02a ★9).
    render(<TripWizardStep1Screen {...filledProps()} />);

    // 자리표시라 자리는 있다 — 얼굴이 정해지는 순간 레이아웃이 밀리지 않는다.
    expect(block()).toBeOnTheScreen();

    // 거짓 정보를 한 순간도 안 보여준다. 특히 **로딩 중에 대안 UI를 그리는 것**(01b가
    // 기각한 선택지)이 여기서 걸린다 — 등록 숙소가 있는 사용자에게 "없어요"를 잠깐
    // 보여주게 된다.
    expect(block()).not.toHaveTextContent(/가져오기/);
    expect(block()).not.toHaveTextContent(/등록한 숙소가 없어요/);
    expect(block()).not.toHaveTextContent(/체크인/);

    // 짝(긍정) — 화면 자체는 정상적으로 그려졌다. 없으면 빈 렌더가 위를 공짜로 통과한다.
    expect(root()).toHaveTextContent(/언제 가세요\?/);
    expect(root()).toHaveTextContent(/다음/);
  });
});

describe('AC-8 · 조회 실패는 얼굴을 덮지 않고 덧붙는다 (01b D4)', () => {
  it('🔴 얼굴 A가 그대로 남고 재시도 행이 더해진다', () => {
    // ⚠️ 이 사이클의 심판이 사는 자리다. 문제로그 `2026-08-04 화면 얼굴 전환이 잔존
    // 목록을 지운다`(TRIP-222·223에서 2회 반복, 미해결). 첫 손이 자연스럽게 쓰는
    // `if (실패) return <에러화면/>` 한 줄이 이미 받아 둔 목록을 통째로 지운다.
    render(
      <TripWizardStep1Screen
        {...props({ stayImport: READY, stayImportFailed: true })}
      />
    );

    // 잔존 데이터로 판정한 얼굴이 **그대로** 보인다.
    expect(within(block()).getByText(IMPORT_TITLE)).toBeOnTheScreen();
    expect(within(note()).getByText(READY_NOTE)).toBeOnTheScreen();
    // 그리고 실패도 숨기지 않는다(BR-U1-55 침묵 실패 금지 · INV-4).
    expect(
      screen.getByTestId('trip-wizard-stayimport-retry')
    ).toBeOnTheScreen();
  });

  it('재시도 행의 문구와 동작', () => {
    const onRetryStayImport = jest.fn();
    render(
      <TripWizardStep1Screen
        {...props({
          stayImport: { kind: 'empty' },
          stayImportFailed: true,
          onRetryStayImport,
        })}
      />
    );

    const retry = screen.getByTestId('trip-wizard-stayimport-retry');
    // ⚠️ `다시 시도`는 제출 실패 배너에도 있는 문자열이라 **반드시 범위를 좁혀** 본다
    // (승인 파일들도 `within(banner)`로 좁혀 두었다).
    expect(within(retry).getByText(RETRY_TITLE)).toBeOnTheScreen();
    expect(within(retry).getByText(RETRY_ACTION)).toBeOnTheScreen();

    fireEvent.press(retry);
    expect(onRetryStayImport).toHaveBeenCalledTimes(1);
  });

  it('짝 — 실패하지 않았으면 재시도 행이 없다', () => {
    // 이게 없으면 "언제나 재시도 행을 그리는" 구현도 위 두 it을 통과한다.
    render(<TripWizardStep1Screen {...props({ stayImport: READY })} />);

    expect(screen.queryByTestId('trip-wizard-stayimport-retry')).toBeNull();
    // 짝(긍정) — 얼굴은 그대로 있다.
    expect(within(note()).getByText(READY_NOTE)).toBeOnTheScreen();
  });
});

describe('AC-11 · AC-12 · 범위와 금지', () => {
  it('AC-11 — 두 기간을 나란히 놓고 고르게 하는 시트가 없다 (TRIP-195 소관)', () => {
    // BR-U1-41의 충돌 해소 소유는 US-TRIP-05(TRIP-195)다. 이 칸은 **막는 데까지**이고,
    // 고르게 하는 UI를 미리 그리면 티켓별 AC 충족 여부가 섞여 구분되지 않는다.
    render(
      <TripWizardStep1Screen
        {...filledProps({
          stayImport: { kind: 'blocked', note: REASON_PERIOD_FILLED },
        })}
      />
    );

    expect(root()).not.toHaveTextContent(
      /나란히|어느 쪽|기존 기간 유지|숙소 날짜로 바꾸기/
    );
    expect(
      screen.queryByTestId('trip-wizard-period-conflict-sheet')
    ).toBeNull();

    // 짝(긍정) — 대신 사유 문구로 막는다. 이것이 이 칸이 지는 몫이다.
    expect(within(note()).getByText(REASON_PERIOD_FILLED)).toBeOnTheScreen();
  });

  it('AC-12 — INV-3: 이 행 어디에도 소요 시간이 없다 (BR-U1-54)', () => {
    render(<TripWizardStep1Screen {...filledProps({ stayImport: READY })} />);

    expect(root()).not.toHaveTextContent(/소요/);
    expect(root()).not.toHaveTextContent(/\d+\s*분/);
    expect(root()).not.toHaveTextContent(/\d+\s*시간/);

    // 짝(긍정) — 스캔이 실제로 텍스트를 봤고, 위 정규식이 이 행의 정상 표기를 오탐하지
    // 않는다는 확인이다. 날짜·기간이 실제로 떠 있는 상태에서 본다.
    expect(root()).toHaveTextContent(/6\.10~6\.13/);
    expect(root()).toHaveTextContent(/3박 4일/);
  });
});
