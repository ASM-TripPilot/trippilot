import type { ReactElement } from 'react';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import {
  DailyReflectionScreen,
  type DailyReflectionScreenProps,
  type ReflectionFace,
} from './DailyReflectionScreen';
import { ReflectionStatsRow } from './ReflectionStatsRow';

// 지도 가지(좌표 있음)를 잠그려면 실제 MapView(네이버 네이티브)가 jest 에서 SDK 를 못 올리므로
// 관찰 목(`map-root` testID + props 통과)으로 갈아끼운다(선례 TripRecordsScreen.test.tsx). 배럴 경유.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@/shared/map', () => require('@/test-support/mapViewMock'));

type ReflectionDayTab = { day: number; today?: boolean };
type ExtendedProps = DailyReflectionScreenProps & {
  dayTabs?: ReflectionDayTab[];
  activeDay?: number;
  onSelectDay?: (day: number) => void;
  onPressTab?: (key: string) => void;
};

/**
 * TRIP-571 · AC-5(BR-U5-36)·AC-6(§7 폼검증) — j03 회고 화면(순수 프레젠테이션, VM 주입).
 * 조회·표시본 조립은 페이지 몫이라 여기선 완성 VM 을 props 로 넣고 렌더·편집 계약만 잠근다.
 *
 * 무엇을 보장하나(승인 계약):
 *  - 🔴 AC-3·AC-4(TRIP-763): empty·error 에도 **헤더 편집**(reflection-daily-edit)이 뜨고, 하단 CTA 는
 *    **분리된 새 testID `reflection-daily-compose`**("직접 회고 작성")다 — 둘이 같은 화면에 공존하되
 *    `reflection-daily-edit` 는 정확히 1개(헤더). 헤더·CTA press 각각 편집 진입 콜백 1회.
 *  - 🔴 AC-6(TRIP-571): 회고 수정 입력 상한 = **4000**(2000 아님, 서버 권위) · **빈/공백 문자열 → 저장
 *    비활성 + 저장 콜백 0회**(초안 보존 — 덮어쓰기 불가).
 *  - 렌더 스모크(긍정 앵커): default 얼굴이 표시본·통계·사진 그리드를 실제로 그린다(빈 화면 아님).
 *
 * 왜 이렇게 테스트하나(02a ★A·★C):
 *  - ★testID 충돌은 "한 세트"(TRIP-763) — 헤더 편집을 empty/error 에 켜는 순간 하단 CTA 의 옛
 *    `reflection-daily-edit` 와 겹쳐 `getByTestId` 가 throw 한다. 하단 CTA testID 분리(`-compose`)를
 *    안 하면 다른 테스트가 실행조차 못 한다. `getAllByTestId(...).toHaveLength(1)` 이 그 충돌을 심판.
 *  - 4000 = `EditReflectionRequest.maxLength`(서버 권위) — 티켓 "2000"은 visit_memo 오전이(맹점⑤).
 *  - 빈 문자열은 `toBeDisabled()` + 콜백 0회 짝으로 잠근다(`fireEvent.press`는 disabled 를 안 막으므로).
 *  - 화면은 `source` 로 UI 를 분기하지 않는다(VM 에 source 자리 없음 — 구조적 차단, 맹점②).
 *
 * (개념) `getByText('문자열')`=leaf 완전일치 · `getByTestId(id).props.maxLength`=RN TextInput 실 prop 판독 ·
 *   `toBeDisabled()`=실제 disabled 판독(단순 flag 아님) — 02a §5 실검증(MyStaysScreen 선례 인용).
 *
 * INV-3: 이 파일 fixture 에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(소스 스캔 오탐 방지, ★10).
 */

const NARRATIVE = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

function baseProps(
  over: Partial<DailyReflectionScreenProps> = {}
): DailyReflectionScreenProps {
  const onEnterEdit = jest.fn();
  const onConfirm = jest.fn();
  const onSaveEdit = jest.fn();
  return {
    face: 'default',
    narrative: NARRATIVE,
    editableText: NARRATIVE,
    stats: {
      visitCount: 4,
      distanceKm: 12,
      distanceSource: 'VISIT_LINE',
      photoCount: 6,
    },
    distanceDash: false,
    mapNotice: null,
    hidePhotoGrid: false,
    photos: [{ uri: 'file://p1.jpg' }, { uri: 'file://p2.jpg' }],
    changeSummary: null,
    onEnterEdit,
    onConfirm,
    onSaveEdit,
    ...over,
  };
}

function renderScreen(over: Partial<DailyReflectionScreenProps> = {}) {
  const props = baseProps(over);
  render(<DailyReflectionScreen {...props} />);
  return props;
}

describe('렌더 스모크 · default 얼굴이 빈 화면이 아니다(긍정 앵커)', () => {
  it('표시본·통계·사진 그리드를 그린다', () => {
    renderScreen({ face: 'default' });

    expect(screen.getByText(NARRATIVE)).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-stats')).toBeOnTheScreen();
    expect(screen.getByTestId('reflection-daily-photo-grid')).toBeOnTheScreen();
  });
});

