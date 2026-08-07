import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  TripWizardStep2Screen,
  type TripWizardStep2ScreenProps,
} from './TripWizardStep2Screen';

/**
 * TRIP-225 g02 거점 숙소 2/2 — **표면(화면)**. 완성된 문자열·불리언 prop만 받아 그린다.
 *
 * 무엇을 보장하나:
 *  - 5변형(default · empty · loading · error · blocked 안내)이 각자의 얼굴로 나온다.
 *  - **AC-1 · BR-U1-28** 다박 배정이 날짜 수만큼 쪼개지지 않고 **한 행**으로 나온다.
 *  - **★8 · 01b D5** 짝 없는 숙소(`숙소 정보 없음`)여도 **행이 살아남는다** — 행을 지우면 그
 *    날짜 구간이 GAP으로 오해된다.
 *  - **AC-7 · BR-U1-20 · ★16** `거점` 배지와 지정 상태가 **모양이 아니라 testID·텍스트로도**
 *    갈린다. 리포의 카드 지문 가드는 SVG `fill` 변화를 안 보므로(`docs/structure.md:462`),
 *    모양으로만 다른 상태는 심판이 통과시킨다.
 *  - **★6 · INV-3 · BR-U1-54** 소요 시간이 어디에도 없다 — 단, **긍정 앵커를 먼저** 세운다.
 *  - **★12** "막힌다"는 매처만으로 증명되지 않는다. 아래 모든 차단 단언은
 *    `toBeDisabled()` + 실제 `press` + **핸들러 0회** 3단이다.
 *
 * 왜 화면과 배선을 나눠 심판하나: 이 파일은 **prop → 픽셀**만 본다. 어떤 prop이 내려오는지
 * (판정)는 `pages/trip-new-step2/ui/TripNewStep2Page.test.tsx`가 따로 본다. 둘을 한 파일에
 * 섞으면 판정 하나를 고칠 때 표면 단언까지 무더기로 흔들린다.
 *
 * ⚠️ **매처 규약(02a ★11, 실행 확인).** RNTL `toHaveTextContent(문자열)`은 부분 포함이 아니라
 * **완전 일치**이고(`exact` 기본값 `true`), 형제 `<Text>`는 **구분자 없이** 이어 붙는다
 * (`해운대 오션 호텔` + `1–2박` → `해운대 오션 호텔1–2박`). 그래서 **컨테이너에는 정규식**,
 * **단일 `Text` 노드에는 문자열**을 쓴다.
 */

/** 소요 시간 표기(INV-3). 숫자를 앞에 두어 `충분`·`시간표` 같은 낱말에 오탐하지 않는다. */
const DURATION_PATTERNS = [/\d+\s*분/, /\d+\s*시간/, /소요/, /duration/i];

function section(
  over: Partial<TripWizardStep2ScreenProps['sections'][number]> = {}
): TripWizardStep2ScreenProps['sections'][number] {
  return {
    baseAssignmentId: 'ba-1',
    nightLabel: '1–2박',
    dateLabel: '6/10–6/12',
    stayName: '해운대 오션 호텔',
    changePending: false,
    ...over,
  };
}

function candidate(
  over: Partial<TripWizardStep2ScreenProps['candidates'][number]> = {}
): TripWizardStep2ScreenProps['candidates'][number] {
  return {
    savedStayId: 'stay-a',
    name: '해운대 오션 호텔',
    isBase: false,
    assignPending: false,
    ...over,
  };
}

const handlers = {
  onBack: jest.fn(),
  onAssign: jest.fn(),
  onRetryAssign: jest.fn(),
  onChange: jest.fn(),
  onRetryChange: jest.fn(),
  onGenerate: jest.fn(),
  onNoStayStart: jest.fn(),
  onExploreStays: jest.fn(),
  onRetryAll: jest.fn(),
  onRestart: jest.fn(),
  onRetryCoverage: jest.fn(),
};

function props(
  over: Partial<TripWizardStep2ScreenProps> = {}
): TripWizardStep2ScreenProps {
  return {
    variant: 'default',
    subtitle: '6월 10일–13일',
    sections: [section()],
    candidates: [candidate()],
    generateDisabled: false,
    coverageFailed: false,
    ...handlers,
    ...over,
  };
}

