import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { View } from 'react-native';

import {
  CollageEmptyState,
  type CollageEmptyStateProps,
} from './CollageEmptyState';

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

describe('C-7·C-8·C-9 · 글자와 CTA (AC-1·AC-4 · Seed Q1 ③)', () => {
  it('CTA 를 누르면 onPressCta 가 한 번 불린다', () => {
    renderState();

    fireEvent.press(screen.getByTestId('probe-cta'));

    expect(onPressCta).toHaveBeenCalledTimes(1);
  });
});
