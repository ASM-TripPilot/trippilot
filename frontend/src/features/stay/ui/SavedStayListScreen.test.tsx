import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  SavedStayListScreen,
  type SavedStayCardVM,
} from './SavedStayListScreen';

/**
 * TRIP-461 AC-2·3·4·6·7·8 — e04 저장한 숙소 **무상태 화면**의 렌더 계약.
 *
 * 무엇을 보장하나: `SavedStayListScreen` 은 페이지가 완성해 내려준 값(`savedStays` VM 목록 ·
 * `face` 문자열 · `isGuest`)만으로 목록/empty/loading/error/guest 다섯 얼굴을 그리고, 버튼
 * press 를 콜백으로 올린다. 조회·라우팅·합성·판정은 전부 페이지 몫(화면은 콜백만) — 구조
 * 가드(`savedStaysStructure.test.ts`)가 `useState`·라우터·query·타 feature import 0 을 잠근다.
 *
 * *(초심자용 개념)*
 *  - `render(<컴포넌트/>)` 로 그린 뒤 `screen.getByTestId('x')` 로 특정 노드를 집는다.
 *  - `getByTestId` = 없으면 예외(그 자체가 실패), `queryByTestId` = 없으면 `null`(부재 단언용).
 *  - `fireEvent.press(node)` = 그 노드를 눌렀을 때의 `onPress` 를 실제로 실행한다.
 *  - **매처 의미(node_modules 실측, 02a §5-1)**: `getByText('문자열')` = 노드 텍스트 **완전일치**.
 *    `toHaveTextContent(/정규식/)` = **부분 포함**(부제처럼 다른 글자가 섞인 노드는 정규식 필수 —
 *    문자열을 주면 전체 완전일치라 실패한다). `toBeSelected()` = `accessibilityState.selected===true`.
 *  - 담김 하트는 **색(SVG fill)으로 안 잰다** — repo-trap: `*Glyphs.tsx` fill 은 jest 렌더 트리에
 *    안 남는다. 대신 **다른 testID**(`-filled`) + `toBeSelected()` 두 신호로 잰다(★3, e03 선례).
 */

// 저장 숙소 카드 뷰모델 2건 — 이름과 (있으면)날짜라벨만 나른다(계약에 지역·거리·가격 없음, ★7).
const STAYS: SavedStayCardVM[] = [
  { savedStayId: 'ss-1', name: '해운대 오션뷰 호텔', dateLabel: '6.10~6.13' },
  { savedStayId: 'ss-2', name: '제주 돌담 게스트하우스' },
];

function noop(): void {}

describe('S1 · 목록 얼굴 — N개 카드 + 개수 부제 (AC-2)', () => {
  it('저장 숙소 2건이면 카드 2개(각 숙소명)와 부제에 개수 2가 뜬다', () => {
    // 준비 — 결과(results) 얼굴에 숙소 2건.
    render(
      <SavedStayListScreen savedStays={STAYS} face="results" onBack={noop} />
    );

    // 단언 — 두 카드가 각자의 testID·이름으로 실재한다.
    expect(screen.getByTestId('saved-stay-card-ss-1')).toBeOnTheScreen();
    expect(screen.getByTestId('saved-stay-card-ss-2')).toBeOnTheScreen();
    expect(screen.getByText('해운대 오션뷰 호텔')).toBeOnTheScreen();
    expect(screen.getByText('제주 돌담 게스트하우스')).toBeOnTheScreen();

    // 단언 — 부제에 개수 N=2 가 반영된다("저장한 숙소 2곳 …"). 다른 글자가 섞여 정규식 사용.
    expect(screen.getByTestId('saved-stay-subtitle')).toHaveTextContent(/2곳/);
  });

  it('담김 하트는 별도 글리프 testID(-filled) + selected 로 관찰된다 — fill 색이 아니다 (AC-8·★3)', () => {
    // 준비.
    render(<SavedStayListScreen savedStays={STAYS} face="results" />);

    // 단언 — 저장 목록이라 각 카드가 채운 하트 글리프(별도 testID)를 그린다.
    expect(
      screen.getByTestId('saved-stay-heart-filled-ss-1')
    ).toBeOnTheScreen();
    // 단언 — 담김이 접근성 상태로도 노출된다(selected). 두 신호가 함께 있어야 거짓 통과가 막힌다.
    expect(screen.getByTestId('saved-stay-card-ss-1')).toBeSelected();
  });
});