beforeEach(() => {
  Object.values(handlers).forEach((fn) => fn.mockClear());
});

describe('default 변형 — 골격 (1707:1183)', () => {
  it('헤더·진행 표시·두 섹션·CTA 2종이 한 화면에 선다', () => {
    render(<TripWizardStep2Screen {...props()} />);

    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
    expect(screen.getByText('거점 숙소')).toBeOnTheScreen();
    // 진행 표시는 레이아웃이 아니라 각 화면이 스스로 그린다(step1 선례).
    expect(screen.getByText('2 / 2')).toBeOnTheScreen();
    expect(screen.getByText('어디서 묵을까요?')).toBeOnTheScreen();
    expect(screen.getByText('숙소 후보')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-generate')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-nostay-start')).toBeOnTheScreen();
  });

  it('01b D9 — Figma 오타를 고쳐 쓴다 (밤 → 박)', () => {
    render(<TripWizardStep2Screen {...props()} />);

    const root = screen.getByTestId('trip-base-step2-root');

    // 긍정 — 정본 3곳(티켓·frontend-components.md·BR)이 전부 `박`이다.
    expect(root).toHaveTextContent(/박별 거점/);
    expect(root).toHaveTextContent(/박에 배정하세요/);
    // 부정 짝 — 라이브 Figma 문자열(`밤별`·`밤에`)을 그대로 옮기지 않았다.
    expect(root).not.toHaveTextContent(/밤별/);
    expect(root).not.toHaveTextContent(/밤에/);
  });

  it('섹션 부제가 여행 기간을 그대로 받아 쓴다', () => {
    render(<TripWizardStep2Screen {...props({ subtitle: '6월 10일–13일' })} />);

    expect(screen.getByTestId('trip-base-step2-root')).toHaveTextContent(
      /6월 10일–13일/
    );
  });
});

describe('AC-1 · 구간 목록 — 다박은 한 행이다 (BR-U1-28 · US-TRIP-07)', () => {
  it('배정 1건이 행 1개로 나오고 박수·날짜·숙소명·변경을 모두 갖는다', () => {
    render(<TripWizardStep2Screen {...props()} />);

    // 날짜 수만큼 쪼개지지 않는다 — 2박이어도 행은 하나다.
    expect(screen.getAllByTestId(/^trip-base-section-/)).toHaveLength(1);

    const row = screen.getByTestId('trip-base-section-ba-1');
    // 컨테이너라 정규식(★11). 형제 Text가 구분자 없이 붙으므로 문자열 완전 일치는 못 쓴다.
    expect(row).toHaveTextContent(/1–2박/);
    expect(row).toHaveTextContent(/6\/10–6\/12/);
    expect(row).toHaveTextContent(/해운대 오션 호텔/);
    expect(within(row).getByTestId('trip-base-change-ba-1')).toBeOnTheScreen();
  });

  it('★8 · 01b D5 — 짝 없는 숙소는 대체 문구로 나오되 행이 사라지지 않는다', () => {
    // `toBaseSections`는 빈 문자열을 내고(정본에 없는 문구를 발명하지 않는다), 그것을
    // 화면 문구로 바꾸는 것은 배선 몫이다. 여기서는 **행이 살아 있는지**가 본체다 —
    // 행을 지우면 그 날짜 구간이 GAP(공백)으로 오해된다.
    render(
      <TripWizardStep2Screen
        {...props({ sections: [section({ stayName: '숙소 정보 없음' })] })}
      />
    );

    const row = screen.getByTestId('trip-base-section-ba-1');
    expect(row).toBeOnTheScreen();
    expect(row).toHaveTextContent(/숙소 정보 없음/);
    // 짝 — 날짜 정보는 그대로 살아 있다(행이 껍데기로 남지 않았다).
    expect(row).toHaveTextContent(/6\/10–6\/12/);
  });

  it('AC-4 · 구간이 0건이어도 후보와 CTA가 그대로 선다', () => {
    // 막다른 길에 두지 않는다. 구간 0은 "아직 아무것도 안 정했다"일 뿐이다.
    render(
      <TripWizardStep2Screen
        {...props({
          sections: [],
          candidates: [candidate(), candidate({ savedStayId: 'stay-b' })],
        })}
      />
    );

    expect(screen.queryAllByTestId(/^trip-base-section-/)).toHaveLength(0);
    expect(screen.getAllByTestId(/^trip-base-candidate-/)).toHaveLength(2);
    expect(screen.getByTestId('trip-base-generate')).toBeEnabled();
  });
});

