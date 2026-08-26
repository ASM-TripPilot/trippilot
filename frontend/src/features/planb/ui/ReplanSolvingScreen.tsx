import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import {
  ChecklistActiveGlyph,
  ChecklistDoneGlyph,
  ChecklistWaitingGlyph,
} from './PlanbGlyphs';

/**
 * TRIP-440 · AC-1·2·3 — i12 재계획 로딩 화면(순수, props+콜백만, 라우팅·훅 모름).
 *
 * SOLVING 동안 진행 표시·체크리스트·안심 노트 + [백그라운드로]·[취소] 두 컨트롤을 그린다. 지도는
 * 로딩 데코라 이번 범위 밖(D4). 진행바는 애니메이션 없는 고정 66% 막대(계약에 진행 %가 없어
 * 임의 고정)라 testID 존재만 잰다 — 흐름 애니메이션은 이번 범위 밖. ⚠️ Figma 라이브 프레임엔 두 버튼이 없다(문서-라이브 드리프트) — 버튼은
 * 계약(POST /cancel)·AC 근거로 배치하되 육안 대조 근거는 없다.
 *
 * ★ 계약 최소화: props 는 `onBackground`·`onCancel` 둘뿐 — 다른 props 를 필수로 만들지 않는다.
 * ★ INV-3: 소요시간 리터럴(`N분`/`N시간`/`소요`) 0 — 체크리스트 라벨의 "시간"은 앞에 숫자가 없어
 *   구조가드(executionDurationStructure) 사정거리 밖이다.
 */

const TITLE = 'AI가 일정을 다시 짜고 있어요';
const SUBTITLE = '비 예보를 피해 남은 일정을 다시 맞추는 중 · 5초쯤 걸려요';
const REASSURANCE =
  '완료한 곳 · 고정한 곳(숙소)은 그대로 유지돼요 · 바뀌는 건 남은 일정 뿐이에요';
const BACKGROUND_LABEL = '백그라운드로';
const CANCEL_LABEL = '취소';

type ChecklistState = 'done' | 'active' | 'waiting';

const CHECKLIST: { label: string; state: ChecklistState }[] = [
  { label: '비 예보·남은 시간 반영', state: 'done' },
  { label: '대안 후보 거리·동선 계산', state: 'done' },
  { label: '대안 영업시간 확인 중', state: 'active' },
  { label: '새 동선 완성', state: 'waiting' },
];

function ChecklistIcon({ state }: { state: ChecklistState }): ReactElement {
  if (state === 'done') return <ChecklistDoneGlyph />;
  if (state === 'active') return <ChecklistActiveGlyph />;
  return <ChecklistWaitingGlyph />;
}

export interface ReplanSolvingScreenProps {
  onBackground: () => void;
  onCancel: () => void;
}

export function ReplanSolvingScreen({
  onBackground,
  onCancel,
}: ReplanSolvingScreenProps): ReactElement {
  return (
    <View className="flex-1 bg-canvas">
      <ScrollView contentContainerClassName="gap-lg px-lg pb-2xl pt-2xl">
        {/* 본문 타이틀·부제 */}
        <View className="gap-sm">
          <Text className="font-noto-bold text-hero font-bold text-ink">
            {TITLE}
          </Text>
          <Text className="font-noto text-label text-muted">{SUBTITLE}</Text>
        </View>

        {/* 진행바 — 트랙 surface-strong + 채움 primary 고정 66%(애니메이션 없음, testID 만 잼) */}
        <View
          testID="planb-solving-progress"
          className="h-sm w-full overflow-hidden rounded-pill bg-surface-strong"
        >
          <View className="h-full w-2/3 rounded-pill bg-primary" />
        </View>

        {/* 체크리스트 4행 — done/active/waiting 3상태 아이콘 + 라벨 */}
        <View className="gap-md">
          {CHECKLIST.map((item) => (
            <View key={item.label} className="flex-row items-center gap-md">
              <ChecklistIcon state={item.state} />
              <Text
                className={`text-body ${
                  item.state === 'waiting'
                    ? 'font-noto text-muted-soft'
                    : 'font-noto text-ink'
                }`}
              >
                {item.label}
              </Text>
            </View>
          ))}
        </View>

        {/* 안심 노트 — 완료·고정 슬롯 불변 고지(BR-U4-18) */}
        <View className="rounded-card bg-surface-soft p-md">
          <Text className="font-noto text-caption text-muted">
            {REASSURANCE}
          </Text>
        </View>

        {/* CTA 2개(Figma 라이브엔 없음 — 계약·AC 근거) */}
        <View className="gap-sm pt-sm">
          <Pressable
            testID="planb-solving-background"
            accessibilityRole="button"
            onPress={onBackground}
            className="items-center justify-center rounded-button border border-hairline-strong py-[15px]"
          >
            <Text className="font-noto-bold text-card-title font-bold text-ink">
              {BACKGROUND_LABEL}
            </Text>
          </Pressable>
          <Pressable
            testID="planb-solving-cancel"
            accessibilityRole="button"
            onPress={onCancel}
            className="items-center justify-center rounded-button py-[15px]"
          >
            <Text className="font-noto-bold text-card-title font-bold text-muted">
              {CANCEL_LABEL}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
