import { fireEvent, render, screen } from '@testing-library/react-native';

import { StaySearchScreen } from './StaySearchScreen';

/**
 * TRIP-725 — e02 우하단 FAB 을 알약 "여행 만들기" 1개에서 **원형 FAB 2개**(위 흰 원 하트 →
 * 담은 숙소 · 아래 분홍 원 ＋ → 숙소 등록)로 바꾼다. 목적지(`/stays/saved`·`/stays/register`)는
 * `StaySearchPage`가 정한다(화면은 라우터를 모른다 — 구조 가드). 이 파일은 화면이 각 FAB press 를
 * 자기 콜백으로 잇는지, 옛 알약 FAB 이 사라졌는지, 목록 끝 여백이 2단 FAB 높이를 덮는지까지만 본다.
 *
 * 무엇을 보장하나:
 *  - 흰 하트 FAB press → onPressSaved 1회 · + FAB press → onPressRegister 1회.
 *  - 스크린리더 이름이 "담은 숙소"/"숙소 등록"으로 갈린다(글리프가 이름에 안 샌다).
 *  - 옛 알약 FAB(`stay-search-fab`·"여행 만들기")이 완전히 소멸한다(개명 아닌 교체).
 *  - 목록 끝 여백(footer)이 2단 FAB 최상단(흰 FAB bottom152+size56=208)을 덮어 마지막 카드를
 *    가리지 않는다 — 픽셀 겹침·두 원 좌표·간격·색은 6-b 실기 몫이고, 여기선 footer 값만 잠근다.
 *  - 콜백 미지정이어도 눌러서 크래시하지 않는다(기존 2-prop 호출 회귀 보호).
 */
describe('e02 2단 원형 FAB 배선 (TRIP-725 · AC-7 · AC-9)', () => {
  it('흰 하트 FAB 을 누르면 onPressSaved 가 불린다', () => {
    const onPressSaved = jest.fn();
    render(
      <StaySearchScreen region="부산" items={[]} onPressSaved={onPressSaved} />
    );

    fireEvent.press(screen.getByTestId('stay-search-fab-saved'));
    expect(onPressSaved).toHaveBeenCalledTimes(1);
  });

  it('분홍 ＋ FAB 을 누르면 onPressRegister 가 불린다', () => {
    const onPressRegister = jest.fn();
    render(
      <StaySearchScreen
        region="부산"
        items={[]}
        onPressRegister={onPressRegister}
      />
    );

    fireEvent.press(screen.getByTestId('stay-search-fab-register'));
    expect(onPressRegister).toHaveBeenCalledTimes(1);
  });

  it('스크린리더가 두 FAB 이름을 "담은 숙소"/"숙소 등록"으로 읽는다', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    // accessibilityLabel 이 붙어 분홍하트·흰＋ 글리프가 이름에 안 샌다.
    expect(screen.getByLabelText('담은 숙소')).toBe(
      screen.getByTestId('stay-search-fab-saved')
    );
    expect(screen.getByLabelText('숙소 등록')).toBe(
      screen.getByTestId('stay-search-fab-register')
    );
  });

  it('옛 알약 FAB(stay-search-fab·"여행 만들기")이 완전히 사라진다', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    // 완전일치라 접두 `stay-search-fab-saved` 와 충돌하지 않는다(§5 실검증).
    expect(screen.queryByTestId('stay-search-fab')).toBeNull();
    expect(screen.queryByText(/여행 만들기/)).toBeNull();
  });

  it('목록 끝 여백이 2단 FAB 최상단(208)을 덮어 마지막 카드를 안 가린다', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    const footer = screen.getByTestId('stay-search-list-footer');
    const cls = String(footer.props.className ?? '');
    expect(cls).toContain('h-[208px]');
  });

  it('콜백 미지정이면 두 FAB 을 눌러도 아무 일이 없다(기존 호출 회귀 보호)', () => {
    render(<StaySearchScreen region="부산" items={[]} />);

    expect(() =>
      fireEvent.press(screen.getByTestId('stay-search-fab-saved'))
    ).not.toThrow();
    expect(() =>
      fireEvent.press(screen.getByTestId('stay-search-fab-register'))
    ).not.toThrow();
  });
});