describe('AC-7 · 후보 카드 — 거점 배지와 지정 상태 (BR-U1-20 · ★16)', () => {
  it('배정된 카드만 배지를 갖는다 — 모양이 아니라 testID로 갈린다', () => {
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({ savedStayId: 'stay-a', isBase: true }),
            candidate({ savedStayId: 'stay-b', name: '광안리 뷰 호텔' }),
          ],
        })}
      />
    );

    // 긍정 짝(★17) — 루트와 두 카드가 실제로 그려졌다. 없으면 아래 `null` 단언이
    // "렌더가 통째로 실패해서" 통과한다.
    expect(screen.getByTestId('trip-base-candidate-stay-a')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-candidate-stay-b')).toBeOnTheScreen();

    expect(screen.getByTestId('trip-base-badge-stay-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-base-badge-stay-b')).toBeNull();
  });

  it('지정된 카드는 상태줄을, 미지정 카드는 지정 버튼을 갖는다', () => {
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-a',
              isBase: true,
              assignedLabel: '1–2박에 지정됨',
            }),
            candidate({ savedStayId: 'stay-b', name: '광안리 뷰 호텔' }),
          ],
        })}
      />
    );

    // 단일 Text 노드라 문자열 완전 일치를 쓸 수 있다(★11).
    expect(screen.getByTestId('trip-base-assigned-stay-a')).toHaveTextContent(
      '1–2박에 지정됨'
    );
    // 지정된 카드에는 지정 버튼이 없다 — 같은 카드를 다시 지정할 어포던스를 주지 않는다.
    expect(screen.queryByTestId('trip-base-assign-stay-a')).toBeNull();
    expect(screen.getByTestId('trip-base-assign-stay-b')).toBeOnTheScreen();
  });

  it('AC-6 · 지정 버튼을 누르면 그 숙소 id로 배선에 넘긴다', () => {
    render(
      <TripWizardStep2Screen
        {...props({ candidates: [candidate({ savedStayId: 'stay-b' })] })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-base-assign-stay-b'));

    expect(handlers.onAssign).toHaveBeenCalledWith('stay-b');
    expect(handlers.onAssign).toHaveBeenCalledTimes(1);
  });

  it('01b D4 · ★12 — 날짜 없는 숙소는 사유를 보이고 실제로 눌리지 않는다', () => {
    // BR-U1-26: 날짜 없이 저장은 되지만 거점 배정은 불가. 페일클로즈다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-b',
              blockedReason: '날짜가 없어 지정할 수 없어요',
            }),
          ],
        })}
      />
    );

    expect(
      screen.getByTestId('trip-base-assign-blocked-stay-b')
    ).toHaveTextContent('날짜가 없어 지정할 수 없어요');

    // 3단 규약(★12) — 매처만으로는 부족하다. 실측상 `accessibilityState`만 세운 버튼은
    // `toBeDisabled()`를 통과하면서 press가 그대로 발사된다.
    const button = screen.getByTestId('trip-base-assign-stay-b');
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(handlers.onAssign).not.toHaveBeenCalled();
  });
});