describe('S2 · empty 얼굴 (AC-3)', () => {
  it('empty 면 일러스트+제목+CTA 를 그리고 카드는 0개다', () => {
    // 준비 — 0건 empty 얼굴.
    render(
      <SavedStayListScreen savedStays={[]} face="empty" onPressBrowse={noop} />
    );

    // 단언 — empty 컨테이너·제목·"숙소 둘러보기" CTA 가 실재한다.
    expect(screen.getByTestId('saved-stay-empty')).toBeOnTheScreen();
    expect(
      screen.getByText('마음에 드는 숙소를 저장해 보세요')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('saved-stay-browse')).toBeOnTheScreen();
    // 단언 — 카드·부제는 없다(empty 는 목록 얼굴이 아니다).
    expect(screen.queryByTestId('saved-stay-card-ss-1')).toBeNull();
    expect(screen.queryByTestId('saved-stay-subtitle')).toBeNull();
  });
});

describe('S3 · loading/error/guest 얼굴 — empty 위장 금지 (AC-4·★4·★5)', () => {
  it('loading 이면 로딩 얼굴이고 empty 가 아니다', () => {
    render(<SavedStayListScreen savedStays={[]} face="loading" />);

    expect(screen.getByTestId('saved-stay-loading')).toBeOnTheScreen();
    // empty 위장 금지 — 조회 중을 "담은 게 없다"로 접지 않는다.
    expect(screen.queryByTestId('saved-stay-empty')).toBeNull();
  });

  it('error 이면 오류 얼굴 + 재시도이고 empty 가 아니다', () => {
    const onRetry = jest.fn();
    render(
      <SavedStayListScreen savedStays={[]} face="error" onRetry={onRetry} />
    );

    // 단언 — 오류 얼굴이 뜨고 empty 가 아니다(조회 실패를 부재로 위장 금지, INV-4).
    expect(screen.getByTestId('saved-stay-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('saved-stay-empty')).toBeNull();
    // 실행+단언 — 재시도를 누르면 콜백이 실제로 불린다.
    fireEvent.press(screen.getByTestId('saved-stay-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('게스트(isGuest)면 게스트 얼굴이 face 판정보다 우선한다 — empty 도 loading 도 아니다', () => {
    // 준비 — 게스트는 face 가 loading(=enabled:isAuthed 로 영원히 pending)이어도 게스트가 이긴다(★5).
    render(
      <SavedStayListScreen
        savedStays={[]}
        face="loading"
        isGuest
        onPressLogin={noop}
      />
    );

    // 단언 — 게스트 얼굴이 뜨고, loading/empty 얼굴은 안 뜬다.
    expect(screen.getByTestId('saved-stay-guest')).toBeOnTheScreen();
    expect(screen.queryByTestId('saved-stay-loading')).toBeNull();
    expect(screen.queryByTestId('saved-stay-empty')).toBeNull();
  });
});

describe('S4 · 버튼 콜백 (AC-6·AC-7)', () => {
  it('하단 "거점 지정" press → onPressRegister 가 불린다 (AC-6)', () => {
    const onPressRegister = jest.fn();
    render(
      <SavedStayListScreen
        savedStays={STAYS}
        face="results"
        onPressRegister={onPressRegister}
      />
    );

    fireEvent.press(screen.getByTestId('saved-stay-register'));

    expect(onPressRegister).toHaveBeenCalledTimes(1);
  });

  it('카드 press → onPressCard 가 그 카드의 savedStayId 로 불린다 (AC-5 화면쪽 계약)', () => {
    const onPressCard = jest.fn();
    render(
      <SavedStayListScreen
        savedStays={STAYS}
        face="results"
        onPressCard={onPressCard}
      />
    );

    fireEvent.press(screen.getByTestId('saved-stay-card-ss-2'));

    // 화면은 id 만 올린다(합성·push 는 페이지 몫). 인자가 정확히 savedStayId 여야 한다.
    expect(onPressCard.mock.calls).toEqual([['ss-2']]);
  });

  it('empty CTA "숙소 둘러보기" press → onPressBrowse 가 불린다 (AC-7 화면쪽 계약)', () => {
    const onPressBrowse = jest.fn();
    render(
      <SavedStayListScreen
        savedStays={[]}
        face="empty"
        onPressBrowse={onPressBrowse}
      />
    );

    fireEvent.press(screen.getByTestId('saved-stay-browse'));

    expect(onPressBrowse).toHaveBeenCalledTimes(1);
  });
});
