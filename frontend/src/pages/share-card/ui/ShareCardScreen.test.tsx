import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  CAPTION_MAX_LENGTH,
  HASHTAG_MAX_COUNT,
  SHARE_FORMATS,
  type ShareCardVM,
} from '@/features/reflection/model/shareCard';
import { ShareCardScreen, type ShareCardScreenProps } from './ShareCardScreen';

// TRIP-1071 — 저장·공유 버튼은 `isShareCaptureArmed()`(네이티브 캡처 모듈 3종 실재) 로 그릴지 정하고,
// 누르면 `saveShareCardImage`/`shareShareCardImage` 가 프리뷰 프레임 ref 를 받아 결과를 돌려준다.
// 홀더로 armed 를 갈아끼운다: 기본 false(= 재빌드 전 빌드), 개통 케이스만 true. jest-expo 는 세 모듈을
// "있는 척"하므로(실 판정이면 늘 true) false 짝은 이 목으로만 만든다(02a ★1).
// 팩토리는 호이스팅되므로 `mock` 접두 홀더를 화살표 안에서 **호출 시점에** 읽는다(02a ★3).
const mockShareArmed = { value: false };
const mockSave = jest.fn();
const mockShare = jest.fn();
jest.mock('@/features/share-trip-card/model/shareCapture', () => ({
  isShareCaptureArmed: () => mockShareArmed.value,
  saveShareCardImage: (...args: unknown[]) => mockSave(...args),
  shareShareCardImage: (...args: unknown[]) => mockShare(...args),
}));

// 권한 거부 안내의 [설정 열기] — 리포 관례상 expo-linking(RN Linking 아님, LocationConsentPage 선례).
const mockOpenSettings = jest.fn();
jest.mock('expo-linking', () => ({
  openSettings: (...args: unknown[]) => mockOpenSettings(...args),
}));

beforeEach(() => {
  mockShareArmed.value = false;
  mockSave.mockReset();
  mockShare.mockReset();
  mockOpenSettings.mockReset();
});

/**
 * TRIP-574 · j06 공유 카드 화면(VM·formats 주입, 포맷·편집·결과 안내는 로컬 상태).
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-1(정상 렌더): 제목·포맷 세그(3셀)·프리뷰 프레임·캡션이 그려진다.
 *  - 🔴 AC-2(BR-U5-47): mode 'no-photo' → 안내 문구 표시 · 'default' → 부재(짝).
 *  - 🔴 AC-3: 포맷 셀 press → 선택 상태 전환 + 프리뷰 aspect(9:16→1:1→4:5) 전환.
 *  - TRIP-939(심사 2.1): 캡처 미장전(armed:false)이면 저장/공유 버튼과 "준비 중" 안내를 **아예 그리지
 *    않는다**. TRIP-1071: armed:true 면 버튼이 프리뷰 프레임을 캡처해 저장/공유하고 결과를 인라인으로
 *    알린다(저장 성공·권한 거부·실패 — 공유는 실패만, Q3). 조용히 아무 일도 안 일어나면 INV-4 위반.
 *  - TRIP-1071 결정 2: [편집]은 항상 있고, 해시태그를 인라인으로 고친다(서버 저장 없음) —
 *    validateHashtags(개수)·validateCaption(줄 길이) 한도를 넘으면 확정되지 않고 안내가 뜬다.
 *
 * (개념) `StyleSheet.flatten(node.props.style).aspectRatio` = 인라인 style 에서 종횡비 읽기(§5 실검증) ·
 *   `queryByText(정규식)` = 부분 포함·부재(getBy 는 못 찾으면 throw) · `accessibilityState.selected`
 *   = 세그 활성 셀 판독 · `await act(async () => fireEvent.press(…))` = 비동기 핸들러가 setState 까지
 *   끝나게 흘려보낸다(02a ★5) · `mock.calls[0][0].current` = 실행 함수가 받은 ref 가 가리키는 View.
 *
 * INV-3: 이 파일 픽스처의 caption·place 에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(거리·개수만).
 */

function baseCard(over: Partial<ShareCardVM> = {}): ShareCardVM {
  return {
    title: '부산 여행',
    periodText: '6월 10일 수요일 ~ 6월 12일 금요일',
    regionText: '부산 · 경주',
    statsCells: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
    distanceSourceLabel: '근사',
    orderedVisits: [
      { order: 1, dayLabel: 'Day1', place: '광안리 해변' },
      { order: 2, dayLabel: 'Day1', place: '감천문화마을' },
    ],
    mode: 'default',
    watermark: 'TripPilot',
    aspectRatio: 9 / 16,
    ...over,
  };
}

