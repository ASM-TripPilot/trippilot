import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BackChevronGlyph, CheckGlyph, FullAiGlyph } from './MapSheetGlyphs';

/**
 * TRIP-790 · h07 부분 결과의 상단 진행 카드(widgets · presentation-only, useState 0). 전면 지도 위
 * 좌상단 오버레이로 얹히며, 셸의 `DayChipOverlay` 자리를 대체한다(D3·D4). 좌 원형 back + AI 표식 +
 * 일자별 진행 게이지(4셀까지) 한 벌.
 *
 * 무엇을 보장하나:
 *  - **셀은 주입받는다**(`{status, label}[]`). 위젯은 features(`buildGenerationGauge`)를 못 물어
 *    상태를 스스로 도출하지 않고, 받은 status 로 트랙 톤을·받은 label 로 글자를 그릴 뿐이다
 *    ([[presentation-only 위젯 — 판단은 소비처로]]). 소비처(DraftPage)가 tabs 에서 도출해 넘긴다.
 *  - **3톤 트랙**: done=primary 채움 / active·waiting=회색(`bg-surface-strong`). 트랙 배경 톤은
 *    className 으로 jest 렌더 트리에 평문으로 남아 심판이 읽는다(loginVisual 선례).
 *  - **퍼센트·캡션 없음**(계약). `generationState` 는 3값 열거뿐이라 진행 수치가 없다 — Figma 에
 *    67% 가 있어도 그리지 않는다(INV 류 · 티켓 확정).
 *
 * ⚠️ 원리적 사각(6-b 육안): ✦(FullAi)·✓(Check) 글리프 실렌더·active 트랙 안쪽 primary 부분채움·
 *   active 라벨 붉은색은 SVG stroke/fill·픽셀이라 jest 가 못 본다. 여기선 트랙 **배경 톤**·라벨
 *   **글자**·back 콜백까지만 잠긴다(02a §7).
 *
 * *(개념)* **presentation-only 위젯** — 화면 조각을 그리기만 하고 상태·판단을 갖지 않는 컴포넌트.
 *   판단(어느 일자가 done 인가)은 이 위젯을 소비하는 페이지가 하고, 위젯은 그 결과만 받아 그린다.
 */

const GAUGE_TITLE = 'AI가 일정을 짜고 있어요';

// 진행 카드 그림자(Figma 0 4 8 rgba(0,0,0,0.08)). `#000000` 은 브랜드 팔레트(토큰 raw-hex 가드
// 목록) 밖이라 그림자 색으로 정당하다(MapSheetShell 형제·DayChipOverlay 선례 동형).
const cardShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 2,
} as const;

// 원형 back 버튼 그림자(Figma 0 2 10 rgba(0,0,0,0.06)).
const backShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.06,
  shadowRadius: 10,
  elevation: 3,
} as const;

/** 진행 게이지 셀 하나 — 상태(3톤 트랙)와 이미 조립된 한글 라벨. 위젯은 이 값을 그대로 그린다. */
export interface GenerationProgressCell {
  status: 'done' | 'active' | 'waiting';
  /** 예: `1일차 완성`·`2일차 생성 중`·`3일차 대기`(소비처가 도착 여부에서 조립). */
  label: string;
}

export interface GenerationProgressCardProps {
  cells: GenerationProgressCell[];
  onBack: () => void;
  /** 제목 문구 — 미전달이면 h07 기본 문구(TRIP-752, i05 는 `AI가 일정을 다시 짜고 있어요`). */
  title?: string;
  /** 주면 제목 행 오른쪽에 [취소] 텍스트 버튼을 그린다(TRIP-752 i05). 미전달=버튼 없음(h07). */
  onCancel?: () => void;
  /** [취소] 잠금 — 취소 요청 대기 중 연타 방지(TRIP-752). 미전달=활성. */
  cancelDisabled?: boolean;
}

export function GenerationProgressCard({
  cells,
  onBack,
  title = GAUGE_TITLE,
  onCancel,
  cancelDisabled,
}: GenerationProgressCardProps): ReactElement {
  return (
    <View
      testID="generation-progress-card"
      className="flex-row items-start gap-sm"
    >
      {/* 좌상단 원형 back — 셸 back 을 대체(진행 카드가 오버레이 전체를 소유). */}
      <Pressable
        testID="generation-progress-back"
        onPress={onBack}
        style={backShadow}
        className="h-[36px] w-[36px] items-center justify-center rounded-pill bg-canvas"
      >
        <BackChevronGlyph size={20} />
      </Pressable>

      {/* 진행 카드 본체 — 흰 배경 + hairline 테두리 카드. */}
      <View
        style={cardShadow}
        className="flex-1 gap-md rounded-card border border-hairline bg-canvas px-lg py-md"
      >
        {/* 제목 행 — ✦ 스파클 + 안내 문구(+ i05 [취소]). 퍼센트(67%)는 계약에 없어 안 그린다. */}
        <View className="flex-row items-center gap-sm">
          <FullAiGlyph size={18} />
          <Text className="flex-1 font-noto-bold text-label font-bold text-ink">
            {title}
          </Text>
          {onCancel !== undefined ? (
            <Pressable
              testID="generation-progress-cancel"
              accessibilityRole="button"
              onPress={onCancel}
              disabled={cancelDisabled}
            >
              <Text className="font-inter-bold text-section font-bold text-muted">
                취소
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* 게이지 — 셀마다 트랙(톤) + 라벨. 상태를 testID 로 구분해 심판이 셀별로 잠근다. */}
        <View className="flex-row gap-[4px]">
          {cells.map((cell, index) => {
            const cellNumber = index + 1;
            // 트랙 배경 톤 — done 만 브랜드 채움, 나머지는 회색(active 안쪽 부분채움은 아래 자식).
            const trackTone =
              cell.status === 'done' ? 'bg-primary' : 'bg-surface-strong';
            // 라벨 톤 — done=진한 잉크 / active=붉은 강조 / waiting=흐린 회색(brief §①).
            const labelTone =
              cell.status === 'done'
                ? 'font-noto-bold font-bold text-ink'
                : cell.status === 'active'
                  ? 'font-noto-bold font-bold text-primary-text'
                  : 'font-noto text-muted';
            return (
              <View
                key={cellNumber}
                testID={`generation-gauge-cell-${cellNumber}-${cell.status}`}
                className="flex-1 gap-[6px]"
              >
                <View
                  testID={`generation-gauge-track-${cellNumber}`}
                  className={`h-[8px] w-full overflow-hidden rounded-pill ${trackTone}`}
                >
                  {/* active 트랙 안쪽 primary 부분채움(진행 중 표식, 픽셀이라 6-b 육안). */}
                  {cell.status === 'active' ? (
                    <View className="h-full w-1/3 rounded-pill bg-primary" />
                  ) : null}
                </View>
                <View className="flex-row items-center gap-[3px]">
                  {cell.status === 'done' ? <CheckGlyph size={12} /> : null}
                  <Text className={`text-micro ${labelTone}`}>
                    {cell.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}
