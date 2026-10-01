import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import {
  CollageEmptyState,
  type CollageEmptyStateProps,
} from './CollageEmptyState';
import { HeartFilledGlyph } from './HeartGlyphs';

/**
 * TRIP-1050 — 콜라주 빈 상태 공통 컴포넌트(d02 담은 장소 · e04 저장한 숙소가 함께 쓴다).
 *
 * 무엇을 보장하나: 틀(콜라주 320×170 · 사진 3장 흰 3px 테두리+작은 그림자 · 하트 원 52 · 제목 20 ·
 * 본문 13/21 · CTA 52 r12 pl22 pr24 + 카드 그림자)은 컴포넌트가 갖고, 문구·CTA 아이콘·testID·
 * press 는 props 로 받는다. 값의 근거는 Figma `1695:1183`·`1702:1183` + 디자인 킷 §3(그림자 두 벌).
 *
 * 문구는 일부러 도메인과 무관한 값으로 준다 — shared 는 "장소/숙소"를 모르는 원시 부품이어야
 * 한다(README §65). 겹침·z 순서·그림자의 실제 모양은 jest 사각이라 6-b 육안 몫이다.
 */

const SHADOW_SM = {
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
};
const SHADOW_CARD = {
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
};

const TITLE = '빈 목록 제목';
const DESCRIPTION = '첫 줄 안내\n둘째 줄 안내';
const CTA_LABEL = '둘러보기';

const onPressCta = jest.fn();

beforeEach(() => {
  onPressCta.mockClear();
});

function renderState(overrides: Partial<CollageEmptyStateProps> = {}) {
  render(
    <CollageEmptyState
      testID="probe-empty"
      title={TITLE}
      description={DESCRIPTION}
      ctaTestID="probe-cta"
      ctaLabel={CTA_LABEL}
      ctaIcon={<View testID="probe-icon" />}
      onPressCta={onPressCta}
      {...overrides}
    />
  );
}

// className 토큰 배열 — 부분 문자열 오탐(`pr-2xl` ⊂ 다른 토큰)을 막으려 공백으로 쪼개 원소로 잰다.
function cls(el: { props: { className?: unknown } }): string[] {
  return String(el.props.className ?? '').split(/\s+/);
}

describe('C-1·C-2 · 파생 testID 트리와 슬롯 (AC-5·AC-6)', () => {
  it('루트 testID 를 접두로 art·photo 0/1/2·heart 가 붙고, CTA 는 ctaTestID 로 잡힌다', () => {
    renderState();

    expect(screen.getByTestId('probe-empty')).toBeOnTheScreen();
    expect(screen.getByTestId('probe-empty-art')).toBeOnTheScreen();
    expect(
      screen
        .getAllByTestId(/^probe-empty-photo-/)
        .map((node) => String(node.props.testID))
        .sort()
    ).toEqual([
      'probe-empty-photo-0',
      'probe-empty-photo-1',
      'probe-empty-photo-2',
    ]);
    expect(screen.getByTestId('probe-empty-heart')).toBeOnTheScreen();
    expect(screen.getByTestId('probe-cta')).toBeOnTheScreen();
  });

  it('받은 제목·본문(\\n 포함)·라벨을 그리고, 받은 아이콘을 CTA 안에 그린다', () => {
    renderState();

    const root = screen.getByTestId('probe-empty');
    expect(within(root).getByText(TITLE)).toBeOnTheScreen();
    expect(within(root).getByText(DESCRIPTION)).toBeOnTheScreen();

    const cta = screen.getByTestId('probe-cta');
    expect(within(cta).getByText(CTA_LABEL)).toBeOnTheScreen();
    expect(within(cta).getByTestId('probe-icon')).toBeOnTheScreen();
  });

  it('컴포넌트가 스스로 도메인 문구를 그리지 않는다', () => {
    renderState();

    // 긍정 짝 — 실제로 그려졌다(없으면 아래 0건이 공허하다).
    expect(screen.getByTestId('probe-empty')).toBeOnTheScreen();
    expect(screen.queryAllByText(/장소|숙소|부산/)).toHaveLength(0);
  });
});