function baseProps(
  over: Partial<ShareCardScreenProps> = {}
): ShareCardScreenProps {
  return {
    card: baseCard(),
    formats: SHARE_FORMATS,
    caption: '광안리에서 보낸 사흘',
    hashtagText: '#부산여행 #광안리',
    onBack: jest.fn(),
    ...over,
  };
}

function renderScreen(over: Partial<ShareCardScreenProps> = {}) {
  const props = baseProps(over);
  render(<ShareCardScreen {...props} />);
  return props;
}

function frameAspect(): number {
  const frame = screen.getByTestId('reflection-share-preview-frame');
  return StyleSheet.flatten(frame.props.style).aspectRatio as number;
}

interface FrameLayout {
  aspectRatio?: number;
  width?: number | string;
  height?: number | string;
  alignSelf?: string;
  className: string;
}

function frameLayout(): FrameLayout {
  const frame = screen.getByTestId('reflection-share-preview-frame');
  const style = (StyleSheet.flatten(frame.props.style) ?? {}) as Omit<
    FrameLayout,
    'className'
  >;
  return { ...style, className: String(frame.props.className ?? '') };
}

/** 카드 프레임 안의 회색 박스(bg-surface-soft) 호스트 View 수 — testID 를 옮겨 달아 회색 박스만 남기는 우회를 잡는다. */
function greyBoxHostsInFrame(): number {
  const frame = screen.getByTestId('reflection-share-preview-frame');
  return frame.findAll(
    (node) =>
      typeof node.type === 'string' &&
      /(^|\s)bg-surface-soft(\s|$)/.test(String(node.props.className ?? ''))
  ).length;
}

describe('🔴 AC-1 · 정상 렌더 — 카드·세그·버튼·캡션', () => {
  it('제목·포맷 세그(3셀)·프리뷰·저장/공유·캡션을 그린다', () => {
    const props = renderScreen();

    expect(screen.getByText(props.card.title)).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-share-format-seg')).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-format-story')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-format-square')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-format-feed')
    ).toBeOnTheScreen();
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
    expect(screen.getByText(props.caption)).toBeOnTheScreen();
    // TRIP-939 — 캡처 미장전(기본)이라 저장/공유 버튼은 그리지 않는다.
    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
  });
});

// TRIP-1016(D10·INV-4): 지도 히어로가 없으므로(TRIP-634) 안내는 "지도로 만들었다"가 아니라 사실만 말한다.
const VISIT_ORDER_NOTICE = '사진이 없어 방문 순서로 카드를 만들었어요';
const NO_VISIT_NOTICE = '사진과 방문 기록이 없어 여행 정보로 카드를 만들었어요';

describe('🔴 TRIP-1016 AC-4 · no-photo 안내 = 사실 문구(BR-U5-47 · D10)', () => {
  it('mode "no-photo"(방문 있음) → 안내 안에 방문 순서 사실 문구가 뜨고, "동선 지도만으로"는 어디에도 없다', () => {
    renderScreen({ card: baseCard({ mode: 'no-photo' }) });

    const notice = screen.getByTestId('reflection-share-no-photo-notice');
    expect(within(notice).getByText(VISIT_ORDER_NOTICE)).toBeOnTheScreen();
    expect(screen.queryByText(/동선 지도만으로/)).toBeNull();
  });

  it('mode "default" → 안내 컨테이너도, "…카드를 만들었어요" 문구(옛·새·0곳 전부)도 없다(짝)', () => {
    renderScreen({ card: baseCard({ mode: 'default' }) });

    expect(screen.queryByTestId('reflection-share-no-photo-notice')).toBeNull();
    expect(screen.queryByText(/카드를 만들었어요/)).toBeNull();
    // 짝 앵커 — 카드는 그려졌다(화면이 통째로 비어 부재가 공허해진 것이 아님).
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
  });

  it('mode "no-photo" + 방문 0곳 → 0곳 전용 사실 문구가 뜨고, "방문 순서로" 문구는 없다(Q1)', () => {
    renderScreen({ card: baseCard({ mode: 'no-photo', orderedVisits: [] }) });

    const notice = screen.getByTestId('reflection-share-no-photo-notice');
    expect(within(notice).getByText(NO_VISIT_NOTICE)).toBeOnTheScreen();
    expect(screen.queryByText(/방문 순서로/)).toBeNull();
  });
});

