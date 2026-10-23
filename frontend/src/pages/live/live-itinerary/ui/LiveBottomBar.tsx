import type { ReactElement } from 'react';

import { EventGlyph } from '@/features/execution/index.view';
import { PencilGlyph } from '@/features/itinerary/index.view';
import { ChatBubbleGlyph } from '@/features/open-assistant';
import { GLYPH_COLORS } from '@/shared/ui/glyphs';
import {
  ItineraryIconActive,
  ItineraryIconInactive,
  type ShellTabKey,
} from '@/shared/ui/BottomTabBar';
import { MorphNavBar, NavBarCell } from '@/widgets/bottom-nav-bar';

import {
  LIVE_BAR_BOTTOM_GAP,
  LIVE_BOTTOM_BAR_RESERVE,
} from '../model/editPopupLayout';

/**
 * TRIP-1522 v2 · i01 여행 중 허브 하단 내비 바(순수 프레젠테이션 — props 만 받는다).
 * 왼쪽 둥근 뒤로 + 4칸 캡슐 [일정·수정·챗봇·행사], 둘 다 유리 표면(`GlassSurface` — 앱 하단 탭 바와 같은 값, Figma A·B).
 * **접힘 상태가 없다** — 시트가 어디 있든(끝까지 내려가도) 바는 똑같다. 위치(화면 아래 띄우기)·수정 팝업·행사 카드는 부모(`LiveHubView`) 몫이다.
 *
 * controlled — 어느 칸이 활성인지(`active`)와 팝업·카드가 열렸는지는 부모가 준 값이고 바는 상태를 쥐지 않는다. 활성은 낭독 신호
 * `selected`, 수정·행사 칸의 펼침(팝업·카드 열림)은 `expanded` 로 읽힌다(둘 다 늘 true/false 로 준다 — 안 주면 "접힘"도 아니다).
 * 수정 칸은 이동하지 않는다 — 팝업을 여닫는 신호만 부른다. 비활성 칸(기회 없는 행사)은 낭독 상태만이 아니라 `Pressable` 의
 * `disabled` 로 눌림 자체를 막는다. 행사 칸 점은 장식이라 낭독에서 뺀다 — "추천 있음"은 칸의 `accessibilityValue` 가 대신 읽는다.
 * 라벨은 탭 바와 같은 `text-micro`(Figma 10 · 킷 최소 11 사이 — 탭 바 값을 따랐다)다.
 *
 * TRIP-1584 — 변신 모션(출발 탭 → 5칸 시작 → 일정만 남기고 폭이 줄며 맨 앞으로 → 새 칸 등장, 뒤로는 역순 뒤 이동)은 공용 `MorphNavBar`(widgets)로
 * 옮겼다. 이 파일은 허브의 칸 4개와 id 만 정해 넘기는 얇은 래퍼다. 일정 칸이 생존 칸이다(홈 탭 바의 3번째 자리).
 */

export { LIVE_BOTTOM_BAR_RESERVE };
/** 바 아래 띄움 — 부모가 안전영역에 더해 절대 배치한다. */
export const LIVE_BOTTOM_BAR_BOTTOM_GAP = LIVE_BAR_BOTTOM_GAP;

export type LiveBarActive = 'schedule' | 'edit' | 'event';

export interface LiveBottomBarProps {
  onBack: () => void;
  /** 활성(분홍) 칸 — 부모가 정한다: 기본 일정, 수정 팝업이 열리면 수정, 행사 카드가 열리면 행사. */
  active: LiveBarActive;
  /** 보고 있는 날 보여줄 기회가 있다 → 행사 칸 활성 가능 + 점. false 면 칸이 비활성(눌러도 아무 일 없음)이고 점이 없다. */
  eventAvailable: boolean;
  onPressSchedule: () => void;
  /** 팝업을 여닫는 신호일 뿐 — 이동하지 않는다. */
  onPressEdit: () => void;
  onPressChatbot: () => void;
  onPressEvent: () => void;
  /** 마운트 후 입장 모션(시작 5칸 → 최종)을 한 번 재생한다. 마운트 순간의 값만 본다 — 이후 바뀌어도 영향 없다. 기본 꺼짐. `departureTab` 이 있어야 의미가 있다. */
  entrance?: boolean;
  /**
   * 허브로 오기 직전 홈 탭 바에서 활성이던 탭. 시작 5칸의 활성 칸이자 퇴장이 끝날 때의 활성 칸이다(입장이 끝난 뒤에도 계속 준다).
   * 없으면 탭 바 위가 아닌 진입이라 모션 없이 최종 구조이고 뒤로는 즉시 `onBack` 이다.
   */
  departureTab?: ShellTabKey;
}

export function LiveBottomBar({
  onBack,
  active,
  eventAvailable,
  onPressSchedule,
  onPressEdit,
  onPressChatbot,
  onPressEvent,
  entrance = false,
  departureTab,
}: LiveBottomBarProps): ReactElement {
  const tone = (on: boolean) =>
    on ? GLYPH_COLORS.primary : GLYPH_COLORS.muted;
  return (
    <MorphNavBar
      testID="execution-live-bottom-bar"
      capsuleTestID="execution-live-bar-capsule"
      backTestID="execution-live-back"
      startCellTestID={(tab) => `execution-live-start-${tab}`}
      onBack={onBack}
      survivorTab="itinerary"
      survivorSelected={active === 'schedule'}
      renderSurvivor={(selected) => (
        <NavBarCell
          testID="execution-live-bar-schedule"
          label="일정"
          icon={selected ? <ItineraryIconActive /> : <ItineraryIconInactive />}
          selected={selected}
          onPress={onPressSchedule}
        />
      )}
      newCells={[
        <NavBarCell
          key="edit"
          testID="execution-live-bar-edit"
          label="수정"
          icon={
            <PencilGlyph
              size={27}
              tone={active === 'edit' ? 'primary' : 'muted'}
            />
          }
          selected={active === 'edit'}
          expanded={active === 'edit'}
          onPress={onPressEdit}
        />,
        <NavBarCell
          key="chatbot"
          testID="execution-live-bar-chatbot"
          label="챗봇"
          icon={<ChatBubbleGlyph size={27} color={GLYPH_COLORS.muted} />}
          selected={false}
          onPress={onPressChatbot}
        />,
        <NavBarCell
          key="event"
          testID="execution-live-bar-event"
          label="행사"
          icon={<EventGlyph size={27} color={tone(active === 'event')} />}
          selected={active === 'event'}
          expanded={active === 'event'}
          disabled={!eventAvailable}
          value={eventAvailable ? '추천 있음' : undefined}
          dot={eventAvailable}
          onPress={onPressEvent}
        />,
      ]}
      entrance={entrance}
      departureTab={departureTab}
    />
  );
}
