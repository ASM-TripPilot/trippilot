import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import {
  MyStaysScreen,
  type MyStayRowVM,
  type MyStaysScreenProps,
} from './MyStaysScreen';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * l04 등록 숙소 — MyStaysScreen(props 만 받는 뷰) 단위 테스트.
 *
 * 한 파일로 합친 기록(TRIP-1148): 옛 `MyStaysScreen.test.tsx`·`.l04parity.test.tsx` 를 각자의 바깥 describe 로
 * 옮겼다. l04parity 안에 있던 남의 컴포넌트 테스트 둘은 소스 옆으로 떼었다(01b Q4) — 출발점 다이얼로그 →
 * `BaseToggleDialog.test.tsx`(TRIP-1191 로 컴포넌트째 삭제), `ChevronRightGlyph` 기본색 → `SettingsGlyphs.test.tsx`.
 * INV-3 "분·시간·소요 0건" 렌더 it 은 지웠다 — 숙소 계약(`SavedStay`)에 시간·거리 재료가 없다(README 판정 4 하위 규칙).
 */

// 옛 MyStaysScreen.test — BR-U6-20·TRIP-1076·INV-U1-08·US-NOTIF-06
describe('행·거점 변경·empty (옛 본 파일)', () => {
  /**
   * TRIP-605 · l04 등록 숙소 — 순수 프레젠테이션 화면(VM 주입). 조회·조합은 페이지 몫이라
   * 여기선 완성 VM 을 props 로 넣고 렌더 계약만 잠근다.
   *
   * 무엇을 보장하나(승인 계약):
   *  - 🔴 AC-1(BR-U6-20) 행에 숙소명·위치·체크인/아웃·등록 출처·연결 여행이 보이고, 미연결은 정확히 '연결된 여행 없음'.
   *  - 🔴 AC-2(TRIP-1076 결정 2(A) · 반전) 등록 행의 「거점 변경」 press → 다이얼로그 없이 `onPressChangeBase(row)`
   *    1회. 이 화면은 거점을 바꾸지 않는다 — 바꾸기는 그 여행의 거점 화면(페이지가 push)이 한다.
   *  - 🔴 AC-3(INV-U1-08) coordConfirmed=false → 토글 real disabled + press 무반응 + 콜백 0.
   *  - 🔴 TRIP-989 C(D13) 미등록 행에는 출발점 버튼이 없다 — 토글은 등록 행에만 있다.
   *  - 🔴 AC-4(US-NOTIF-06) 0건 → empty 안내 + 탐색 콜백.
   *  - AC-5(INV-3) 렌더에 소요시간 문자열 0(선제 green 회귀 앵커).
   *
   * 왜 이렇게 테스트하나(02a ★1·★2):
   *  - TRIP-1076: 옛 해제 다이얼로그 게이트(TRIP-605·1017)는 사라졌다. 확인 다이얼로그(Figma 1606 「일정 다시 생성」)를
   *    띄우지 않는 이유 — 거점 화면은 일정을 재생성하지 않아 그 문구가 거짓 안내가 된다(01b Q1, INV-4).
   *    `BaseToggleDialog` 는 TRIP-1191 로 삭제됐다(소비처 0).
   *  - push 목적지('/stays'·거점 화면)는 페이지 배선이라 화면은 콜백 호출까지만(`MyStaysPage.integration.test.tsx`가 잠금).
   *
   * (개념) `getByText('문자열')`=leaf 완전일치 · `getByText(/정규식/)`/`queryAllByText(/정규식/)`=부분포함
   *   (node_modules matches.js 실검증, 02a §5-A). `toBeDisabled()`=real disabled prop 판독(02a §5-B).
   */

  /** 소요시간 표기 탐지기(INV-3) — 부분포함 정규식(TripCardContainer 선례 동형). */

  /** 등록됨(출발점 배정·연결 여행 有) 행. */
  function assignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
    return {
      savedStayId: 's1',
      name: '해운대 오션뷰',
      location: '부산 해운대구 우동',
      dateRangeLabel: '6.10 ~ 6.13',
      sourceLabel: 'OTA 예약',
      memoLabel: null,
      linkedTripLabel: '연결 여행 · 부산 여행',
      baseState: 'assigned',
      canAssignBase: true,
      tripId: 't1',
      baseAssignmentId: 'ba1',
      ...over,
    };
  }

  /** 미등록(출발점 미배정·연결 없음) 행. */
  function unassignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
    return {
      savedStayId: 's2',
      name: '남포동 게스트하우스',
      location: '부산 중구 남포동',
      dateRangeLabel: null,
      sourceLabel: '앱 저장',
      memoLabel: '예약번호 미입력',
      linkedTripLabel: '연결된 여행 없음',
      baseState: 'unassigned',
      canAssignBase: true,
      tripId: null,
      baseAssignmentId: null,
      ...over,
    };
  }

  function renderScreen(over: Partial<MyStaysScreenProps> = {}) {
    const onPressChangeBase = jest.fn();
    const onPressExplore = jest.fn();
    const props: MyStaysScreenProps = {
      rows: [assignedRow()],
      isEmpty: false,
      onPressChangeBase,
      onPressExplore,
      ...over,
    };
    render(<MyStaysScreen {...props} />);
    return { onPressChangeBase, onPressExplore };
  }

  describe('🔴 AC-1 · 행 표시(BR-U6-20)', () => {
    it('연결된 행은 숙소명·위치·날짜·출처·여행명을, 미연결 행은 정확히 "연결된 여행 없음"을 보인다', () => {
      renderScreen({ rows: [assignedRow(), unassignedRow()] });

      // 연결된 행(s1)
      expect(screen.getByText('해운대 오션뷰')).toBeOnTheScreen();
      expect(screen.getByText('부산 해운대구 우동')).toBeOnTheScreen();
      expect(screen.getByText('6.10 ~ 6.13')).toBeOnTheScreen();
      expect(screen.getByText('OTA 예약')).toBeOnTheScreen();
      // 여행명은 부분포함(라벨이 '연결 여행 · 부산 여행' 이므로 leaf 완전일치는 못 씀).
      expect(screen.getByText(/부산 여행/)).toBeOnTheScreen();

      // 미연결 행(s2) — 정본 문안 완전일치.
      expect(screen.getByText('연결된 여행 없음')).toBeOnTheScreen();
    });

    it('날짜 없는 행은 날짜 칩을 그리지 않고 "날짜 없음"류 문구도 없다 (TRIP-1052 AC-6 · BR-U6-20)', () => {
      // 준비 — 날짜 없는 행 하나만(dateRangeLabel: null). 옛 데이터가 아니면 이제 전부 이 모양이다.
      renderScreen({ rows: [unassignedRow()] });

      // 단언 ① — 부재. 날짜 칩 서식(`6.10 ~ 6.13`)도, 대체 문구도 없다(부분포함 정규식).
      // 메모 칩 '예약번호 미입력'은 날짜가 아니라서 '미입력' 단독이 아니라 '날짜 미입력'으로 잰다.
      expect(screen.queryAllByText(/\d+\.\d+\s*~/)).toHaveLength(0);
      expect(
        screen.queryAllByText(/날짜 없음|날짜 미입력|체크인|체크아웃/)
      ).toHaveLength(0);

      // 단언 ② — 짝. 행과 칩 줄이 통째로 사라져서 ①이 참이 된 게 아니다.
      expect(screen.getByText('남포동 게스트하우스')).toBeOnTheScreen();
      expect(screen.getByText('앱 저장')).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-2 · 「거점 변경」은 다이얼로그 없이 콜백으로 (TRIP-1076 결정 2(A) · 반전)', () => {
    it('등록 행 토글 press → 다이얼로그 없이 onPressChangeBase 를 그 행으로 1회 부른다', () => {
      const { onPressChangeBase } = renderScreen({ rows: [assignedRow()] });

      // 준비 확인: 누르기 전 콜백 0.
      expect(onPressChangeBase).not.toHaveBeenCalled();

      // 실행: 거점 변경 press.
      fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));

      // 단언: 그 행으로 1회, 다이얼로그는 없다(옛 해제 게이트 소멸).
      expect(onPressChangeBase).toHaveBeenCalledTimes(1);
      expect(onPressChangeBase.mock.calls[0][0].savedStayId).toBe('s1');
      expect(onPressChangeBase.mock.calls[0][0].tripId).toBe('t1');
      expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
    });

    it('미등록 행에는 "거점 지정" 버튼이 없어 그 행에서 다이얼로그를 열 길이 없다 (TRIP-989 C-1·C-3 · D13)', () => {
      // 미등록 지정(POST)은 어느 여행에 붙일지 모르는 채로는 할 수 없다(TRIP-621 로 분리). 묻고 나서
      // 아무것도 안 하면 침묵 실패(INV-4)라, 물을 수 없는 행에서는 묻지도 않는다.
      renderScreen({ rows: [assignedRow(), unassignedRow()] });

      // 행은 그대로 있고 "연결된 여행 없음"도 남는다(BR-U6-20) — 아래 "없음" 단언의 짝.
      const row = screen.getByTestId('my-stays-row-s2');
      expect(within(row).getByText('남포동 게스트하우스')).toBeOnTheScreen();
      expect(within(row).getByText('연결된 여행 없음')).toBeOnTheScreen();

      // 지정 버튼·문구가 없고, 행 안에 누를 수 있는 버튼이 하나도 없다(다른 testID 로 남기는 우회 차단).
      expect(within(row).queryByText('거점 지정')).toBeNull();
      expect(within(row).queryByText('출발점 지정')).toBeNull(); // 옛 문구(TRIP-989 D13 에서 지운 점선 배지)
      expect(screen.queryByTestId('my-stays-base-toggle-s2')).toBeNull();
      expect(within(row).queryAllByRole('button')).toHaveLength(0);

      // 화면 전체의 출발점 버튼은 등록 행(s1)의 것 하나뿐이다.
      expect(
        screen
          .getAllByTestId(/^my-stays-base-toggle-/)
          .map((node) => node.props.testID)
      ).toEqual(['my-stays-base-toggle-s1']);
    });
  });

  /**
   * TRIP-1076 결정 2(A) — 버튼은 Figma l04(1604:2440)대로 「거점 변경」이다(TRIP-1017 의 「출발점 해제」 반전).
   * 누르면 거점 화면으로 가며, 이 화면에서 재생성을 약속하는 문구는 어디에도 없다(01b Q1 — 거점 화면은
   * 재생성하지 않는다).
   */
  describe('🔴 TRIP-1076 AC-6 · 「거점 변경」 문구 (결정 2(A) · 반전)', () => {
    it('행 버튼은 "거점 변경" 버튼으로 읽히고 "거점 해제"라는 글자는 없다', () => {
      renderScreen({ rows: [assignedRow()] });

      // 역할·이름으로 먼저 찾고 testID 를 확인한다 — 글자와 testID 가 따로 드러난다.
      const toggle = screen.getByRole('button', { name: '거점 변경' });
      expect(toggle).toHaveProp('testID', 'my-stays-base-toggle-s1');
      expect(within(toggle).getByText('거점 변경')).toBeOnTheScreen();
      expect(screen.queryByText('거점 해제')).toBeNull();
    });

    it('누른 뒤에도 다이얼로그·재생성 약속 문구가 화면 어디에도 없다', () => {
      renderScreen({ rows: [assignedRow()] });

      fireEvent.press(screen.getByTestId('my-stays-base-toggle-s1'));

      // 긍정 앵커 — 화면(행)은 그대로 있다(아래 "없음"이 빈 화면이라 공허하지 않게).
      expect(screen.getByTestId('my-stays-row-s1')).toBeOnTheScreen();
      expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
      expect(screen.queryAllByText(/다시 생성|재생성|해제할까요/)).toHaveLength(
        0
      );
    });
  });

  describe('🔴 AC-3 · 좌표 미확정 → 토글 비활성(INV-U1-08)', () => {
    // TRIP-989 — 미등록 행의 토글이 사라져 이 심판을 **등록 행으로 옮겼다**(지우면 등록 행 disabled 를
    // 지키는 심판이 0개가 된다). 등록 행도 canAssignBase = coordConfirmed 라 false 가 실제로 가능하다.
    it('canAssignBase=false 면 토글이 real disabled 이고 press 해도 다이얼로그·콜백이 없다', () => {
      const { onPressChangeBase } = renderScreen({
        rows: [assignedRow({ savedStayId: 's3', canAssignBase: false })],
      });

      const toggle = screen.getByTestId('my-stays-base-toggle-s3');
      // 급소: real disabled prop(accessibilityState 만이 아니다).
      expect(toggle).toBeDisabled();

      fireEvent.press(toggle);

      expect(screen.queryByTestId('my-stays-base-dialog')).toBeNull();
      expect(onPressChangeBase).not.toHaveBeenCalled();
    });

    it('canAssignBase=true 면 토글이 비활성이 아니다(짝)', () => {
      renderScreen({
        rows: [assignedRow({ savedStayId: 's4', canAssignBase: true })],
      });

      expect(screen.getByTestId('my-stays-base-toggle-s4')).not.toBeDisabled();
    });
  });

  describe('🔴 AC-4 · 0건 empty + 숙소 탐색(US-NOTIF-06)', () => {
    it('isEmpty 면 안내를 보이고 "숙소 탐색" press 시 탐색 콜백을 1회 부른다', () => {
      const { onPressExplore } = renderScreen({ rows: [], isEmpty: true });

      expect(screen.getByTestId('my-stays-empty')).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('my-stays-explore'));

      expect(onPressExplore).toHaveBeenCalledTimes(1);
    });

    it('행이 있으면 empty 안내가 없다(짝)', () => {
      renderScreen({ rows: [assignedRow()], isEmpty: false });

      expect(screen.queryByTestId('my-stays-empty')).toBeNull();
    });
  });

  describe('🔴 TRIP-991 · 앱바 뒤로 접근성 (AC-2)', () => {
    it('앱바 뒤로는 "뒤로" 버튼으로 읽히고, 누르면 onPressBack 이 1회 불린다', () => {
      const onPressBack = jest.fn();
      renderScreen({ onPressBack });

      // 역할·이름으로 먼저 찾고 testID 는 뒤에 확인한다 — 라벨 누락과 testID 누락이 따로 드러난다.
      const back = screen.getByRole('button', { name: '뒤로' });
      expect(back).toHaveProp('testID', 'my-stays-back');

      fireEvent.press(back);
      expect(onPressBack).toHaveBeenCalledTimes(1);
    });
  });
});