describe('🔴 AC-3·AC-4 · 헤더 편집 전(全)얼굴 + testID 충돌 해소(TRIP-763)', () => {
  // 헤더 편집이 켜지는 얼굴만 재현(empty·error). data 얼굴은 이미 헤더 편집이 있었다(무회귀는 아래 짝).
  function faceProps(face: 'empty' | 'error') {
    return {
      face,
      narrative:
        face === 'empty'
          ? '오늘 기록된 활동이 없습니다.'
          : '회고를 불러오지 못했어요.',
      editableText: '',
      photos: [],
      hidePhotoGrid: true,
    } as const;
  }

  it.each(['empty', 'error'] as const)(
    '%s: 헤더 편집(reflection-daily-edit)은 정확히 1개이고 하단 CTA 는 reflection-daily-compose 다',
    (face) => {
      renderScreen(faceProps(face));

      // (개념) getAllByTestId(id).toHaveLength(1) = 그 이름표 요소가 화면에 정확히 하나.
      // 하단 CTA 가 헤더와 같은 이름표를 쓰면 2개가 돼 getByTestId 가 throw — 그 충돌을 여기서 막는다.
      expect(screen.getAllByTestId('reflection-daily-edit')).toHaveLength(1);
      // 하단 "직접 회고 작성" CTA 는 분리된 새 이름표(현재 미존재 → red).
      expect(screen.getByTestId('reflection-daily-compose')).toBeOnTheScreen();
    }
  );

  it.each(['empty', 'error'] as const)(
    '%s: 헤더 편집 press → onEnterEdit 를 1회 부른다(AC-3)',
    (face) => {
      const { onEnterEdit } = renderScreen(faceProps(face));

      fireEvent.press(screen.getByTestId('reflection-daily-edit'));

      expect(onEnterEdit).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['empty', 'error'] as const)(
    '%s: 하단 CTA(reflection-daily-compose) press → onEnterEdit 를 1회 부른다(AC-4)',
    (face) => {
      const { onEnterEdit } = renderScreen(faceProps(face));

      fireEvent.press(screen.getByTestId('reflection-daily-compose'));

      expect(onEnterEdit).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['default', 'data-insufficient'] as const)(
    '%s: 헤더 편집은 여전히 정확히 1개다(무회귀 — 이 얼굴은 원래 헤더 편집이 있었다)',
    (face) => {
      renderScreen({ face });

      expect(screen.getAllByTestId('reflection-daily-edit')).toHaveLength(1);
    }
  );
});

describe('🔴 AC-6 · 회고 수정 폼검증(§7 · 상한 4000)', () => {
  it('편집을 열면 입력 상한이 4000 이다(2000 아님 — 서버 권위)', () => {
    renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));

    const input = screen.getByTestId('reflection-daily-edit-input');
    expect(input.props.maxLength).toBe(4000);
  });

  it('빈 문자열이면 저장 버튼이 비활성이고 press 해도 저장 콜백이 0회다(초안 보존)', () => {
    const { onSaveEdit } = renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(screen.getByTestId('reflection-daily-edit-input'), '');

    const save = screen.getByTestId('reflection-daily-edit-save');
    expect(save).toBeDisabled();

    fireEvent.press(save);
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it('공백만 입력도 비활성 + 저장 0회다(trim)', () => {
    const { onSaveEdit } = renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      '   '
    );

    expect(screen.getByTestId('reflection-daily-edit-save')).toBeDisabled();
    fireEvent.press(screen.getByTestId('reflection-daily-edit-save'));
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it('내용이 있으면 저장이 활성이고 press 시 그 텍스트로 1회 저장한다(짝)', () => {
    const { onSaveEdit } = renderScreen({ face: 'default' });

    fireEvent.press(screen.getByTestId('reflection-daily-edit'));
    fireEvent.changeText(
      screen.getByTestId('reflection-daily-edit-input'),
      '오늘은 정말 좋은 하루였어요.'
    );

    const save = screen.getByTestId('reflection-daily-edit-save');
    expect(save).not.toBeDisabled();

    fireEvent.press(save);
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).toHaveBeenCalledWith('오늘은 정말 좋은 하루였어요.');
  });
});

describe('default 얼굴 재구성 — 표면·일차 탭·통계·지도·서술·하단 버튼', () => {
  // TRIP-762 (옛 DailyReflectionScreen.default.test.tsx)
  /**
   * TRIP-762 · j03 오늘의 회고 **default 얼굴 재구성**(순수 프레젠테이션, VM 주입).
   *
   * 이 파일은 TRIP-571 `DailyReflectionScreen.test.tsx`(★동결 — 편집 모드 무회귀)를 **건드리지
   * 않는** 별 파일이다. 저 파일이 지키는 편집 능력(maxLength 4000·빈저장 차단)은 유지되고, 여기선
   * default 얼굴의 새 표면(일차 탭·기분 3택·통계 재구성·풀폭 지도 가지·서술 카드·메모 입력·저장 CTA·
   * 탭바)만 잠근다.
   *
   * ★ 신규 prop 은 전부 **옵셔널**이다 — 동결 파일·프리뷰의 기존 props 객체가 그대로 컴파일돼야
   *   하므로(신규 required 를 더하면 그 객체들이 tsc 로 깨진다). 구현 전이라 화면을 **확장 prop
   *   타입으로 재대입**해 테스트만 컴파일한다(선례 TripRecordsScreen.test 의 `ScreenWithAttr`).
   *   구현자가 이 계약(dayTabs·activeDay·onSelectDay·onPressTab)을 실제 prop·렌더로 채운다.
   *
   * 무엇을 보장하나(승인 계약):
   *  - 🔴 AC-1: default 얼굴이 새 표면 요소를 **전부** 그린다(빈 화면·부분 재구성 아님).
   *  - 🔴 AC-2: 일차 탭 3개(testID 신설 `reflection-daily-day-tab-{day}`) — press→onSelectDay 1회,
   *    활성만 selected(코랄 pill 은 fill 아니라 `accessibilityState.selected` 로 잠금), 라벨 한글 N일차.
   *  - 🔴 AC-3(TRIP-935 로 뒤집힘 → 숨김): 기분 3택 단일선택 — 초기 무선택 → press 한 항목만 selected(fill 아닌 selected 로 잠금),
   *    다른 항목 press 시 이전 선택 해제(단일). 저장 콜백 없음(mood prop·콜백 부재로 구조적 차단).
   *  - 🔴 AC-4(거동): distanceDash 면 이동값 "—"(거리만, INV-3 — 소요시간 문자열 0). 값 22·구분선 제거를
   *    맡던 소스 가드(`reflectionDailyStructure`)는 TRIP-1145 로 지웠다.
   *  - 🔴 AC-5(TRIP-935 로 좌표 없음 가지 뒤집힘 → 박스 없음): 좌표 없으면 `reflection-daily-map-notice`(실화면 늘 이 가지, 가짜 기본센터 금지) ·
   *    좌표 있으면 MapView(`map-root`) viewOnly(둘은 상호배타).
   *  - 🔴 AC-7: 서술 **카드**(헤드 "오늘의 기록" + "수정" 링크 + 본문) · "수정" press → 편집 진입
   *    (동결 편집 모드 재사용, 죽은 링크 아님).
   *  - 🔴 AC-8(TRIP-935 로 뒤집힘 → 메모 숨김): 메모 **입력** 행이 시스템 변경요약을 **대체**(changeSummary 를 줘도 변경요약 행 부재 +
   *    메모 입력 present) · maxLength 60 · 카운터 "N/60".
   *  - 🔴 AC-9(TRIP-935 로 뒤집힘 → `-confirm`·"확인"): 저장 CTA testID `-confirm`→`-save` 개명 + 라벨 "저장" + press→콜백 1회(콜백명 onConfirm 유지).
   *  - 🔴 AC-10: 하단 탭바(shared/ui BottomTabBar 재사용) records 활성 + press→onPressTab 1회.
   *  - 🔴 AC-12: 헤더 "편집"(reflection-daily-edit) 유지(공유와 다름) — press→편집 진입.
   *
   * (개념) `accessibilityState.selected` = 선택 상태를 색이 아니라 접근성 플래그로 노출(jest 가 읽는
   *   구조 채널, BottomTabBar·share.test 선례) · `within(node)` = 그 노드 하위로 쿼리 범위 한정 ·
   *   `getByText(정규식)` = 노드 텍스트 부분매칭(구분자 문자 흔들림 회피) · `.props.maxLength` = RN
   *   TextInput 실 prop 판독 · `queryByTestId` = 부재 확인(getBy 는 못 찾으면 throw).
   *
   * INV-3: 이 파일 픽스처에 "N분"·"N시간"·"소요" 문자열을 두지 않는다(G6 소스 스캔 오탐 방지).
   *
   * TRIP-935 AC-6(R7) — 심사 2.1 대응으로 default 얼굴의 비영속·빈 표면을 숨긴다. 아래 AC-1·3·5·8·9 는
   * 지우지 않고 새 계약으로 뒤집었다: 기분 3택·메모 입력 숨김(저장되지 않는 입력), 좌표 없으면 지도
   * 자리 자체를 안 그림(회고 계약에 좌표가 없어 늘 빈 박스였다), 하단 버튼은 "저장" 대신 "확인"
   * (`reflection-daily-confirm` — data-insufficient 와 같은 이름표, 02a ★16). data-insufficient 의
   * 누락 표기(mapNotice)는 US-REC-06 이 요구하므로 유지된다(faces.test AC-2).
   */

  const Screen = DailyReflectionScreen as unknown as (
    props: ExtendedProps
  ) => ReactElement;

  const NARRATIVE =
    '오늘은 광안리와 미술관 등 4곳을 방문했어요. 12km를 이동했고 사진 6장을 남겼어요.';

  function baseProps(over: Partial<ExtendedProps> = {}): ExtendedProps {
    return {
      face: 'default',
      narrative: NARRATIVE,
      editableText: NARRATIVE,
      stats: {
        visitCount: 4,
        distanceKm: 12,
        distanceSource: 'VISIT_LINE',
        photoCount: 6,
      },
      distanceDash: false,
      mapNotice: null,
      hidePhotoGrid: false,
      photos: [{ uri: 'file://p1.jpg' }, { uri: 'file://p2.jpg' }],
      changeSummary: null,
      dayTabs: [{ day: 1 }, { day: 2, today: true }, { day: 3 }],
      activeDay: 2,
      onSelectDay: jest.fn(),
      onPressTab: jest.fn(),
      onEnterEdit: jest.fn(),
      onConfirm: jest.fn(),
      onSaveEdit: jest.fn(),
      ...over,
    };
  }

  function renderScreen(over: Partial<ExtendedProps> = {}) {
    const props = baseProps(over);
    render(<Screen {...props} />);
    return props;
  }

  describe('🔴 AC-1 · default 얼굴이 남는 표면 요소를 전부 그린다(긍정 앵커 · TRIP-935 갱신)', () => {
    it('일차 탭·통계·서술·사진·확인·탭바가 모두 실재한다(기분·메모는 TRIP-935 로 숨김 — AC-3·8)', () => {
      renderScreen();

      // 일차 탭 3개
      expect(
        screen.getByTestId('reflection-daily-day-tab-1')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-2')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-day-tab-3')
      ).toBeOnTheScreen();
      // 통계·서술·사진(보존 testID) · 확인(TRIP-935 — 구 저장)
      expect(screen.getByTestId('reflection-daily-stats')).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('reflection-daily-photo-grid')
      ).toBeOnTheScreen();
      expect(screen.getByTestId('reflection-daily-confirm')).toBeOnTheScreen();
      // 탭바
      expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-2 · 일차 탭(record 것 import 금지 — testID 신설)', () => {
    it('탭 라벨은 한글 N일차이고 오늘 탭은 "오늘" 접두가 붙는다(formatDayLabel 재사용)', () => {
      renderScreen();

      // 비오늘 탭 — formatDayLabel(day) 완전일치 leaf.
      expect(
        within(screen.getByTestId('reflection-daily-day-tab-1')).getByText(
          '1일차'
        )
      ).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('reflection-daily-day-tab-3')).getByText(
          '3일차'
        )
      ).toBeOnTheScreen();
      // 오늘 탭 — "오늘" 접두 + 2일차(구분자 문자 흔들림을 피해 정규식 부분매칭).
      expect(
        within(screen.getByTestId('reflection-daily-day-tab-2')).getByText(
          /오늘.*2일차/
        )
      ).toBeOnTheScreen();
    });

    it('활성 탭(activeDay)만 selected 이다(코랄 pill — fill 아닌 구조로 잠금)', () => {
      renderScreen({ activeDay: 2 });

      expect(
        screen.getByTestId('reflection-daily-day-tab-2').props
          .accessibilityState?.selected
      ).toBe(true);
      expect(
        screen.getByTestId('reflection-daily-day-tab-1').props
          .accessibilityState?.selected
      ).toBe(false);
      expect(
        screen.getByTestId('reflection-daily-day-tab-3').props
          .accessibilityState?.selected
      ).toBe(false);
    });

    it('탭 press → onSelectDay 를 그 일차로 정확히 1회 부른다', () => {
      const { onSelectDay } = renderScreen();

      fireEvent.press(screen.getByTestId('reflection-daily-day-tab-1'));

      expect(onSelectDay).toHaveBeenCalledTimes(1);
      expect(onSelectDay).toHaveBeenCalledWith(1);
    });
  });

  describe('🔴 AC-3 · 기분 3택은 그리지 않는다(TRIP-935 — 저장되지 않는 입력 숨김)', () => {
    it('기분 3택 버튼과 "오늘 어땠어요?" 제목이 없다', () => {
      renderScreen();

      // 앵커 — default 얼굴 본문은 그려졌다.
      expect(screen.getByTestId('reflection-daily-stats')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-mood-sad')).toBeNull();
      expect(screen.queryByTestId('reflection-daily-mood-soso')).toBeNull();
      expect(screen.queryByTestId('reflection-daily-mood-good')).toBeNull();
      expect(screen.queryAllByText('오늘 어땠어요?')).toHaveLength(0);
    });
  });

  describe('🔴 AC-4(거동) · 통계는 거리만(INV-3)', () => {
    it('distanceDash 면 이동값이 "—" 이고 소요시간은 없다', () => {
      render(
        <ReflectionStatsRow
          stats={{
            visitCount: 1,
            distanceKm: 0,
            distanceSource: 'VISIT_LINE',
            photoCount: 3,
          }}
          distanceDash
        />
      );

      expect(screen.getByText('—')).toBeOnTheScreen();
      expect(screen.getByText('방문')).toBeOnTheScreen();
      expect(screen.getByText('이동')).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-5 · 지도 가지(가짜 기본센터 금지 · TRIP-935 빈 박스 숨김)', () => {
    it('좌표가 없으면 지도도 자리표시(점선 박스)도 그리지 않는다', () => {
      renderScreen();

      // 앵커 — default 얼굴 본문은 그려졌다.
      expect(screen.getByTestId('reflection-daily-stats')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-map-notice')).toBeNull();
      expect(screen.queryByTestId('map-root')).toBeNull();
      expect(
        screen.queryAllByText('위치 정보를 표시할 수 없어요')
      ).toHaveLength(0);
    });

    it('좌표가 있으면 MapView(viewOnly)가 뜨고 자리표시는 없다', () => {
      renderScreen({
        mapCenter: { lat: 35.1532, lng: 129.1187 },
        mapPins: [{ number: 1, lat: 35.1532, lng: 129.1187 }],
      });

      const map = screen.getByTestId('map-root');
      expect(map).toBeOnTheScreen();
      expect(map.props.viewOnly).toBe(true);
      expect(screen.queryByTestId('reflection-daily-map-notice')).toBeNull();
    });
  });

  describe('🔴 AC-6 · 사진 그리드 보존', () => {
    it('default 얼굴에서 reflection-daily-photo-grid 가 실재한다', () => {
      renderScreen();
      expect(
        screen.getByTestId('reflection-daily-photo-grid')
      ).toBeOnTheScreen();
    });
  });

  describe('🔴 AC-7 · 서술 카드(헤드 "오늘의 기록" + "수정" + 본문)', () => {
    it('카드 헤드·수정 링크·본문이 모두 뜨고 testID 는 보존된다', () => {
      renderScreen();

      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toBeOnTheScreen();
      expect(screen.getByText('오늘의 기록')).toBeOnTheScreen();
      expect(screen.getByText('수정')).toBeOnTheScreen();
      expect(screen.getByText(NARRATIVE)).toBeOnTheScreen();
    });

    it('"수정" press → 편집 진입(동결 편집 모드 재사용 — 죽은 링크 아님)', () => {
      renderScreen();

      fireEvent.press(screen.getByTestId('reflection-daily-narrative-edit'));

      // 편집 진입 = 상한 4000 입력이 열린다(동결 AC-6 능력 재사용).
      expect(
        screen.getByTestId('reflection-daily-edit-input').props.maxLength
      ).toBe(4000);
    });
  });

  describe('🔴 AC-8 · 메모 입력은 그리지 않는다(TRIP-935) — 변경요약 행도 default 에선 여전히 없다', () => {
    it('changeSummary 를 줘도 메모 입력·카운터·변경요약 행이 모두 없다', () => {
      renderScreen({ changeSummary: '이날 휴무로 1곳을 변경했어요' });

      // 앵커 — default 얼굴 본문은 그려졌다.
      expect(
        screen.getByTestId('reflection-daily-narrative')
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-memo-input')).toBeNull();
      expect(screen.queryAllByText(/\d+\/60/)).toHaveLength(0);
      expect(
        screen.queryByTestId('reflection-daily-change-summary')
      ).toBeNull();
    });
  });

  describe('🔴 AC-9 · 하단 버튼은 "확인"(TRIP-935 — 저장할 것이 없으니 "저장" 아님)', () => {
    it('확인 버튼(reflection-daily-confirm)이 있고 옛 -save 와 "저장" 글자는 없다', () => {
      renderScreen();

      const confirm = screen.getByTestId('reflection-daily-confirm');
      expect(within(confirm).getByText('확인')).toBeOnTheScreen();
      expect(screen.queryByTestId('reflection-daily-save')).toBeNull();
      // 편집 전(비편집) 화면에는 "저장" 글자가 없다 — 편집 모드의 저장은 동결 테스트가 지킨다(02a ★17).
      expect(screen.queryAllByText('저장')).toHaveLength(0);
    });

    it('확인 press → 콜백(onConfirm)을 정확히 1회 부른다', () => {
      const { onConfirm } = renderScreen();

      fireEvent.press(screen.getByTestId('reflection-daily-confirm'));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('🔴 AC-10 · 하단 탭바(BottomTabBar 재사용 · records 활성)', () => {
    it('탭바가 뜨고 기록 탭이 활성이다', () => {
      renderScreen();

      expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
      expect(
        screen.getByTestId('shell-tabbar-tab-records').props.accessibilityState
          ?.selected
      ).toBe(true);
    });

    it('다른 탭 press → onPressTab 을 그 키로 1회 부른다', () => {
      const { onPressTab } = renderScreen();

      fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));

      expect(onPressTab).toHaveBeenCalledTimes(1);
      expect(onPressTab).toHaveBeenCalledWith('home');
    });
  });

  describe('🔴 AC-12 · 헤더 "편집" 유지(공유와 다름)', () => {
    it('헤더 편집 진입점이 실재하고 press → 편집 진입한다', () => {
      renderScreen();

      fireEvent.press(screen.getByTestId('reflection-daily-edit'));

      expect(
        screen.getByTestId('reflection-daily-edit-input').props.maxLength
      ).toBe(4000);
    });
  });
});

describe('3얼굴(data-insufficient·empty·error) — 위치 박스·일차 탭·탭바·재시도', () => {
  // TRIP-763 (옛 DailyReflectionScreen.faces.test.tsx)
  /**
   * TRIP-763 · j03 오늘의 회고 **3얼굴 정합**(data-insufficient · empty · error) — 순수 프레젠테이션.
   *
   * 762가 default 얼굴만 재구성했다. 이 파일은 나머지 3얼굴을 Figma 3프레임(1566:1894·1567:1920·
   * 1568:1946)과 1:1 로 맞추는 **프레젠테이션 정합**만 잠근다(편집 4000·빈저장 같은 편집 계약은
   * 동결 `DailyReflectionScreen.test.tsx`, default 표면은 `.default.test.tsx` 소관 — 여긴 안 다룸).
   *
   * ★ mapNotice 2필드 계약(AC-1) — 구현 전이라 화면 prop 타입은 아직 `string | null` 이다. 테스트만
   *   새 계약으로 컴파일하려 `mapNotice` 를 `{title, body} | null` 로 재정의해 캐스팅한다(선례
   *   `.default.test.tsx` 의 ExtendedProps). 구현자가 화면 타입·렌더를 이 계약으로 채운다.
   *
   * 무엇을 보장하나(승인 계약):
   *  - 🔴 AC-2: data-insufficient 가 mapNotice.title 과 body 를 **각각 leaf 텍스트**로 그린다(2줄).
   *    null 폴백 시에도 크래시 없이 그린다.
   *  - 🔴 AC-5: 일차 탭이 **3얼굴 전부**에 뜬다(현 `face==='default'` 게이트 제거) — day-tab 3개 +
   *    활성만 selected + press→onSelectDay(day) 1회. day-tab testID 는 reflection 것만(record 것 금지=G2).
   *  - 🔴 AC-6: 바텀 탭바가 **3얼굴 전부**에 뜨고(records 활성) 하단 CTA 와 **공존**한다("택1"→"둘 다") +
   *    탭 press→onPressTab(key) 1회.
   *  - 🔴 AC-7: error 재시도(reflection-daily-retry) 보존 + press→onConfirm 1회(무회귀).
   *
   * (개념) `getByText('문자열')` = host Text 텍스트 완전 일치 → title·body 를 각각 완전 일치로 집으면
   *   impl 이 둘을 한 Text 에 개행으로 합칠 수 없다(2줄 강제) · `.props.accessibilityState?.selected` =
   *   선택을 색 아닌 접근성 플래그로 판독(jest 가 읽는 구조 채널) · `it.each([...])` = 같은 케이스를
   *   여러 입력(3얼굴)에 반복.
   *
   * 지도 목: data-insufficient/empty/error 는 mapCenter 를 안 줘 MapView 를 렌더하지 않는다(mapArea 는
   *   자리표시 박스). 그래서 `@/shared/map` 목이 필요 없다(동결 `DailyReflectionScreen.test.tsx` 가 목
   *   없이 도는 것과 동형 — 배럴 import 는 안전, 렌더만 위험).
   */

  // mapNotice 만 2필드로 재정의(나머지 props 는 그대로). 구현 전 화면 타입을 거스르지 않게 캐스팅.
  type MapNotice2 = { title: string; body: string } | null;

  type FacesProps = Omit<DailyReflectionScreenProps, 'mapNotice'> & {
    mapNotice: MapNotice2;
  };

  const Screen = DailyReflectionScreen as unknown as (
    props: FacesProps
  ) => ReactElement;

  type Face = 'data-insufficient' | 'empty' | 'error';

  const FACES: Face[] = ['data-insufficient', 'empty', 'error'];

  const DAY_TABS = [{ day: 1 }, { day: 2, today: true }, { day: 3 }];

  /** 얼굴별 하단 CTA 이름표 — data 얼굴="확인"(-confirm), empty/error="직접 회고 작성"(-compose). */
  const CTA_TESTID: Record<Face, string> = {
    'data-insufficient': 'reflection-daily-confirm',
    empty: 'reflection-daily-compose',
    error: 'reflection-daily-compose',
  };

  function baseProps(over: Partial<FacesProps> = {}): FacesProps {
    return {
      face: 'data-insufficient',
      narrative: '오늘의 기록',
      editableText: '',
      stats: {
        visitCount: 4,
        distanceKm: 12,
        distanceSource: 'VISIT_LINE',
        photoCount: 6,
      },
      distanceDash: false,
      mapNotice: null,
      hidePhotoGrid: true,
      photos: [],
      changeSummary: null,
      dayTabs: DAY_TABS,
      activeDay: 2,
      onSelectDay: jest.fn(),
      onPressTab: jest.fn(),
      onEnterEdit: jest.fn(),
      onConfirm: jest.fn(),
      onSaveEdit: jest.fn(),
      ...over,
    };
  }

  function renderFace(over: Partial<FacesProps> = {}) {
    const props = baseProps(over);
    render(<Screen {...props} />);
    return props;
  }

  describe('🔴 AC-2 · 위치 박스 2줄(mapNotice.title / .body 각각 leaf)', () => {
    it('data-insufficient 가 title 과 body 를 각각 leaf 텍스트로 그린다(2줄)', () => {
      renderFace({
        face: 'data-insufficient',
        mapNotice: {
          title: '위치 기록 없음',
          body: 'GPS 미동의로 지도를 만들 수 없어요',
        },
      });

      // 각각 완전 일치 leaf — 둘을 한 Text 에 합치면(한 노드의 텍스트가 둘을 잇는다) 이 단언이 red.
      expect(screen.getByText('위치 기록 없음')).toBeOnTheScreen();
      expect(
        screen.getByText('GPS 미동의로 지도를 만들 수 없어요')
      ).toBeOnTheScreen();
    });

    it('mapNotice 가 null 이어도 크래시 없이 그린다(폴백 · 무회귀 짝)', () => {
      expect(() =>
        renderFace({ face: 'data-insufficient', mapNotice: null })
      ).not.toThrow();
    });
  });

  describe('🔴 AC-5 · 일차 탭이 3얼굴에 뜬다(default 게이트 제거)', () => {
    it.each(FACES)(
      '%s: 일차 탭 3개가 뜨고 활성(activeDay)만 selected 다',
      (face) => {
        renderFace({ face, activeDay: 2 });

        expect(
          screen.getByTestId('reflection-daily-day-tab-1')
        ).toBeOnTheScreen();
        expect(
          screen.getByTestId('reflection-daily-day-tab-2')
        ).toBeOnTheScreen();
        expect(
          screen.getByTestId('reflection-daily-day-tab-3')
        ).toBeOnTheScreen();
        expect(
          screen.getByTestId('reflection-daily-day-tab-2').props
            .accessibilityState?.selected
        ).toBe(true);
        expect(
          screen.getByTestId('reflection-daily-day-tab-1').props
            .accessibilityState?.selected
        ).toBe(false);
      }
    );

    it.each(FACES)(
      '%s: 탭 press → onSelectDay 를 그 일차로 정확히 1회 부른다',
      (face) => {
        const { onSelectDay } = renderFace({ face });

        fireEvent.press(screen.getByTestId('reflection-daily-day-tab-1'));

        expect(onSelectDay).toHaveBeenCalledTimes(1);
        expect(onSelectDay).toHaveBeenCalledWith(1);
      }
    );
  });

  describe('🔴 AC-6 · 바텀 탭바가 3얼굴에 뜨고 하단 CTA 와 공존한다', () => {
    it.each(FACES)('%s: 탭바(기록 활성) + 하단 CTA 가 함께 뜬다', (face) => {
      renderFace({ face });

      expect(screen.getByTestId('shell-tabbar-root')).toBeOnTheScreen();
      expect(
        screen.getByTestId('shell-tabbar-tab-records').props.accessibilityState
          ?.selected
      ).toBe(true);
      // CTA 공존 — 탭바가 CTA 를 지우지 않는다(세로 순서는 6-b 육안).
      expect(screen.getByTestId(CTA_TESTID[face])).toBeOnTheScreen();
    });

    it.each(FACES)(
      '%s: 다른 탭 press → onPressTab 을 그 키로 1회 부른다',
      (face) => {
        const { onPressTab } = renderFace({ face });

        fireEvent.press(screen.getByTestId('shell-tabbar-tab-home'));

        expect(onPressTab).toHaveBeenCalledTimes(1);
        expect(onPressTab).toHaveBeenCalledWith('home');
      }
    );
  });

  describe('🔴 AC-7 · 에러 재시도 보존(무회귀)', () => {
    it('error 얼굴에 reflection-daily-retry 가 있고 press → onConfirm 을 1회 부른다', () => {
      const { onConfirm } = renderFace({ face: 'error' });

      fireEvent.press(screen.getByTestId('reflection-daily-retry'));

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});

describe('지도 자리 사유 leaf', () => {
  // TRIP-1118 (옛 DailyReflectionScreen.mapReason.test.tsx)
  /**
   * TRIP-1118 · j03 지도 자리 사유 leaf 계약(화면).
   *
   * 무엇을 보장하나:
   *  - data-insufficient 의 지도 자리 **본문 Text** 에 `reflection-daily-map-notice-reason-{reason}` 이 붙는다 —
   *    "어느 이유인가"와 "그 글자"를 같은 노드에서 본다. 제목은 따로 leaf 로 남는다(TRIP-763 2줄 계약).
   *  - 루트 `reflection-daily-map-notice` 는 그대로 하나이고, 사유 leaf 는 정확히 하나다.
   *
   * 문구는 여기서 가짜 값을 넘긴다 — 확정 카피는 모델 테스트(missingParts.test.ts) 한 곳에서만 잠근다.
   */

  type Reason = 'few-visits' | 'permission' | 'no-route';

  type MapNotice3 = { reason: Reason; title: string; body: string } | null;

  type Props = Omit<DailyReflectionScreenProps, 'mapNotice'> & {
    mapNotice: MapNotice3;
  };

  // mapNotice 에 reason 이 든 새 계약으로 부른다. 구현 전 화면 타입을 거스르지 않게 캐스팅(구현 후에도 호환).
  const Screen = DailyReflectionScreen as unknown as (
    props: Props
  ) => ReactElement;

  const REASON_LEAF = /^reflection-daily-map-notice-reason-/;

  function baseProps(over: Partial<Props> = {}): Props {
    return {
      face: 'data-insufficient',
      narrative: '오늘의 기록',
      editableText: '',
      stats: {
        visitCount: 2,
        distanceKm: 3,
        distanceSource: 'VISIT_LINE',
        photoCount: 0,
      },
      distanceDash: false,
      mapNotice: null,
      hidePhotoGrid: true,
      photos: [],
      changeSummary: null,
      onEnterEdit: jest.fn(),
      onConfirm: jest.fn(),
      onSaveEdit: jest.fn(),
      ...over,
    };
  }

  describe('🔴 TRIP-1118 AC-2~4 · 지도 자리 사유 leaf = 본문 Text', () => {
    it.each<Reason>(['few-visits', 'permission', 'no-route'])(
      '%s: 본문 leaf 에 사유 id 가 붙고 글자는 본문과 완전 일치, 제목은 별도 leaf, 사유 leaf 는 하나뿐',
      (reason) => {
        const title = `제목-${reason}`;
        const body = `본문-${reason}`;

        render(
          <Screen {...baseProps({ mapNotice: { reason, title, body } })} />
        );

        // 루트는 그대로 하나(exact 매칭이라 leaf id 와 겹치지 않는다).
        expect(
          screen.getByTestId('reflection-daily-map-notice')
        ).toBeOnTheScreen();
        // 완전 일치 — 제목까지 한 Text 에 합치면 red.
        expect(
          screen.getByTestId(`reflection-daily-map-notice-reason-${reason}`)
        ).toHaveTextContent(body);
        expect(screen.getByText(title)).toBeOnTheScreen();
        expect(screen.queryAllByTestId(REASON_LEAF)).toHaveLength(1);
      }
    );
  });
});

describe('헤더 ‹ — 5얼굴 버튼·옵셔널 prop·편집 중 닫기', () => {
  // TRIP-1119 (옛 DailyReflectionScreen.back.test.tsx)
  /**
   * TRIP-1119 · j03 오늘의 회고 헤더 ‹ — 순수 프레젠테이션(prop 주입).
   *
   * 무엇을 보장하나:
   *  - AC3: 5얼굴 전부 ‹(`reflection-daily-back`)가 button 역할·"뒤로" 이름을 갖고, 누르면 `onBack` 1회.
   *  - AC5: `onBack` 을 안 넘기는 호출자(프리뷰·기존 테스트)에서도 ‹ 는 그려지고 눌러도 깨지지 않는다.
   *  - AC7(결정 2 b): 편집 중 ‹ 는 화면을 떠나지 않고 편집만 닫는다(`onBack`·`onSaveEdit` 0회).
   *    편집이 닫힌 뒤의 ‹ 는 다시 `onBack` 을 부른다.
   *
   * `onBack` 은 구현 전이라 화면 prop 타입에 없다 — 테스트 안에서만 넓힌 타입으로 캐스팅한다
   * (선례 `.faces.test.tsx` 의 FacesProps).
   */

  type BackProps = DailyReflectionScreenProps & { onBack?: () => void };

  const Screen = DailyReflectionScreen as unknown as (
    props: BackProps
  ) => ReactElement;

  const FACES: ReflectionFace[] = [
    'default',
    'data-insufficient',
    'empty',
    'error',
    'pending',
  ];

  function baseProps(
    face: ReflectionFace,
    over: Partial<BackProps> = {}
  ): BackProps {
    return {
      face,
      narrative: '바다를 보며 걸은 하루',
      editableText: '바다를 보며 걸은 하루',
      stats: {
        visitCount: 4,
        distanceKm: 12,
        distanceSource: 'VISIT_LINE',
        photoCount: 6,
      },
      distanceDash: false,
      mapNotice: null,
      hidePhotoGrid: true,
      photos: [],
      changeSummary: null,
      onEnterEdit: jest.fn(),
      onConfirm: jest.fn(),
      onSaveEdit: jest.fn(),
      ...over,
    };
  }

  describe('AC3 · 5얼굴 전부 헤더 ‹ 가 누를 수 있는 "뒤로" 버튼이다', () => {
    it.each(FACES)('%s: ‹ 는 button 역할이고 이름이 "뒤로"다', (face) => {
      render(<Screen {...baseProps(face, { onBack: jest.fn() })} />);

      const back = screen.getByTestId('reflection-daily-back');
      expect(back).toHaveProp('accessibilityRole', 'button');
      expect(back).toHaveProp('accessibilityLabel', '뒤로');
    });

    it.each(FACES)('%s: ‹ 를 누르면 onBack 을 1회 부른다', (face) => {
      const onBack = jest.fn();
      render(<Screen {...baseProps(face, { onBack })} />);

      fireEvent.press(screen.getByTestId('reflection-daily-back'));

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('AC5 · onBack 을 안 넘기는 호출자도 그대로 그려진다 (옵셔널 prop)', () => {
    it.each(FACES)(
      '%s: onBack 없이도 ‹ 가 있고, 눌러도 예외가 나지 않는다',
      (face) => {
        render(<Screen {...baseProps(face)} />);

        const back = screen.getByTestId('reflection-daily-back');
        expect(() => fireEvent.press(back)).not.toThrow();
      }
    );
  });

  describe('AC7 · 편집 중 ‹ 는 편집만 닫는다 (결정 2 b)', () => {
    it.each<ReflectionFace>(['default', 'empty'])(
      '%s: 편집 중 ‹ → onBack·onSaveEdit 0회, 입력칸이 닫히고 헤더 "편집"이 돌아온다',
      (face) => {
        const onBack = jest.fn();
        const onSaveEdit = jest.fn();
        render(<Screen {...baseProps(face, { onBack, onSaveEdit })} />);
        fireEvent.press(screen.getByTestId('reflection-daily-edit'));
        fireEvent.changeText(
          screen.getByTestId('reflection-daily-edit-input'),
          '저장 안 한 글'
        );
        // 앵커 — 편집이 실제로 열렸고, 편집 중에도 ‹ 는 보인다.
        expect(
          screen.getByTestId('reflection-daily-edit-input')
        ).toBeOnTheScreen();
        expect(screen.queryByTestId('reflection-daily-edit')).toBeNull();

        fireEvent.press(screen.getByTestId('reflection-daily-back'));

        expect(onBack).not.toHaveBeenCalled();
        expect(onSaveEdit).not.toHaveBeenCalled();
        expect(screen.queryByTestId('reflection-daily-edit-input')).toBeNull();
        expect(screen.getByTestId('reflection-daily-edit')).toBeOnTheScreen();
      }
    );

    it('편집을 ‹ 로 닫은 뒤 ‹ 를 다시 누르면 그때는 onBack 을 1회 부른다', () => {
      const onBack = jest.fn();
      render(<Screen {...baseProps('default', { onBack })} />);
      fireEvent.press(screen.getByTestId('reflection-daily-edit'));
      fireEvent.press(screen.getByTestId('reflection-daily-back'));
      // 앵커 — 첫 ‹ 는 편집만 닫았다.
      expect(screen.queryByTestId('reflection-daily-edit-input')).toBeNull();
      expect(onBack).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('reflection-daily-back'));

      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });
});

describe('헤더 공유 아이콘 없음', () => {
  // TRIP-762 AC-11 (옛 DailyReflectionScreen.share.test.tsx)
  /**
   * TRIP-762 · AC-11 — j03 오늘의 회고 **헤더 공유 제거**(구 TRIP-574 additive 공유 아이콘 폐기).
   *
   * 라이브 j03 4프레임에 공유가 0 이고 공유는 j04/j06 소관이라, 화면 `canShare`/`onShare` prop 과
   * `reflection-daily-share` 아이콘을 **제거**한다(페이지의 status==='ENDED' 게이트도 함께 —
   * `DailyReflectionPage.hookMock.test.tsx` 공유 묶음). 이 파일은 TRIP-574 시절 공유 거동 테스트를 **제거 반영**으로
   * 갱신한 것이다.
   *
   * 무엇을 보장하나(승인 계약):
   *  - 재구성된 default 얼굴에 공유 아이콘(`reflection-daily-share`) 표면이 없다(재도입 방지 렌더 가드).
   *
   * ★ red/선제green 판정: 이 렌더 가드는 **선제-green** 이다 — 화면이 onShare 를 안 받으면 예전에도
   *   아이콘을 안 그렸다. 제거의 **red 잠금**은 소스 스캔(`shareCardStructure.test.ts` G4 —
   *   DailyReflectionScreen.tsx 에 `reflection-daily-share` **부재**)과 페이지 배선 테스트
   *   (`DailyReflectionPage.hookMock.test.tsx` 공유 묶음 — onShare/canShare prop 부재)가 진다. 이 파일은 화면
   *   렌더 층에 "공유 표면 재도입 금지" 그물을 영구히 남긴다.
   *
   * (개념) `queryByTestId` = 없으면 null(getBy 는 throw) → `.toBeNull()` 로 부재를 단언.
   */

  const Screen = DailyReflectionScreen as unknown as (
    props: ExtendedProps
  ) => ReactElement;

  const NARRATIVE = '오늘은 광안리와 미술관을 둘러본 하루였어요.';

  function baseProps(): ExtendedProps {
    return {
      face: 'default',
      narrative: NARRATIVE,
      editableText: NARRATIVE,
      stats: {
        visitCount: 4,
        distanceKm: 12,
        distanceSource: 'VISIT_LINE',
        photoCount: 6,
      },
      distanceDash: false,
      mapNotice: null,
      hidePhotoGrid: false,
      photos: [{ uri: 'file://p1.jpg' }],
      changeSummary: null,
      dayTabs: [{ day: 1, today: true }],
      activeDay: 1,
      onSelectDay: jest.fn(),
      onPressTab: jest.fn(),
      onEnterEdit: jest.fn(),
      onConfirm: jest.fn(),
      onSaveEdit: jest.fn(),
    };
  }

  describe('🔴 AC-11 · 헤더 공유 아이콘 제거(렌더 가드)', () => {
    it('재구성된 default 얼굴에 reflection-daily-share 가 없다(편집 진입점은 유지)', () => {
      render(<Screen {...baseProps()} />);

      // 부정 — 공유 표면 부재.
      expect(screen.queryByTestId('reflection-daily-share')).toBeNull();
      // 긍정 짝 — 헤더 편집 진입점(공유와 다름, AC-12)은 그대로 남는다.
      expect(screen.getByTestId('reflection-daily-edit')).toBeOnTheScreen();
    });
  });
});
