import { fireEvent, render, screen } from '@testing-library/react-native';
import { processColor, StyleSheet } from 'react-native';

import { HeartFilledGlyph as SharedHeartFilledGlyph } from '@/shared/ui/HeartGlyphs';

import {
  SavedStayListScreen,
  type SavedStayCardVM,
} from './SavedStayListScreen';
import { HeartFilledGlyph as StayHeartFilledGlyph } from './StayGlyphs';

/**
 * TRIP-461 AC-2·3·4·6·7·8 — e04 저장한 숙소 **무상태 화면**의 렌더 계약.
 *
 * 무엇을 보장하나: `SavedStayListScreen` 은 페이지가 완성해 내려준 값(`savedStays` VM 목록 ·
 * `face` 문자열 · `isGuest`)만으로 목록/empty/loading/error/guest 다섯 얼굴을 그리고, 버튼
 * press 를 콜백으로 올린다. 조회·라우팅·합성·판정은 전부 페이지 몫(화면은 콜백만) — 그것을 잠그던
 * 구조 가드(`savedStaysStructure`)는 TRIP-1145 로 지웠다(타 feature import 는 eslint 층 규칙이 막는다).
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

// 저장 숙소 카드 뷰모델 2건. ss-1 은 Figma 풀샷(거점·지역·2톤 가격 + dateLabel), ss-2 는 degrade
// (이름만) — 두 얼굴을 한 results 렌더에서 동시에 잰다(TRIP-729). dateLabel 은 F-10 잠금용으로 남긴다.
const STAYS: SavedStayCardVM[] = [
  {
    savedStayId: 'ss-1',
    name: '해운대 오션뷰 호텔',
    dateLabel: '6.10~6.13',
    isBase: true,
    region: '해운대',
    priceLabel: '145,000원~',
  },
  { savedStayId: 'ss-2', name: '제주 돌담 게스트하우스' },
];

// className 토큰 배열 — 부분포함(`toContain`)으로 재려 오탐 차단(카드 테스트 헬퍼 동형).
function cls(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '').split(/\s+/);
}

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

// TRIP-1019 #019 — 하단 버튼이 "다른 숙소를 거점으로 지정"이라 적혀 있었지만 실제로는 숙소 등록 화면
// (/stays/register)으로 간다. 저장(♥)과 거점은 다른 개념이다(BR-U1-19). 라벨을 가는 곳의 이름으로
// 바꾼다 — 같은 목적지로 가는 e02 버튼이 이미 쓰는 "숙소 직접 등록"(01b Q2).
describe('S4b · 하단 버튼 이름 = 숙소 직접 등록 (TRIP-1019 #019 · BR-U1-19 · US-STAY-08)', () => {
  it('하단 버튼 안에 "거점" 글자가 없고, 이름이 "숙소 직접 등록"인 버튼이다', () => {
    render(<SavedStayListScreen savedStays={STAYS} face="results" />);

    const button = screen.getByTestId('saved-stay-register');
    // 금지: 저장 목록에서 거점을 지정하는 버튼처럼 읽히지 않는다(부분 포함 정규식).
    expect(button).not.toHaveTextContent(/거점/);
    // 정상: 스크린리더가 읽는 버튼 이름이 가는 곳과 같다(완전일치).
    expect(screen.getByRole('button', { name: '숙소 직접 등록' })).toBe(button);
  });
});

describe('S4 · 버튼 콜백 (AC-6·AC-7)', () => {
  it('하단 "숙소 직접 등록" press → onPressRegister 가 불린다 (AC-6)', () => {
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

describe('S5 · results 카드 Figma 정합 — 거점 배지·지역·2톤 가격 전달 (TRIP-729 AC-6)', () => {
  it('🔴 isBase/region/priceLabel 있는 카드는 배지·지역·2톤 가격을, 없는 카드는 이름만 그린다', () => {
    render(<SavedStayListScreen savedStays={STAYS} face="results" />);

    // ss-1(풀샷) — 거점 배지(testID) + 지역 + 2톤 가격(금액·"~" 각각).
    expect(
      screen.getByTestId('saved-stay-card-ss-1-base-badge')
    ).toBeOnTheScreen();
    expect(screen.getByText('해운대')).toBeOnTheScreen();
    expect(screen.getByText('145,000원')).toBeOnTheScreen();
    expect(screen.getByText('~')).toBeOnTheScreen();

    // ss-2(degrade) — 배지 없음, 이름만(카드 자체는 떠 있다 = 공허 통과 방지 짝).
    expect(screen.queryByTestId('saved-stay-card-ss-2-base-badge')).toBeNull();
    expect(screen.getByText('제주 돌담 게스트하우스')).toBeOnTheScreen();
  });

  it('🔴 F-10 · 날짜라벨 행은 VM 에 dateLabel 이 있어도 미렌더 (화면이 subtitle 미전달)', () => {
    // ss-1 은 dateLabel 을 가졌지만 e04 는 날짜 행을 뗐다(F-10) — 화면이 카드에 날짜를 안 넘긴다.
    render(<SavedStayListScreen savedStays={STAYS} face="results" />);

    // testID 부재만으로는 약하다 — 카드의 subtitle 슬롯이 g02용으로 아직 살아 있어, 누가
    // `subtitle={<Text>{vm.dateLabel}</Text>}`(testID 없이)로 재배선하면 날짜 텍스트가 다시 떠도
    // testID 단언은 green이다(5-c 강화, code-critic 경고-1). 그래서 실제 날짜 문자열 부재로도 잠근다.
    expect(screen.queryByTestId('saved-stay-date-ss-1')).toBeNull();
    expect(screen.queryByText('6.10~6.13')).toBeNull();
  });
});

describe('S6 · empty 콜라주 — 3장 겹침 + 흰 3px 테두리 + 중앙 하트 원 (TRIP-729 AC-8)', () => {
  it('🔴 empty 면 콜라주 사진 3장(각 흰 3px 테두리)과 중앙 하트 원을 그린다', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    // 콜라주 사진 3장 — 겹침·기울기·z·크기 위계는 jest 사각(6-b/TRIP-831), 3장 존재까지만.
    const photos = screen.getAllByTestId(/^saved-stay-empty-photo-/);
    expect(photos).toHaveLength(3);
    // 셋 다 흰 3px 테두리(Figma 정합) — 구 EmptyCluster 는 양옆 카드에 테두리가 없었다.
    photos.forEach((photo) => {
      expect(cls(photo)).toContain('border-[3px]');
      expect(cls(photo)).toContain('border-canvas');
    });
    // 중앙 하트 원.
    expect(screen.getByTestId('saved-stay-empty-heart')).toBeOnTheScreen();
  });

  it('🔴 AC-9 · empty CTA "숙소 둘러보기" radius rounded-[12px] (rounded-[14px] 아님)', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    const tokens = cls(screen.getByTestId('saved-stay-browse'));
    expect(tokens).toContain('rounded-[12px]');
    expect(tokens).not.toContain('rounded-[14px]');
  });
});

/**
 * ── TRIP-1050 · 공통 콜라주 빈 상태로 옮기며 Figma 쪽으로 정합 (AC-3 · 01b Seed Q1 ①②③) ─────
 * e04 는 d02 와 같은 `@/shared/ui/CollageEmptyState` 로 그려진다. 문구·testID·onPress 는 그대로
 * (S2·S4·S6 무수정 green + S7-1), 픽셀은 두 Figma 프레임 공통값으로 바뀐다(사진 그림자 · 공용
 * 하트 · CTA 패딩 22/24). 그림자·하트 모양의 실제 렌더는 6-b 육안 몫이다.
 */