// 옛 MyStaysScreen.l04parity — TRIP-777. 생김새 단언(모서리·색·간격·SVG)은 README 판정 4 로 지웠고
// 문구·조건부 표시 단언만 남겼다(TRIP-1367).
describe('Figma l04 정합 (옛 .l04parity)', () => {
  const EMPTY_DESCRIPTION = '숙소를 탐색하고 등록하면\n일정을 만들 수 있습니다';

  function assignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
    return {
      savedStayId: 's1',
      name: '부산 그랜드 호텔',
      location: '부산 해운대구 우동',
      dateRangeLabel: '6.10 ~ 6.13',
      sourceLabel: 'OTA 예약',
      memoLabel: null,
      linkedTripLabel: '연결 여행 · 부산 여행',
      baseState: 'assigned',
      canAssignBase: true,
      tripId: 't1',
      baseAssignmentId: 'ba1',
      ...over,
    };
  }

  function unassignedRow(over: Partial<MyStayRowVM> = {}): MyStayRowVM {
    return {
      savedStayId: 's2',
      name: '○○ 게스트하우스',
      location: '부산 중구 남포동',
      dateRangeLabel: '6.14 ~ 6.15',
      sourceLabel: '앱 저장',
      memoLabel: '예약번호 미입력',
      linkedTripLabel: '연결된 여행 없음',
      baseState: 'unassigned',
      canAssignBase: true,
      tripId: null,
      baseAssignmentId: null,
      ...over,
    };
  }

  function renderRows(rows: MyStayRowVM[]) {
    render(
      <MyStaysScreen
        rows={rows}
        isEmpty={false}
        onPressChangeBase={jest.fn()}
        onPressExplore={jest.fn()}
      />
    );
  }

  function renderEmpty() {
    render(
      <MyStaysScreen
        rows={[]}
        isEmpty
        onPressChangeBase={jest.fn()}
        onPressExplore={jest.fn()}
      />
    );
  }

  function hostTextCount(node: ReactTestInstance): number {
    return node.findAll((n) => String(n.type) === 'Text').length;
  }

  describe('🔴 TRIP-777 · l04 default — 출발점 배지·링크 (AC-1)', () => {
    it('등록 행에는 "출발점" 배지 글자가 있다', () => {
      renderRows([assignedRow()]);

      const row = screen.getByTestId('my-stays-row-s1');
      expect(within(row).getByText('거점')).toBeOnTheScreen();
    });

    it('미등록 행에는 점선 "거점 지정" 배지도 "출발점" 배지도 없다 (TRIP-989 D13 — Figma 1604 와 다름)', () => {
      renderRows([unassignedRow()]);

      // 행 자체는 그려진다 — 아래 "없음" 단언이 빈 화면으로 통과하지 않게.
      const row = screen.getByTestId('my-stays-row-s2');
      expect(within(row).getByText('○○ 게스트하우스')).toBeOnTheScreen();

      expect(within(row).queryByText('거점 지정')).toBeNull();
      expect(within(row).queryByText('출발점 지정')).toBeNull(); // 옛 문구(TRIP-989 D13 에서 지운 점선 배지)
      expect(within(row).queryByText('거점')).toBeNull();
      expect(within(row).queryByText('출발점')).toBeNull();
    });

    it('"거점 변경" 글자는 정확히 "거점 변경"(› 문자 없음)이다', () => {
      renderRows([assignedRow()]);

      const toggle = screen.getByTestId('my-stays-base-toggle-s1');
      expect(within(toggle).getByText('거점 변경')).toBeOnTheScreen();
      // "›" 를 별도 <Text> 조각으로 남기는 우회도 잡는다.
      expect(screen.queryAllByText(/›/)).toHaveLength(0);
    });
  });

  describe('🔴 TRIP-777 · l04 default — 칩·카드·주소·구분선 (AC-2)', () => {
    it('주소가 있으면 한 줄이 생기고, 비어 있으면 그 줄이 없다(짝)', () => {
      renderRows([
        assignedRow(),
        assignedRow({ savedStayId: 's5', location: '' }),
      ]);

      expect(
        within(screen.getByTestId('my-stays-row-s1')).getByText(
          '부산 해운대구 우동'
        )
      ).toBeOnTheScreen();

      // 주소만 다른 두 카드 — 글자 조각 수가 정확히 1 차이(빈 줄을 그리면 차이가 0).
      const withAddress = hostTextCount(screen.getByTestId('my-stays-row-s1'));
      const without = hostTextCount(screen.getByTestId('my-stays-row-s5'));
      expect(withAddress - without).toBe(1);
    });
  });

  describe('🔴 TRIP-777 · l04 empty (AC-3)', () => {
    it('제목 없이 설명만 있다', () => {
      renderEmpty();

      const empty = screen.getByTestId('my-stays-empty');
      expect(within(empty).getByText(EMPTY_DESCRIPTION)).toBeOnTheScreen();
      expect(screen.queryByText('아직 등록된 숙소가 없어요')).toBeNull();
    });

    it('"숙소 탐색" 버튼 글자는 "숙소 탐색"이다', () => {
      renderEmpty();

      const cta = screen.getByTestId('my-stays-explore');
      expect(within(cta).getByText('숙소 탐색')).toBeOnTheScreen();
    });
  });
});
