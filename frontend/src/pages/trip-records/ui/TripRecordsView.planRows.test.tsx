import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  VisitRecordCard,
  type VisitRecordCardVM,
} from '@/features/record/ui/VisitRecordCard';
import type { MapCenter } from '@/shared/map';
import { renderedText } from '@/test-support/sheetTree';

import { TripRecordsView, type TripRecordsViewProps } from './TripRecordsView';

// 셸이 네이버 네이티브 MapView 를 태우므로 관찰 목으로 갈아끼운다(형제 TripRecordsView.test 선례).
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

type RecordPlanRowVM = NonNullable<TripRecordsViewProps['planRows']>[number];

/**
 * TRIP-1021 #086 · AC-10~14 (화면 쪽) — j01 방문 기록이 0건이면 빈 상태 안내 + 그날 계획 행.
 * (TRIP-1085 — 옛 `features/record/ui/TripRecordsScreen.planRows.test.tsx` 를 옮겨 새 순수 뷰
 *  `TripRecordsView`(셸 시트 본문)로 렌더한다. P1~P9 단언은 그대로, P7 의 글자 수집만 바꿨다.)
 *
 * 무엇을 보장하나:
 *  - 방문 카드가 0장이면 `record-trip-empty` 안내가 한 번 뜨고, 1장 이상이면 없다.
 *  - 페이지가 내린 `planRows`(레코드 없는 계획 슬롯)는 행마다 `record-trip-plan-row-{slotKey}` 로 선다.
 *    방문이 있어도 레코드 없는 슬롯은 행으로 남는다(Q4 — 둘째 곳도 j01 에서 체크할 수 있게).
 *  - 페이지가 `onPressPlanCheck` 를 내리면(오늘 탭) 모드와 무관하게 행에 "방문 체크"가 붙고, 누르면 그 행을
 *    페이지로 올린다(TRIP-1069 결정 1(c) — 옛 "수동 모드일 때만"을 뒤집음).
 *  - 계획 행은 `VisitRecordCard` 가 아니다 — 그 카드는 레코드 id 로 [건너뜀]을 쏘는데 계획 행엔 id 가
 *    없어, 합성 id 로 재사용하면 404 요청이 나간다(브리프 맹점 ④).
 *  - 빈 상태 안내는 부제(법 근거 문구 "(좌표 자동기록 비활성)")를 덮어쓰지 않는 별도 요소다(AC-13).
 *  - 어디에도 개별 체류 시간이 없다(AC-12 · INV-3).
 *  - (5-c 경고5) 기록이 로딩 중이면 빈 상태 안내를 안 띄우고, 조회가 실패하면 빈 상태 대신 오류 표면
 *    (`record-trip-error` + `record-trip-error-retry`)을 띄운다. 미주입(`recordsStatus` 없음)은 'ready' 로
 *    읽어 기존 호출자·프리뷰가 그대로다.
 *
 * "레코드 없는 슬롯만 행으로" 조인은 페이지 몫이라 여기선 `planRows` 를 직접 준다(02a ★13) — 그
 * 조인은 `TripRecordsPage.planRows.integration.test.tsx` 가 본다.
 *
 * 3동작: 준비(카드·계획 행·모드) → 실행(렌더·press) → 단언(testID 존재/부재·글자·콜백).
 */

const DAY = '2026-08-20';
const CENTER: MapCenter = { lat: 35.1532, lng: 129.1187 };
const EMPTY_COPY = '아직 방문 기록이 없어요';
// 법 근거 문구(INV-U5-04·BR-U5-12) — 글자 하나하나가 계약이다.
const MANUAL_NOTICE =
  '수동 체크인 · 방문한 곳을 직접 선택해 기록하세요 (좌표 자동기록 비활성)';

const ROW_P3: RecordPlanRowVM = {
  slotKey: `${DAY}#p3`,
  poiId: 'p3',
  nameKo: '○○ 카페',
};
const ROW_P4: RecordPlanRowVM = {
  slotKey: `${DAY}#p4`,
  poiId: 'p4',
  nameKo: '△△ 미술관',
};

const DONE_CARD: VisitRecordCardVM = {
  visitCheckId: 'v-a',
  slotKey: `${DAY}#p1`,
  poiId: 'p1',
  nameKo: '광안리 해변',
  arrivedAt: `${DAY}T14:20:00`,
  completedAt: `${DAY}T15:20:00`,
  skippedAt: null,
  arrivedLabel: '14:20',
};