describe('★6 · INV-3 — 소요 시간은 어디에도 없다 (BR-U1-54)', () => {
  it('카드가 실제로 그려진 것을 확인한 뒤, 시간 표기가 0건임을 본다', () => {
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({
              savedStayId: 'stay-a',
              isBase: true,
              assignedLabel: '1–2박에 지정됨',
            }),
          ],
        })}
      />
    );

    // ① 긍정 앵커 먼저 — 부정 단언만 두면 **아무것도 안 그리는** 구현이 공짜로 통과한다
    //    (`formatPrice.test.ts:92-98` 선례).
    const root = screen.getByTestId('trip-base-step2-root');
    expect(root).toHaveTextContent(/해운대 오션 호텔/);
    expect(root).toHaveTextContent(/1–2박에 지정됨/);
    expect(root).toHaveTextContent(/6\/10–6\/12/);

    // ② 그제서야 부정 — 거리만 쓰고 소요 시간은 안 쓴다(INV-3).
    DURATION_PATTERNS.forEach((pattern) => {
      expect(root).not.toHaveTextContent(pattern);
    });
  });
});

describe('empty 변형 (1708:1183 · 01b D3)', () => {
  it('AC-12 · 안내 화면만 서고 구간·후보·배너가 그려지지 않는다', () => {
    render(
      <TripWizardStep2Screen
        {...props({ variant: 'empty', sections: [], candidates: [] })}
      />
    );

    // 긍정 짝(★17) — 루트와 empty 얼굴이 실제로 있다. 이게 없으면 아래 `null` 4개가
    // 렌더 실패로도 통과한다.
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
    const empty = screen.getByTestId('trip-base-empty');
    expect(empty).toHaveTextContent(/숙소 없이 시작해도 돼요/);
    expect(empty).toHaveTextContent(
      /이동 동선의 중심에서 가까운 숙소를 찾아드려요/
    );

    // 라이브 Figma가 정본이다(01b D3) — 주 CTA 문구가 default(`숙소 없이 시작하기`)와 다르다.
    expect(screen.getByTestId('trip-base-nostay-start')).toHaveTextContent(
      '숙소 없이 계속'
    );
    expect(screen.getByTestId('trip-base-explore-stays')).toBeOnTheScreen();

    // 부정 — default의 세 덩어리는 통째로 없다.
    expect(screen.queryAllByTestId(/^trip-base-section-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^trip-base-candidate-/)).toHaveLength(0);
    expect(screen.queryByTestId('trip-base-generate')).toBeNull();
  });

  it('BR-U1-40 · BR-U1-47 — 두 버튼이 각자 제 목적지로 간다', () => {
    render(
      <TripWizardStep2Screen
        {...props({ variant: 'empty', sections: [], candidates: [] })}
      />
    );

    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    fireEvent.press(screen.getByTestId('trip-base-explore-stays'));

    expect(handlers.onNoStayStart).toHaveBeenCalledTimes(1);
    expect(handlers.onExploreStays).toHaveBeenCalledTimes(1);
  });
});

describe('loading 변형 (2454:1500)', () => {
  it('자리를 유지한 채 회색 블록을 그리고, 보조 CTA만 살아 있다', () => {
    render(
      <TripWizardStep2Screen
        {...props({
          variant: 'loading',
          sections: [],
          candidates: [],
          generateDisabled: true,
        })}
      />
    );

    // 섹션 제목은 실제 텍스트로 남고 부제만 진행 문구로 바뀐다(브리프 §4-F(1) 실측).
    expect(screen.getByText('어디서 묵을까요?')).toBeOnTheScreen();
    expect(screen.getByText('거점을 불러오는 중')).toBeOnTheScreen();
    expect(screen.getByText('숙소를 모으는 중')).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^trip-base-skeleton-section-/)).toHaveLength(
      2
    );
    expect(screen.getAllByTestId(/^trip-base-skeleton-card-/)).toHaveLength(2);

    // 주 CTA 3단 차단(★12).
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(handlers.onGenerate).not.toHaveBeenCalled();

    // 짝 — 보조 CTA는 로딩 중에도 활성이다(BR-U1-40·47). 이 짝이 없으면 "둘 다 막는"
    // 구현이 통과하고, 숙소 없이 시작하려는 사용자가 로딩에 갇힌다.
    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(handlers.onNoStayStart).toHaveBeenCalledTimes(1);
  });
});