describe('🔴 AC-3 · 포맷 세그 전환 — 선택 상태 + 프리뷰 aspect', () => {
  it('story→square→feed 로 aspect 와 선택 셀이 함께 바뀐다', () => {
    renderScreen();

    // 초기 = story(9:16).
    expect(frameAspect()).toBeCloseTo(9 / 16, 5);
    expect(
      screen.getByTestId('reflection-share-format-story').props
        .accessibilityState?.selected
    ).toBe(true);

    // square(1:1).
    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    expect(frameAspect()).toBeCloseTo(1, 5);
    expect(
      screen.getByTestId('reflection-share-format-square').props
        .accessibilityState?.selected
    ).toBe(true);
    expect(
      screen.getByTestId('reflection-share-format-story').props
        .accessibilityState?.selected
    ).toBe(false);

    // feed(4:5).
    fireEvent.press(screen.getByTestId('reflection-share-format-feed'));
    expect(frameAspect()).toBeCloseTo(4 / 5, 5);
  });
});

describe('🔴 AC-3 · 카드 통계 라인이 얼굴별 포맷으로 렌더된다(통일 금지)', () => {
  it('default(포맷 A) — "N곳 · Nkm · 사진 N장"', () => {
    renderScreen({
      card: baseCard({
        mode: 'default',
        statsCells: { totalVisits: 12, distanceText: '38km', totalPhotos: 24 },
      }),
    });
    // 현 프리뷰는 상시 포맷 B(방문 …) → default 기대 A 와 불일치 → red.
    expect(screen.getByText('12곳 · 38km · 사진 24장')).toBeOnTheScreen();
  });

  it('no-photo(포맷 B) — "방문 N · 이동 Nkm · 사진 N"', () => {
    renderScreen({
      card: baseCard({
        mode: 'no-photo',
        statsCells: { totalVisits: 12, distanceText: '38km', totalPhotos: 0 },
      }),
    });
    expect(screen.getByText('방문 12 · 이동 38km · 사진 0')).toBeOnTheScreen();
  });
});

