import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  useGetTripsTripIdReflections,
  usePostTripsTripIdReflectionsDayDate,
  usePutTripsTripIdReflectionsDayDate,
} from '@/shared/api/generated/reflection/reflection';
import type {
  Reflection,
  ReflectionCard,
} from '@/shared/api/generated/schemas';
import { DailyReflectionPage } from './DailyReflectionPage';

/**
 * TRIP-945 · j03 오늘의 회고 — 회고 계약 이전(narrative→card · text→card)을 사용자 흐름으로 잠근다.
 *
 * 무엇을 보장하나:
 *  - AC-1: 본문은 서버가 고른 `card.subtitle` 이다. 클라가 `editedCard ?? draftCard` 를 다시 고르지 않는다.
 *  - AC-3: 편집을 열면 입력칸 초기값도 `card.subtitle`(회고가 없으면 빈 칸).
 *  - AC-4·5: 고쳐 저장하면 PUT 바디는 `{ card }` 한 필드이고, 그 카드의 cover.title 이 비지 않는다.
 *  - AC-6: 규칙 카드를 그린 화면 어디에도 소요시간 표기가 없다(INV-3).
 *
 * 생성 훅 3개만 목하고 페이지·useDailyReflection·화면은 실물로 태운다 — 저장 버튼에서 PUT 바디까지 한 줄.
 */

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
    back: jest.fn(),
  },
}));

jest.mock('@/shared/api/generated/trips/trips', () => ({
  useGetTripsTripId: jest.fn(() => ({
    data: undefined,
    isPending: false,
    isError: false,
  })),
}));

jest.mock('@/shared/api/generated/reflection/reflection', () => ({
  useGetTripsTripIdReflections: jest.fn(),
  usePostTripsTripIdReflectionsDayDate: jest.fn(),
  usePutTripsTripIdReflectionsDayDate: jest.fn(),
}));

const TRIP_ID = 'trip-1';
const DAY = '2026-06-11';

const RULE_TITLE = '광안리해수욕장 외 3곳';
const RULE_SUBTITLE =
  '광안리해수욕장·부산시립미술관·해운대시장 외 1곳 을(를) 다녀왔어요. 이동 거리는 약 12.0km 였어요. 사진 6장을 남겼어요.';
const RULE_SCENES = [
  '광안리해수욕장',
  '부산시립미술관',
  '해운대시장',
  '감천문화마을',
].map((name) => ({ layout: 'TEXT', caption: `${name} 을(를) 다녀왔어요.` }));

const RULE_CARD: ReflectionCard = {
  templateId: 'backend.rule.daily.v1',
  format: 'CARD',
  title: RULE_TITLE,
  subtitle: RULE_SUBTITLE,
  payload: JSON.stringify({
    template_id: 'backend.rule.daily.v1',
    format: 'CARD',
    cover: { title: RULE_TITLE, subtitle: RULE_SUBTITLE },
    scenes: RULE_SCENES,
  }),
};

/** 소요시간 표기 탐지기(INV-3) — reflectionStructure G6 과 같은 식. */
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

function withSubtitle(subtitle: string): ReflectionCard {
  return { ...RULE_CARD, subtitle };
}

/** card 와 제목·장면이 다른 카드 — 저장 바탕이 card 가 아니면 PUT 바디에 이 제목이 실린다. */
function otherCard(title: string): ReflectionCard {
  return {
    ...RULE_CARD,
    title,
    subtitle: `${title} 문장`,
    payload: JSON.stringify({
      template_id: 'backend.rule.daily.v1',
      format: 'CARD',
      cover: { title, subtitle: `${title} 문장` },
      scenes: [],
    }),
  };
}

function reflection(over: Partial<Reflection> = {}): Reflection {
  return {
    dayDate: DAY,
    card: RULE_CARD,
    draftCard: withSubtitle('초안 D'),
    editedCard: null,
    source: 'RULE',
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    generatedAt: '2026-06-11T09:00:00Z',
    updatedAt: '2026-06-11T10:00:00Z',
    ...over,
  };
}

const put = jest.fn();

function mockApi(items: Reflection[]) {
  (useGetTripsTripIdReflections as jest.Mock).mockReturnValue({
    data: { items },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });
  (usePostTripsTripIdReflectionsDayDate as jest.Mock).mockReturnValue({
    mutate: jest.fn(),
  });
  (usePutTripsTripIdReflectionsDayDate as jest.Mock).mockReturnValue({
    mutate: put,
  });
}

function renderPage() {
  render(<DailyReflectionPage tripId={TRIP_ID} date={DAY} />);
}