// SVG 색은 host 노드의 `stroke.payload`(processColor 결과 정수)로 남는다 — host 만 고른다.
function strokePayloads(
  node: ReturnType<typeof screen.getByTestId>
): unknown[] {
  return node
    .findAll((n) => typeof n.type === 'string' && n.props.stroke != null)
    .map((n) => n.props.stroke?.payload);
}

describe('S7 · TRIP-1050 공통 틀 이관 — 문구 무회귀 + Figma 정합 (AC-3 · Seed Q1)', () => {
  it('본문·CTA 라벨 문구가 그대로다 (AC-3)', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    expect(
      screen.getByText(
        '인기 숙소를 둘러보고 ♥로 저장하면\n여기에 모아 바로 거점으로 쓸 수 있어요'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('숙소 둘러보기')).toBeOnTheScreen();
  });

  it('🔴 사진 3장이 각각 작은 그림자(0/2/10 · .06)를 갖는다 (Seed Q1 ①)', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    const photos = screen.getAllByTestId(/^saved-stay-empty-photo-/);
    expect(photos).toHaveLength(3);
    photos.forEach((photo) => {
      expect(StyleSheet.flatten(photo.props.style)).toMatchObject({
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
      });
    });
  });

  it('🔴 하트 원 안의 하트가 shared/ui 공용 하트이고 StayGlyphs 하트가 아니다 (Seed Q1 ②)', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    const heart = screen.getByTestId('saved-stay-empty-heart');
    // 이름이 같은 두 함수를 정체성으로 가른다 — 긍정(공용 1)과 부정(stay 0)을 함께 건다.
    expect(heart.findAllByType(SharedHeartFilledGlyph)).toHaveLength(1);
    expect(heart.findAllByType(StayHeartFilledGlyph)).toHaveLength(0);
  });

  it('🔴 CTA 좌우 패딩이 22/24 다 — px 28 이 아니다 (Seed Q1 ③)', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    const tokens = cls(screen.getByTestId('saved-stay-browse'));
    expect(tokens).toContain('pl-[22px]');
    expect(tokens).toContain('pr-2xl');
    expect(tokens).not.toContain('px-[28px]');
    // 높이·radius 는 그대로(AC-9 짝).
    expect(tokens).toContain('h-[52px]');
    expect(tokens).toContain('rounded-[12px]');
  });

  it('CTA 돋보기는 흰색이다 — 아이콘이 prop 으로 옮겨져도 색이 새지 않는다', () => {
    render(<SavedStayListScreen savedStays={[]} face="empty" />);

    const payloads = strokePayloads(screen.getByTestId('saved-stay-browse'));
    // 긍정 짝 — stroke 노드가 없으면 아래 forEach 가 공허 통과한다.
    expect(payloads.length).toBeGreaterThanOrEqual(1);
    payloads.forEach((payload) => expect(payload).toBe(processColor('white')));
  });
});