describe('error 변형 (2454:1639 · 01b D14)', () => {
  it('BR-U1-55 — 실패를 말하고, 두 갈래 출구를 준다', () => {
    render(
      <TripWizardStep2Screen
        {...props({ variant: 'error', sections: [], candidates: [] })}
      />
    );

    const notice = screen.getByTestId('trip-base-error');
    expect(notice).toHaveTextContent(/지금 거점 정보를 불러올 수 없어요/);
    expect(notice).toHaveTextContent(/잠시 후 다시 시도해 주세요/);

    fireEvent.press(screen.getByTestId('trip-base-error-retry'));
    expect(handlers.onRetryAll).toHaveBeenCalledTimes(1);

    // 짝 — 전면 실패에서도 "숙소 없이 시작하기"는 살아 있다(01b D15 · Figma 2456:1511).
    fireEvent.press(screen.getByTestId('trip-base-error-nostay'));
    expect(handlers.onNoStayStart).toHaveBeenCalledTimes(1);
  });
});

describe('blocked 안내행 (2454:1778 · 01b D16)', () => {
  it('날짜를 앞 2개 + 외 N일로 나열하고, 해소 어포던스는 주지 않는다', () => {
    render(
      <TripWizardStep2Screen
        {...props({
          generateDisabled: true,
          unresolved: {
            items: [
              { date: '2026-06-11', label: '6/11' },
              { date: '2026-06-13', label: '6/13' },
            ],
            overflowCount: 1,
          },
        })}
      />
    );

    expect(screen.getByTestId('trip-base-blocked-notice')).toHaveTextContent(
      /아직 정리되지 않은 날짜가 있어요/
    );
    // 중첩 Text — 개별 날짜는 정본 testID로 짚고, 이어 붙은 한 줄도 함께 본다(02a §5-4 실측).
    expect(
      screen.getByTestId('trip-base-coverage-day-2026-06-11')
    ).toHaveTextContent('6/11');
    expect(screen.getByTestId('trip-base-blocked-more')).toHaveTextContent(
      '외 1일'
    );
    expect(screen.getByTestId('trip-base-blocked-days')).toHaveTextContent(
      '6/11 · 6/13 · 외 1일'
    );

    // 주 CTA 3단 차단(★12).
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(handlers.onGenerate).not.toHaveBeenCalled();

    // 스토리 경계 — 해소 시트는 TRIP-190 몫이다. 디자인에도 버튼·셰브런이 0개다
    // (브리프 §4-F(3) 실측). 이 칸이 만들면 경계 침범이다.
    expect(
      within(screen.getByTestId('trip-base-blocked-notice')).queryByRole(
        'button'
      )
    ).toBeNull();
  });

  it('01b D15 · ★5 — coverage만 실패하면 CTA 자리에 오류가 서고 목록은 남는다', () => {
    render(
      <TripWizardStep2Screen
        {...props({ generateDisabled: true, coverageFailed: true })}
      />
    );

    // ① 목록은 살아 있다 — 전면 error 얼굴로 도망가지 않았다.
    expect(screen.getByTestId('trip-base-section-ba-1')).toBeOnTheScreen();
    expect(screen.getByTestId('trip-base-candidate-stay-a')).toBeOnTheScreen();
    expect(screen.queryByTestId('trip-base-error')).toBeNull();

    // ② 침묵하지 않는다 + 다시 시도가 실제로 배선을 부른다.
    expect(screen.getByTestId('trip-base-coverage-error')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('trip-base-coverage-retry'));
    expect(handlers.onRetryCoverage).toHaveBeenCalledTimes(1);

    // ③ 주 CTA는 막히고(모를 때는 막는다 — INV-U1-16 페일클로즈), 보조는 열려 있다.
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(handlers.onGenerate).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('trip-base-nostay-start'));
    expect(handlers.onNoStayStart).toHaveBeenCalledTimes(1);
  });
});

describe('AC-13 · 변경 (01b D6)', () => {
  it('변경을 누르면 그 배정 id로 배선에 넘기고, 시트는 뜨지 않는다', () => {
    render(<TripWizardStep2Screen {...props()} />);

    fireEvent.press(screen.getByTestId('trip-base-change-ba-1'));

    expect(handlers.onChange).toHaveBeenCalledWith('ba-1');
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
    // 해제만 하고 후보 목록에서 다시 고른다(01b D6) — 재배정 시트는 TRIP-190 경계다.
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });
});