function saveEdit(text: string) {
  fireEvent.press(screen.getByTestId('reflection-daily-edit'));
  fireEvent.changeText(screen.getByTestId('reflection-daily-edit-input'), text);
  fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));
}

/** put.mutate 첫 호출의 인자(= { tripId, dayDate, data }). */
function putArgs() {
  return put.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AC-1 · 본문은 서버가 고른 card.subtitle 이다 (BR-U5-35)', () => {
  it('card.subtitle 을 본문 칸에 그대로 그린다', () => {
    mockApi([reflection()]);

    renderPage();

    expect(screen.getByTestId('reflection-daily-narrative')).toHaveTextContent(
      RULE_SUBTITLE
    );
  });

  it('editedCard 가 card 와 달라도 card.subtitle 을 그린다(클라가 표시본을 다시 고르지 않는다)', () => {
    mockApi([reflection({ editedCard: withSubtitle('수정본 E') })]);

    renderPage();

    expect(screen.getByTestId('reflection-daily-narrative')).toHaveTextContent(
      RULE_SUBTITLE
    );
  });
});

describe('AC-3 · 편집 입력칸의 초기값', () => {
  it('편집을 열면 card.subtitle 이 입력칸에 채워진다(editedCard ?? draftCard 를 다시 고르지 않는다)', () => {
    mockApi([reflection({ editedCard: withSubtitle('수정본 E') })]);
    renderPage();

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(
      screen.getByTestId('reflection-daily-edit-input')
    ).toHaveDisplayValue(RULE_SUBTITLE);
  });

  it('회고가 없으면 입력칸은 빈 칸으로 열린다', () => {
    mockApi([]);
    renderPage();

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    expect(
      screen.getByTestId('reflection-daily-edit-input')
    ).toHaveDisplayValue('');
  });
});

describe('AC-4 · 저장하면 PUT 바디는 { card } 한 필드다 (결정 2 · PBT-U5-F1)', () => {
  it('원래 카드에서 cover.subtitle 만 고친 카드 문자열을 보낸다(text 필드 없음)', () => {
    mockApi([reflection()]);
    renderPage();

    saveEdit('바다가 좋았다');

    expect(put).toHaveBeenCalledTimes(1);
    const { tripId, dayDate, data } = putArgs();
    expect(tripId).toBe(TRIP_ID);
    expect(dayDate).toBe(DAY);
    expect(Object.keys(data)).toEqual(['card']);
    const parsed = JSON.parse(data.card);
    expect(parsed.cover.subtitle).toBe('바다가 좋았다');
    expect(parsed.cover.title).toBe(RULE_TITLE);
    expect(parsed.scenes).toEqual(RULE_SCENES);
  });

  it('draftCard·editedCard 가 card 와 달라도 저장 바탕은 서버가 고른 card 다(클라가 다시 고르지 않는다)', () => {
    mockApi([
      reflection({
        draftCard: otherCard('초안 제목 D'),
        editedCard: otherCard('수정본 제목 E'),
      }),
    ]);
    renderPage();

    saveEdit('바다가 좋았다');

    const parsed = JSON.parse(putArgs().data.card);
    expect(parsed.cover.title).toBe(RULE_TITLE);
    expect(parsed.scenes).toEqual(RULE_SCENES);
  });
});

describe('AC-5 · 회고가 없는 날 직접 써서 저장해도 cover.title 이 채워진다 (BR-U5-36)', () => {
  it('사용자 글의 첫 줄을 제목으로 쓰고 template_id 는 보내지 않는다', () => {
    mockApi([]);
    renderPage();

    saveEdit('직접 쓴 하루\n둘째 줄');

    expect(put).toHaveBeenCalledTimes(1);
    const { data } = putArgs();
    expect(Object.keys(data)).toEqual(['card']);
    const parsed = JSON.parse(data.card);
    expect(parsed.cover.title).toBe('직접 쓴 하루');
    expect(parsed.cover.subtitle).toBe('직접 쓴 하루\n둘째 줄');
    expect(parsed).not.toHaveProperty('template_id');
  });
});

describe('AC-6 · 규칙 카드를 그린 화면에 소요시간 표기가 없다 (INV-3)', () => {
  it('화면 전체 글자에 소요·N분·N시간이 없고, 거리 문장은 있다', () => {
    mockApi([reflection()]);

    renderPage();

    expect(screen.root).not.toHaveTextContent(DURATION_TEXT);
    // 긍정 짝 — 규칙 카드 문장이 실제로 그려졌다(빈 화면이라 통과하는 게 아니다).
    expect(screen.root).toHaveTextContent(/12\.0km/);
  });
});