describe('🔴 AC-5 · no-photo 안내 = 박스 없는 플레인 텍스트(좌정렬)', () => {
  it('안내 컨테이너에 박스 크롬(테두리·배경·라운드)이 없고, 문구·좌정렬은 유지된다', () => {
    renderScreen({ card: baseCard({ mode: 'no-photo' }) });

    // 부정 — 박스 크롬 클래스 제거(현 컨테이너는 border·bg-surface-soft·rounded-card → red).
    const notice = screen.getByTestId('reflection-share-no-photo-notice');
    const noticeCls = String(notice.props.className);
    expect(noticeCls).not.toMatch(/\bborder\b/);
    expect(noticeCls).not.toContain('bg-surface-soft');
    expect(noticeCls).not.toContain('rounded-card');

    // 부정 — 내부 문구는 좌정렬(현 text-center 제거 → red).
    const text = screen.getByText(VISIT_ORDER_NOTICE);
    expect(String(text.props.className)).not.toContain('text-center');

    // 긍정 짝 — 문구·testID 는 그대로(현 AC-2 유지 · 공허 통과 차단).
    expect(text).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-939 AC-2 · 캡처 미장전이면 저장/공유 어포던스가 없다 (INV-4 → 어포던스 제거)', () => {
  it('armed:false → 저장·공유 버튼도, "준비 중" 안내도 없다(누를 것도 안내도 없음)', () => {
    // 준비·실행: 기본(armed:false = 오늘의 운영 빌드)으로 그린다.
    renderScreen();

    // 단언: 버튼 2개·degrade 문구가 모두 부재.
    expect(screen.queryByTestId('reflection-share-save')).toBeNull();
    expect(screen.queryByTestId('reflection-share-export')).toBeNull();
    expect(screen.queryByTestId('reflection-share-degrade')).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
    // 짝 앵커: 카드 프리뷰는 그대로 그려졌다(화면이 통째로 빈 것이 아니다).
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
  });
});

// ── TRIP-1071 · 저장·공유 실동작 ─────────────────────────────────────────────

const SAVE_SUCCESS = '사진 앨범에 저장했어요';
const PERMISSION_DENIED = '사진 앨범 권한이 없어 저장하지 못했어요';
const CAPTURE_FAILED = '이미지를 만들지 못했어요. 다시 시도해 주세요';
const DURATION_TEXT = /(소요|\d+\s*분|\d+\s*시간)/;

interface CapturedNode {
  props: { testID?: string; style?: unknown };
}

/** 실행 함수가 1회 불렸고, 받은 ref 가 가리키는 View 를 돌려준다(02a ★4). */
function capturedNode(fn: jest.Mock): CapturedNode | null {
  expect(fn).toHaveBeenCalledTimes(1);
  const [target] = fn.mock.calls[0] as [{ current: CapturedNode | null }];
  return target.current;
}

async function pressAsync(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe('🔴 TRIP-1071 AC-3 · 저장 정상 — 프리뷰 프레임을 캡처해 앨범에 저장하고 성공을 알린다', () => {
  it('reflection-share-save press → 프레임 ref 로 저장 1회, 공유 0회, 결과 안내에 성공 문구', async () => {
    // 준비: 캡처 모듈이 있는 빌드 + 저장 성공.
    mockShareArmed.value = true;
    mockSave.mockResolvedValue({ status: 'saved' });
    renderScreen();

    // 실행
    await pressAsync('reflection-share-save');

    // 단언: 캡처 대상은 프리뷰 프레임 자체다(래퍼 View 가 아니다).
    expect(capturedNode(mockSave)?.props.testID).toBe(
      'reflection-share-preview-frame'
    );
    expect(mockShare).not.toHaveBeenCalled();
    const result = screen.getByTestId('reflection-share-result');
    expect(within(result).getByText(SAVE_SUCCESS)).toBeOnTheScreen();
    // 성공엔 설정 유도가 없다 + 결과 문구에도 소요시간 0(INV-3).
    expect(screen.queryByTestId('reflection-share-open-settings')).toBeNull();
    expect(within(result).queryByText(DURATION_TEXT)).toBeNull();
  });

  it('AC-8 · 1:1 을 고른 뒤 저장하면 캡처 대상 프레임이 1:1 로 그려져 있다', async () => {
    mockShareArmed.value = true;
    mockSave.mockResolvedValue({ status: 'saved' });
    renderScreen();

    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    await pressAsync('reflection-share-save');

    const node = capturedNode(mockSave);
    expect(node?.props.testID).toBe('reflection-share-preview-frame');
    const style = StyleSheet.flatten(
      node?.props.style as Parameters<typeof StyleSheet.flatten>[0]
    ) as { aspectRatio?: number } | undefined;
    expect(style?.aspectRatio as number).toBeCloseTo(1, 5);
  });
});

describe('🔴 TRIP-1071 AC-5·AC-6 · 실패는 드러낸다 (INV-4 — 가짜 성공·침묵 금지)', () => {
  it('권한 거부 → 거부 문구 + [설정 열기](openSettings 1회), 성공 문구 없음', async () => {
    mockShareArmed.value = true;
    mockSave.mockResolvedValue({ status: 'permission-denied' });
    renderScreen();

    await pressAsync('reflection-share-save');

    const result = screen.getByTestId('reflection-share-result');
    expect(within(result).getByText(PERMISSION_DENIED)).toBeOnTheScreen();
    expect(screen.queryByText(SAVE_SUCCESS)).toBeNull();

    fireEvent.press(screen.getByTestId('reflection-share-open-settings'));
    expect(mockOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('저장 실패 결과(failed) → 실패 문구, 성공 문구·설정 유도 없음', async () => {
    mockShareArmed.value = true;
    mockSave.mockResolvedValue({ status: 'failed' });
    renderScreen();

    await pressAsync('reflection-share-save');

    const result = screen.getByTestId('reflection-share-result');
    expect(within(result).getByText(CAPTURE_FAILED)).toBeOnTheScreen();
    expect(screen.queryByText(SAVE_SUCCESS)).toBeNull();
    expect(screen.queryByTestId('reflection-share-open-settings')).toBeNull();
  });

  it('실행 함수가 예외로 끝나도(reject) 실패 문구를 보인다 — 조용히 삼키지 않는다', async () => {
    mockShareArmed.value = true;
    mockSave.mockRejectedValue(new Error('unexpected'));
    renderScreen();

    await pressAsync('reflection-share-save');

    const result = screen.getByTestId('reflection-share-result');
    expect(within(result).getByText(CAPTURE_FAILED)).toBeOnTheScreen();
    expect(screen.queryByText(SAVE_SUCCESS)).toBeNull();
  });
});

describe('🔴 TRIP-1071 AC-4 · 공유 — 프레임을 캡처해 공유 시트로, 성공 안내는 띄우지 않는다(Q3)', () => {
  it('reflection-share-export press → 프레임 ref 로 공유 1회, 저장 0회, 결과 블록 없음', async () => {
    mockShareArmed.value = true;
    mockShare.mockResolvedValue({ status: 'shared' });
    renderScreen();

    await pressAsync('reflection-share-export');

    expect(capturedNode(mockShare)?.props.testID).toBe(
      'reflection-share-preview-frame'
    );
    expect(mockSave).not.toHaveBeenCalled();
    // 부재 단언 — 같은 흘림 방식의 존재 짝(아래 공유 실패)이 공허 통과를 막는다(02a ★5).
    expect(screen.queryByTestId('reflection-share-result')).toBeNull();
  });

  it('공유 실패(failed) → 실패 문구가 뜬다(짝)', async () => {
    mockShareArmed.value = true;
    mockShare.mockResolvedValue({ status: 'failed' });
    renderScreen();

    await pressAsync('reflection-share-export');

    const result = screen.getByTestId('reflection-share-result');
    expect(within(result).getByText(CAPTURE_FAILED)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1071 AC-9 · no-photo 카드도 같은 경로로 저장·공유한다 (BR-U5-47)', () => {
  it('mode no-photo → 저장·공유 모두 프리뷰 프레임을 대상으로 1회씩', async () => {
    mockShareArmed.value = true;
    mockSave.mockResolvedValue({ status: 'saved' });
    mockShare.mockResolvedValue({ status: 'shared' });
    renderScreen({ card: baseCard({ mode: 'no-photo' }) });

    await pressAsync('reflection-share-save');
    await pressAsync('reflection-share-export');

    expect(capturedNode(mockSave)?.props.testID).toBe(
      'reflection-share-preview-frame'
    );
    expect(capturedNode(mockShare)?.props.testID).toBe(
      'reflection-share-preview-frame'
    );
  });
});

// ── TRIP-1071 결정 2 · 해시태그 인라인 편집 ─────────────────────────────────

const HASHTAG_LIMIT_NOTICE = `해시태그는 ${HASHTAG_MAX_COUNT}개까지 넣을 수 있어요`;
const LENGTH_LIMIT_NOTICE = `${CAPTION_MAX_LENGTH}자까지 쓸 수 있어요`;

function openEditor() {
  fireEvent.press(screen.getByTestId('reflection-share-caption-edit'));
  return screen.getByTestId('reflection-share-caption-input');
}

function commit(text: string) {
  fireEvent.changeText(
    screen.getByTestId('reflection-share-caption-input'),
    text
  );
  fireEvent.press(screen.getByTestId('reflection-share-caption-save'));
}

describe('🔴 TRIP-939 A-1 → TRIP-1071 · [편집]은 주입 없이 항상 있다(인라인 편집, 결정 2)', () => {
  it('armed:false·onEditCaption 없음이어도 [편집]이 있고, 누르면 입력칸이 현재 해시태그로 채워져 열린다', () => {
    // 준비: 캡처 미장전(기본) — 편집은 캡처와 무관하다.
    const props = renderScreen();

    // 실행
    const input = openEditor();

    // 단언
    expect(input).toHaveDisplayValue(props.hashtagText);
    expect(
      screen.getByTestId('reflection-share-caption-save')
    ).toBeOnTheScreen();
    // 캡션 문장은 그대로 남는다(편집 대상은 해시태그만).
    expect(screen.getByText(props.caption)).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1071 AC-10 · 해시태그 편집 확정 → 캡션 카드에 새 값', () => {
  it('입력 후 확정하면 입력칸이 닫히고 새 해시태그 줄이 보이며 옛 줄은 없다', () => {
    const props = renderScreen();

    openEditor();
    commit('#부산여행 #광안리 #해운대');

    expect(screen.queryByTestId('reflection-share-caption-input')).toBeNull();
    expect(screen.getByText('#부산여행 #광안리 #해운대')).toBeOnTheScreen();
    expect(screen.queryByText(props.hashtagText)).toBeNull();
    expect(screen.queryByTestId('reflection-share-caption-error')).toBeNull();
  });

  it('`#` 를 자동으로 붙이지 않는다 — 입력한 단어 그대로 보인다(Q1)', () => {
    renderScreen();

    openEditor();
    commit('부산 광안리');

    expect(screen.getByText('부산 광안리')).toBeOnTheScreen();
    expect(screen.queryByText('#부산 #광안리')).toBeNull();
  });

  it('비운 채 확정해도 된다(0개 허용) — 입력칸이 닫히고 안내가 없다(Q1)', () => {
    const props = renderScreen();

    openEditor();
    commit('');

    expect(screen.queryByTestId('reflection-share-caption-input')).toBeNull();
    expect(screen.queryByTestId('reflection-share-caption-error')).toBeNull();
    expect(screen.queryByText(props.hashtagText)).toBeNull();
  });

  it('공백이 여러 칸이어도 빈 토큰은 개수에 안 친다 — 두 칸 간격 10개는 확정된다', () => {
    renderScreen();
    const tags = Array.from(
      { length: HASHTAG_MAX_COUNT },
      (_, index) => `#태그${index + 1}`
    );

    openEditor();
    commit(tags.join('  '));

    expect(screen.queryByTestId('reflection-share-caption-input')).toBeNull();
    expect(screen.queryByTestId('reflection-share-caption-error')).toBeNull();
    // getByText 기본 정규화가 연속 공백을 한 칸으로 접는다(02a ★11).
    expect(screen.getByText(tags.join(' '))).toBeOnTheScreen();
  });
});

describe('🔴 TRIP-1071 AC-11 · 편집 한도 — 넘치면 확정되지 않고 안내가 뜬다', () => {
  it(`해시태그 ${HASHTAG_MAX_COUNT + 1}개 → 입력칸 유지 + 개수 안내, 넘친 값은 캡션 줄로 안 간다`, () => {
    renderScreen();
    const over = Array.from(
      { length: HASHTAG_MAX_COUNT + 1 },
      (_, index) => `#태그${index + 1}`
    ).join(' ');

    openEditor();
    commit(over);

    expect(
      screen.getByTestId('reflection-share-caption-input')
    ).toBeOnTheScreen();
    const error = screen.getByTestId('reflection-share-caption-error');
    expect(within(error).getByText(HASHTAG_LIMIT_NOTICE)).toBeOnTheScreen();
    expect(screen.queryByText(over)).toBeNull();
  });

  it(`줄 길이 ${CAPTION_MAX_LENGTH + 1}자(태그 1개) → 입력칸 유지 + 길이 안내`, () => {
    renderScreen();
    const long = `#${'가'.repeat(CAPTION_MAX_LENGTH)}`;

    openEditor();
    commit(long);

    expect(
      screen.getByTestId('reflection-share-caption-input')
    ).toBeOnTheScreen();
    const error = screen.getByTestId('reflection-share-caption-error');
    expect(within(error).getByText(LENGTH_LIMIT_NOTICE)).toBeOnTheScreen();
    expect(screen.queryByText(long)).toBeNull();
  });
});

describe('🔴 TRIP-1016 AC-1 · 1:1·4:5 프레임은 폭이 크기를 정한다(높이 530 고정 금지)', () => {
  it.each([
    ['reflection-share-format-square', 1],
    ['reflection-share-format-feed', 4 / 5],
  ])(
    '%s 선택 → 높이 지정 없음 + 폭은 부모 기준(고정 숫자 폭 없음) + 폭의 출처가 있다',
    (formatTestId, ratio) => {
      renderScreen();

      fireEvent.press(screen.getByTestId(formatTestId));
      const layout = frameLayout();

      // 앵커 — 비율은 그대로 style 에 있다(AC-3 계약 유지).
      expect(layout.aspectRatio).toBeCloseTo(ratio, 5);

      // 높이는 aspectRatio 가 폭에서 뽑는다 — 어떤 높이 지정도 없다.
      expect(layout.height).toBeUndefined();

      // 폭은 부모 기준 — 고정 숫자 폭(예 530)은 좁은 기기에서 화면을 넘는다(QA #087).
      expect([undefined, '100%']).toContain(layout.width);

      // 폭 출처 — style 폭·alignSelf stretch·className w-full/self-stretch 중 하나(없으면 실기에서 0폭).
      const hasWidthSource =
        layout.width !== undefined ||
        layout.alignSelf === 'stretch' ||
        /(^|\s)(w-full|self-stretch)(\s|$)/.test(layout.className);
      expect(hasWidthSource).toBe(true);
    }
  );
});

describe('🔴 TRIP-1016 AC-2 · 9:16 프레임은 높이 530 상한(무회귀 ≈298×530)', () => {
  it('story(기본) → 숫자 높이 530 + aspectRatio 만 있고 폭 지정은 없다(폭까지 주면 비율이 무력화된다)', () => {
    renderScreen();

    const layout = frameLayout();

    expect(layout.aspectRatio).toBeCloseTo(9 / 16, 5);
    expect(typeof layout.height).toBe('number');
    expect(layout.height as number).toBeLessThanOrEqual(530);
    expect(layout.height as number).toBeCloseTo(530, 0);
    // 폭·높이가 둘 다 정해지면 Yoga 는 aspectRatio 를 안 쓴다 — 폭은 비율이 높이에서 뽑게 비워 둔다.
    expect(layout.width).toBeUndefined();
    expect(layout.alignSelf).not.toBe('stretch');
    expect(layout.className).not.toMatch(/(^|\s)(w-full|self-stretch)(\s|$)/);
  });

  it('story→square→story 로 돌아오면 다시 높이 530 상한 모양이다(포맷 전환이 상한을 잃지 않는다)', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('reflection-share-format-square'));
    fireEvent.press(screen.getByTestId('reflection-share-format-story'));
    const layout = frameLayout();

    expect(layout.aspectRatio).toBeCloseTo(9 / 16, 5);
    expect(layout.height as number).toBeCloseTo(530, 0);
    expect(layout.width).toBeUndefined();
  });
});

describe('🔴 TRIP-1016 AC-5 · 방문 순서 박스(reflection-share-visit-order)는 방문이 있을 때만(D10 · Q2)', () => {
  it('no-photo + 방문 0곳 → 박스가 없고, 카드 프레임·제목은 남는다', () => {
    const props = renderScreen({
      card: baseCard({ mode: 'no-photo', orderedVisits: [] }),
    });

    expect(screen.queryByTestId('reflection-share-visit-order')).toBeNull();
    expect(greyBoxHostsInFrame()).toBe(0);
    // 짝 앵커 — 카드 자체와 하단 텍스트는 그대로(Q4: 박스만 빠진다).
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
    expect(screen.getByText(props.card.title)).toBeOnTheScreen();
  });

  it('no-photo + 방문 2곳 → 박스가 있고 그 안에 방문 행이 그려진다(짝)', () => {
    renderScreen({ card: baseCard({ mode: 'no-photo' }) });

    const box = screen.getByTestId('reflection-share-visit-order');
    expect(within(box).getByText('광안리 해변')).toBeOnTheScreen();
    expect(within(box).getByText('감천문화마을')).toBeOnTheScreen();
    // 짝 — testID 는 회색 박스 그 자체에 달려 있고, 프레임 안 회색 박스는 이것 하나다.
    expect(String(box.props.className)).toMatch(/(^|\s)bg-surface-soft(\s|$)/);
    expect(greyBoxHostsInFrame()).toBe(1);
  });

  it('default + 방문 0곳 → 박스가 없다(판정 기준은 mode 가 아니라 orderedVisits)', () => {
    renderScreen({ card: baseCard({ mode: 'default', orderedVisits: [] }) });

    expect(screen.queryByTestId('reflection-share-visit-order')).toBeNull();
    expect(greyBoxHostsInFrame()).toBe(0);
    expect(
      screen.getByTestId('reflection-share-preview-frame')
    ).toBeOnTheScreen();
  });

  it('default + 방문 2곳 → 박스가 있다(짝)', () => {
    renderScreen({ card: baseCard({ mode: 'default' }) });

    const box = screen.getByTestId('reflection-share-visit-order');
    expect(within(box).getByText('광안리 해변')).toBeOnTheScreen();
    expect(greyBoxHostsInFrame()).toBe(1);
  });
});