const rowId = (row: RecordPlanRowVM) => `record-trip-plan-row-${row.slotKey}`;
const checkId = (row: RecordPlanRowVM) =>
  `record-trip-plan-check-${row.slotKey}`;

function renderScreen(overrides: Partial<TripRecordsViewProps> = {}) {
  const handlers = {
    onSelectDay: jest.fn(),
    onPressComplete: jest.fn(),
    onPressSkip: jest.fn(),
    onPressManualCheck: jest.fn(),
    onPressPlanCheck: jest.fn(),
  };
  render(
    <TripRecordsView
      dayTabs={[{ day: DAY, label: '1일차' }]}
      activeDay={DAY}
      mapCenter={CENTER}
      mapPins={[]}
      cards={[]}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe('TripRecordsView · 빈 상태 + 계획 행 (TRIP-1021 AC-10·AC-14)', () => {
  it('P1 방문 0건 + 계획 2곳 → 빈 상태 안내 1개와 계획 행 2개(각자 장소 이름)가 선다 (AC-10)', () => {
    renderScreen({ planRows: [ROW_P3, ROW_P4] });

    expect(screen.getAllByTestId('record-trip-empty')).toHaveLength(1);
    expect(screen.getByTestId('record-trip-empty')).toHaveTextContent(
      EMPTY_COPY
    );
    expect(
      within(screen.getByTestId(rowId(ROW_P3))).getByText('○○ 카페')
    ).toBeOnTheScreen();
    expect(
      within(screen.getByTestId(rowId(ROW_P4))).getByText('△△ 미술관')
    ).toBeOnTheScreen();
  });

  it('P2 방문이 1건 이상이면 빈 상태 안내는 없고, 레코드 없는 계획 행은 남는다 (AC-14 · Q4)', () => {
    renderScreen({ cards: [DONE_CARD], planRows: [ROW_P3] });

    // 짝 앵커 — 방문 카드와 계획 행이 실제로 있다.
    expect(screen.getByTestId('record-trip-visit-card-v-a')).toBeOnTheScreen();
    expect(screen.getByTestId(rowId(ROW_P3))).toBeOnTheScreen();
    expect(screen.queryByTestId('record-trip-empty')).toBeNull();
  });
});

describe('TripRecordsView · 계획 행 "방문 체크" (TRIP-1021 AC-11)', () => {
  it('P3 수동 체크인 모드 → 행의 "방문 체크"를 누르면 그 행이 1회 올라가고, 완료·건너뜀은 안 불린다', () => {
    const handlers = renderScreen({
      manualCheckin: true,
      planRows: [ROW_P3, ROW_P4],
    });

    const check = screen.getByTestId(checkId(ROW_P4));
    expect(check).toHaveTextContent('방문 체크');

    fireEvent.press(check);

    expect(handlers.onPressPlanCheck).toHaveBeenCalledTimes(1);
    expect(handlers.onPressPlanCheck).toHaveBeenCalledWith(
      expect.objectContaining({ slotKey: `${DAY}#p4`, poiId: 'p4' })
    );
    expect(handlers.onPressComplete).not.toHaveBeenCalled();
    expect(handlers.onPressSkip).not.toHaveBeenCalled();
  });

  // TRIP-1069 결정 1(c)·D8 — 옛 P4("수동 모드가 아니면 없다")를 뒤집었다. 위치 권한이 있어도 자동 도착이
  // 안 잡힐 수 있으니 오늘 탭 계획 행에선 손으로 체크할 수 있어야 한다. 켜고 끄는 기준은 이제 모드가 아니라
  // 페이지가 `onPressPlanCheck` 를 내렸는지(= 오늘 탭인지) 하나다.
  it('P4 수동 체크인 모드가 아니어도 onPressPlanCheck 가 있으면 행마다 "방문 체크"가 서고, 누르면 그 행이 올라간다', () => {
    const handlers = renderScreen({
      manualCheckin: false,
      planRows: [ROW_P3, ROW_P4],
    });

    expect(screen.getByTestId(checkId(ROW_P3))).toBeOnTheScreen();
    const check = screen.getByTestId(checkId(ROW_P4));
    expect(check.props.accessibilityRole).toBe('button');

    fireEvent.press(check);

    expect(handlers.onPressPlanCheck).toHaveBeenCalledTimes(1);
    expect(handlers.onPressPlanCheck).toHaveBeenCalledWith(
      expect.objectContaining({ slotKey: `${DAY}#p4`, poiId: 'p4' })
    );
  });

  it('P4b onPressPlanCheck 를 안 내리면(지난·미래 날) 수동 모드여도 "방문 체크"가 없다', () => {
    renderScreen({
      manualCheckin: true,
      planRows: [ROW_P3, ROW_P4],
      onPressPlanCheck: undefined,
    });

    // 짝 앵커 — 행 2개는 있다.
    expect(screen.getByTestId(rowId(ROW_P3))).toBeOnTheScreen();
    expect(screen.getByTestId(rowId(ROW_P4))).toBeOnTheScreen();
    expect(screen.queryAllByTestId(/^record-trip-plan-check-/)).toHaveLength(0);
  });
});

describe('TripRecordsView · 계획 행은 방문 카드가 아니다 (TRIP-1021 맹점 ④)', () => {
  it('P5 계획 행만 있을 때 VisitRecordCard·[건너뜀]·방문 카드 testID 가 하나도 없다', () => {
    renderScreen({ manualCheckin: true, planRows: [ROW_P3, ROW_P4] });

    // 짝 앵커 — 행 2개는 있다(부재가 빈 렌더에서 공허하게 통과하지 않게).
    expect(screen.getByTestId(rowId(ROW_P3))).toBeOnTheScreen();
    expect(screen.getByTestId(rowId(ROW_P4))).toBeOnTheScreen();
    expect(screen.UNSAFE_queryAllByType(VisitRecordCard)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^record-visit-skip-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^record-trip-visit-card-/)).toHaveLength(0);
  });
});

describe('TripRecordsView · 부제와 빈 상태는 따로다 (TRIP-1021 AC-13)', () => {
  it('P6 수동 모드 + 방문 0건 → 법 근거 부제와 빈 상태 안내가 둘 다 있고, 안내는 부제를 담지 않는다', () => {
    renderScreen({
      manualCheckin: true,
      noticeCopy: MANUAL_NOTICE,
      planRows: [ROW_P3],
    });

    expect(screen.getByText(MANUAL_NOTICE)).toBeOnTheScreen();
    const empty = screen.getByTestId('record-trip-empty');
    expect(within(empty).queryByText(/좌표 자동기록 비활성/)).toBeNull();
  });
});

describe('TripRecordsView · 기록 조회 로딩·실패 (TRIP-1021 5-c 경고5)', () => {
  it('P8 기록이 아직 로딩 중이면 빈 상태 안내도 오류 표면도 없다', () => {
    renderScreen({ recordsStatus: 'loading' });

    // 짝 앵커 — 화면은 그려졌다(부제 기본 문구).
    expect(
      screen.getByText('오늘의 동선 · 방문한 곳을 사진과 메모로 남겨요')
    ).toBeOnTheScreen();
    expect(screen.queryByTestId('record-trip-empty')).toBeNull();
    expect(screen.queryByTestId('record-trip-error')).toBeNull();
  });

  it('P9 기록 조회가 실패하면 "아직 방문 기록이 없어요" 대신 오류 표면이 서고, [다시 시도]가 페이지로 올라간다', () => {
    const onPressRetryRecords = jest.fn();
    renderScreen({ recordsStatus: 'error', onPressRetryRecords });

    expect(screen.getByTestId('record-trip-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('record-trip-empty')).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();

    fireEvent.press(screen.getByTestId('record-trip-error-retry'));
    expect(onPressRetryRecords).toHaveBeenCalledTimes(1);
  });
});

describe('TripRecordsView · INV-3 (TRIP-1021 AC-12)', () => {
  it('P7 계획 행·방문 카드 어디에도 체류·소요 시간 문자열이 없다', () => {
    renderScreen({
      manualCheckin: true,
      cards: [DONE_CARD],
      planRows: [ROW_P3, ROW_P4],
    });

    // TRIP-1085 — 셸 list 경로에선 `JSON.stringify(screen.toJSON())` 가 순환 참조로 죽는다(FlatList 가
    // 헤더·푸터 엘리먼트를 호스트 props 로 흘린다). 화면의 Text 글자만 모아 본다.
    const text = renderedText(screen.UNSAFE_root);
    // 짝 — 렌더가 비지 않았다(행·카드 이름이 있다).
    expect(text).toContain('○○ 카페');
    expect(text).toContain('광안리 해변');
    expect(/(\d+\s*분|\d+\s*시간|소요|체류)/.test(text)).toBe(false);
  });
});