/* ------------------------------------------------------------------ *
 * 게이트①-2 심판 보강 — 03b 적대적 리뷰의 생존 뮤테이션을 죽인다.
 * 위 케이스들이 전부 "막힌다"를 재는 사이 **"눌리면 무슨 일이 나는가"** 쪽이 비어 있었다.
 * ------------------------------------------------------------------ */

describe('★22 · B-1 — 주 CTA의 성공 경로 (03b 차단)', () => {
  it('🔴 활성 상태의 주 CTA를 누르면 onGenerate가 실제로 불린다', () => {
    // 이 화면의 대표 동작인데 리포 전체에서 이 버튼을 누르는 단언 4건이 **전부 disabled
    // 상태의 부정 단언**이었다 — `onPress={() => {}}`로 바꿔도 1,302케이스가 green이다
    // (03b 실측). 부정 단언만 쌓으면 "아무 데도 안 가는 버튼"이 만점을 받는다.
    render(<TripWizardStep2Screen {...props({ generateDisabled: false })} />);

    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeEnabled();
    fireEvent.press(generate);

    expect(handlers.onGenerate).toHaveBeenCalledTimes(1);
  });
});

describe('★30 · W-3 짝 — 요청 중인 카드는 버튼이 잠긴다 (01b D12)', () => {
  it('🔴 assignPending인 카드만 눌리지 않고, 다른 카드는 그대로 눌린다', () => {
    // 잠금은 **두 겹**이다 — 페이지의 `useRef`(★25가 잰다)와 화면의 `disabled` prop(여기).
    // `disabled`에서 `assignPending`만 빼도 ref가 요청을 걸러서 요청 수 단언은 전부 green이다
    // (03b W-3 뮤테이션 ② 실측). 즉 **요청은 안 새는데 버튼이 눌리는 것처럼 보이는** 상태를
    // 아무도 안 봤다 — 사용자는 반응 없는 버튼을 계속 누른다.
    render(
      <TripWizardStep2Screen
        {...props({
          candidates: [
            candidate({ savedStayId: 'stay-b', assignPending: true }),
            candidate({ savedStayId: 'stay-c', name: '감천 게스트하우스' }),
          ],
        })}
      />
    );

    // 3단 차단(★12).
    const pending = screen.getByTestId('trip-base-assign-stay-b');
    expect(pending).toBeDisabled();
    fireEvent.press(pending);
    expect(handlers.onAssign).not.toHaveBeenCalled();

    // 짝 · D12 — 잠금 범위는 누른 카드 하나뿐이다. 목록 전체를 잠그면 다른 숙소를 연달아
    // 지정할 때마다 기다려야 한다.
    fireEvent.press(screen.getByTestId('trip-base-assign-stay-c'));
    expect(handlers.onAssign).toHaveBeenCalledTimes(1);
    expect(handlers.onAssign).toHaveBeenCalledWith('stay-c');
  });
});

describe('★23 · W-7 — 헤더 뒤로 가기 (03b 경고)', () => {
  it('🔴 좌상단 뒤로 가기가 onBack을 부른다', () => {
    // `trip-base-back`을 참조하는 단언이 리포 전체에 0건이었다. 화면에 그려진 버튼이
    // 거짓말을 하는 상태를 심판이 통과시킨다.
    render(<TripWizardStep2Screen {...props()} />);

    fireEvent.press(screen.getByTestId('trip-base-back'));

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    // 짝 — 뒤로 가기가 엉뚱한 출구를 대신 열지 않는다. 없으면 `onPress={onGenerate}`로
    // 잘못 배선된 헤더도 위 단언만으로는 잡히지 않는다.
    expect(handlers.onGenerate).not.toHaveBeenCalled();
    expect(handlers.onNoStayStart).not.toHaveBeenCalled();
  });
});