describe('C-4·C-5·C-6 · 콘텐츠·콜라주 틀 (AC-1 · Seed Q1 ①②)', () => {
  it('루트는 위쪽 정렬(pt 96 · px 28)이고 가운데 정렬이 아니며, 콜라주는 320×170 이다', () => {
    renderState();

    const root = cls(screen.getByTestId('probe-empty'));
    expect(root).toContain('pt-[96px]');
    expect(root).toContain('px-[28px]');
    expect(root).not.toContain('justify-center');

    const art = cls(screen.getByTestId('probe-empty-art'));
    expect(art).toContain('w-[320px]');
    expect(art).toContain('h-[170px]');
  });

  it('사진 3장이 각각 흰 3px 테두리와 작은 그림자(0/2/10 · .06)를 갖는다', () => {
    renderState();

    const photos = screen.getAllByTestId(/^probe-empty-photo-/);
    expect(photos).toHaveLength(3);
    photos.forEach((photo) => {
      expect(cls(photo)).toContain('border-[3px]');
      expect(cls(photo)).toContain('border-canvas');
      // 그림자는 testID 가 붙은 그 노드의 style 이어야 한다(바깥 래퍼에 걸면 red).
      expect(StyleSheet.flatten(photo.props.style)).toMatchObject(SHADOW_SM);
    });
  });

  it('하트 원은 52 흰 원이고, 안의 하트는 shared/ui 공용 HeartFilledGlyph 하나다', () => {
    renderState();

    const heart = screen.getByTestId('probe-empty-heart');
    expect(cls(heart)).toEqual(
      expect.arrayContaining([
        'h-[52px]',
        'w-[52px]',
        'rounded-pill',
        'bg-canvas',
      ])
    );
    // 모양은 SVG path 가 아니라 컴포넌트 정체성으로 잰다 — 같은 이름의 다른 하트 함수는 걸리지 않는다.
    expect(heart.findAllByType(HeartFilledGlyph)).toHaveLength(1);
  });
});

describe('C-7·C-8·C-9 · 글자와 CTA (AC-1·AC-4 · Seed Q1 ③)', () => {
  it('제목은 20px ink, 본문은 13px(label)·행간 21·muted 다', () => {
    renderState();

    const title = cls(screen.getByText(TITLE));
    expect(title).toContain('text-[20px]');
    expect(title).toContain('text-ink');
    expect(title).not.toContain('text-[21px]');

    const body = cls(screen.getByText(DESCRIPTION));
    expect(body).toEqual(
      expect.arrayContaining(['text-label', 'leading-[21px]', 'text-muted'])
    );
    expect(body).not.toContain('text-body');
  });

  it('CTA 는 52 높이 · r12 · 분홍 · 좌 22 우 24 패딩 · 카드 그림자이고, 라벨은 15px 흰 글자다', () => {
    renderState();

    const cta = screen.getByTestId('probe-cta');
    const tokens = cls(cta);
    expect(tokens).toEqual(
      expect.arrayContaining([
        'h-[52px]',
        'rounded-[12px]',
        'bg-primary',
        'pl-[22px]',
        'pr-2xl',
      ])
    );
    ['px-[28px]', 'px-xl', 'h-[48px]', 'rounded-[14px]'].forEach((stale) =>
      expect(tokens).not.toContain(stale)
    );
    expect(StyleSheet.flatten(cta.props.style)).toMatchObject(SHADOW_CARD);

    expect(cls(within(cta).getByText(CTA_LABEL))).toEqual(
      expect.arrayContaining(['text-card-title', 'text-on-primary'])
    );
  });

  it('CTA 를 누르면 onPressCta 가 한 번 불린다', () => {
    renderState();

    fireEvent.press(screen.getByTestId('probe-cta'));

    expect(onPressCta).toHaveBeenCalledTimes(1);
  });
});