describe('★24 · W-4 · BR-U1-55 — 나열이 비어도 막힌 이유는 남는다 (03b 경고)', () => {
  it('🔴 unresolved의 항목이 0개여도 안내행 제목이 화면에 선다', () => {
    // 안내행 전체가 "나열할 날짜가 1개 이상"일 때만 뜨면, `blocked:true`인데 days가 전부
    // AUTO인 응답(모순 응답 — 배선 테스트가 직접 만드는 케이스다)에서 **제목까지 함께
    // 사라져** 회색 버튼만 남는다. 왜 못 누르는지 말하는 문장이 화면에서 0개가 되는 것이
    // BR-U1-55가 금지하는 침묵 실패다.
    render(
      <TripWizardStep2Screen
        {...props({
          generateDisabled: true,
          unresolved: { items: [], overflowCount: 0 },
        })}
      />
    );

    expect(screen.getByTestId('trip-base-blocked-notice')).toHaveTextContent(
      /아직 정리되지 않은 날짜가 있어요/
    );
    // 없는 날짜를 지어내지 않는다 — 제목만 서고 나열은 비어 있다.
    expect(screen.queryAllByTestId(/^trip-base-coverage-day-/)).toHaveLength(0);
    expect(screen.queryByTestId('trip-base-blocked-more')).toBeNull();

    // 차단 자체는 그대로다 — 3단(★12).
    const generate = screen.getByTestId('trip-base-generate');
    expect(generate).toBeDisabled();
    fireEvent.press(generate);
    expect(handlers.onGenerate).not.toHaveBeenCalled();
  });

  it('짝 — unresolved 자체가 없으면 안내행을 아예 안 그린다', () => {
    // 위 케이스를 "언제나 안내행을 그린다"로 통과시키는 구현을 막는다. 막히지도 않은
    // 화면에 경고문이 상주하면 그것도 거짓말이다.
    render(<TripWizardStep2Screen {...props()} />);

    expect(screen.queryByTestId('trip-base-blocked-notice')).toBeNull();
    // 루트 존재 짝(★17) — 렌더가 통째로 실패해서 통과한 것이 아니다.
    expect(screen.getByTestId('trip-base-step2-root')).toBeOnTheScreen();
  });
});

/* ------------------------------------------------------------------ *
 * 게이트①-3 심판 보강 — `지정`은 촘촘한데 대칭인 `변경(해제)`이 비어 있었다.
 * ------------------------------------------------------------------ */

describe('★32 · W2-2 — 해제 중인 행은 변경 버튼이 잠긴다 (01b D12)', () => {
  it('🔴 changePending인 행만 눌리지 않고, 다른 행은 그대로 눌린다', () => {
    // 후보 카드 쪽 짝(★30)의 구간 행 판이다. 잠금은 **두 겹**이고(배선의 `useRef`와 화면의
    // `disabled` prop) 여기는 뒷겹만 잰다. `disabled={row.changePending}`를 지워도 ref가
    // 요청을 걸러서 요청 수 단언은 전부 green이다(03b 2차 N2 실측) — 즉 **요청은 안 새는데
    // 버튼이 눌리는 것처럼 보이는** 상태를 아무도 안 봤다.
    render(
      <TripWizardStep2Screen
        {...props({
          sections: [
            section({ baseAssignmentId: 'ba-1', changePending: true }),
            section({ baseAssignmentId: 'ba-2', nightLabel: '3박' }),
          ],
        })}
      />
    );

    // 3단 차단(★12) — 매처는 접근성 상태만 읽어서 실제로 눌리는 버튼을 통과시킨다.
    const pending = screen.getByTestId('trip-base-change-ba-1');
    expect(pending).toBeDisabled();
    fireEvent.press(pending);
    expect(handlers.onChange).not.toHaveBeenCalled();

    // 짝 · D12 — 잠금 범위는 누른 행 하나뿐이다. 구간 목록 전체를 잠그면 거점이 둘 이상일 때
    // 하나를 해제하는 동안 나머지를 손댈 수 없다.
    fireEvent.press(screen.getByTestId('trip-base-change-ba-2'));
    expect(handlers.onChange).toHaveBeenCalledTimes(1);
    expect(handlers.onChange).toHaveBeenCalledWith('ba-2');
  });
});
