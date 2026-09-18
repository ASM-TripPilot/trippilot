import type { ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  ConflictChoice,
  ConflictRow,
  ConflictSelection,
  ConflictVisitVM,
} from '../model/conflict';

/**
 * TRIP-568 · AC-3 (BR-U5-21·21a) — 동기화 충돌 해소 화면.
 *
 * 무엇을 보장하나:
 *  - 충돌을 **방문(레코드) 단위**로 그린다 — 카드 하나 = 방문 하나, 각 카드에 `내 기기(오프라인)`
 *    vs `서버` **2열**, 열마다 라디오 1개(필드별이 아니라 버전 단위 선택, BR-U5-21a).
 *  - **미선택으로 시작**한다 — `[선택한 버전으로 동기화]` 는 **모든 카드가 버전을 고르기 전까지
 *    비활성**이다(침묵 승자 금지: 무응답이 로컬을 조용히 승자로 만들 수 없게, 01b §1).
 *  - 선택은 **`accessibilityState.selected` 로 반영**한다(fill 색 아님 — 색으로 잠그면 "골랐다는
 *    거짓말"이 jest 사각으로 통과, repo-traps 글리프 함정).
 *  - 모두 고른 뒤 적용 press → `onApply` 를 **정확히 1회**, 방문별 선택 배열로 부른다.
 *
 * 이 화면은 **전체화면 조건부 렌더 뷰**다(`@gorhom/bottom-sheet` 아님 — Figma 1563:1842 가 충돌을
 * 딤·핸들 없는 전체화면 본문으로 그린다). 바텀시트로 만들면 딤·실열림 jest 사각을 불필요하게
 * 떠안는다(01b 추가결정). 실제 화면 덮임·중앙정렬은 6-b 실기 몫이고, 여기 테스트는 testID
 * 트리존재·selected·disabled·콜백까지만 잠근다.
 *
 * VM(`ConflictVisitVM`)은 상위(페이지)가 조립해 주입한다 — 이 화면은 조회·판정을 하지 않는다.
 */

export interface ConflictSheetProps {
  conflicts: ConflictVisitVM[];
  onApply: (selections: ConflictSelection[]) => void;
}

/** 한 열(로컬/서버)의 비교값 + 라디오. 선택은 접근성 상태로만 표현한다. */
function ConflictColumn({
  visitCheckId,
  choice,
  columnLabel,
  rows,
  valueOf,
  selected,
  onSelect,
}: {
  visitCheckId: string;
  choice: ConflictChoice;
  columnLabel: string;
  rows: ConflictRow[];
  valueOf: (row: ConflictRow) => string;
  selected: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <View
      className={`flex-1 gap-sm rounded-card border p-md ${
        selected
          ? 'border-primary bg-primary-pale'
          : 'border-hairline bg-canvas'
      }`}
    >
      <Text className="font-noto-bold text-label text-ink">{columnLabel}</Text>
      {rows.map((row) => (
        <View key={row.label} className="gap-[2px]">
          <Text className="text-caption text-muted-soft">{row.label}</Text>
          <Text className="text-body text-ink">{valueOf(row)}</Text>
        </View>
      ))}
      <Pressable
        testID={`record-conflict-choice-${choice}-${visitCheckId}`}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        onPress={onSelect}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        className="mt-sm flex-row items-center gap-sm"
      >
        <View
          className={`size-[18px] rounded-full border-[1.8px] ${
            selected ? 'border-primary bg-primary' : 'border-hairline-strong'
          }`}
        />
        <Text className="text-label text-ink">이 버전 유지</Text>
      </Pressable>
    </View>
  );
}

export function ConflictSheet({
  conflicts,
  onApply,
}: ConflictSheetProps): ReactElement {
  // 방문별 선택. 없는 키 = 아직 미선택(초기 전부 미선택).
  const [choices, setChoices] = useState<
    Record<string, ConflictChoice | undefined>
  >({});

  // conflicts 가 비면 every 는 공허 참 → apply 가 열려 onApply([]) 를 쏜다(5-b 참고-1).
  // 충돌이 하나도 없으면 이 화면 자체가 뜰 이유가 없으므로 자기 방어로 length 를 앞세운다.
  const allChosen =
    conflicts.length > 0 &&
    conflicts.every((c) => choices[c.visitCheckId] !== undefined);

  const select = (visitCheckId: string, choice: ConflictChoice) => {
    setChoices((prev) => ({ ...prev, [visitCheckId]: choice }));
  };

  const handleApply = () => {
    // 모두 고르기 전엔 무발화(버튼 disabled 와 이중 방어).
    const selections: ConflictSelection[] = [];
    for (const c of conflicts) {
      const choice = choices[c.visitCheckId];
      if (choice === undefined) return;
      selections.push({ visitCheckId: c.visitCheckId, choice });
    }
    onApply(selections);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }} className="bg-canvas">
      {/* 경고 배너 — 무엇이 어긋났고 무엇을 해야 하는지 알린다(INV-4: 조용히 안 넘긴다).
          ponytail: 경고 삼각형 글리프는 안 넣었다(RecordGlyphs 신규 export 회피 — 이 티켓 스코프는
          신설 4파일). primary-pale 배경 + 문구만으로 경고를 전한다. 아이콘이 필요하면 후속. */}
      <View className="w-full gap-[2px] bg-primary-pale px-lg py-md">
        <Text className="font-noto-bold text-body text-primary-text">
          오프라인 기록과 서버 기록이 달라요
        </Text>
        <Text className="text-label text-muted">
          네트워크 복구 중 충돌이 발생했어요. 항목마다 어느 버전을 유지할지
          선택하세요.
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-md px-lg pb-[24px] pt-md"
      >
        <Text className="text-label text-muted">
          동기화 충돌 {conflicts.length}건 · 유지할 버전을 선택하면 기록에
          반영돼요
        </Text>

        {conflicts.map((conflict) => {
          const choice = choices[conflict.visitCheckId];
          return (
            <View
              key={conflict.visitCheckId}
              testID={`record-conflict-card-${conflict.visitCheckId}`}
              className="w-full gap-sm rounded-card border border-hairline bg-canvas p-md"
            >
              <View className="w-full flex-row items-center justify-between">
                <Text className="font-noto-bold text-card-title text-ink">
                  {conflict.nameKo}
                </Text>
                <View className="rounded-pill bg-primary px-sm py-[3px]">
                  <Text className="text-label text-white">충돌</Text>
                </View>
              </View>

              <View className="w-full flex-row gap-sm">
                <ConflictColumn
                  visitCheckId={conflict.visitCheckId}
                  choice="local"
                  columnLabel="내 기기 (오프라인)"
                  rows={conflict.rows}
                  valueOf={(row) => row.local}
                  selected={choice === 'local'}
                  onSelect={() => select(conflict.visitCheckId, 'local')}
                />
                <ConflictColumn
                  visitCheckId={conflict.visitCheckId}
                  choice="server"
                  columnLabel="서버"
                  rows={conflict.rows}
                  valueOf={(row) => row.server}
                  selected={choice === 'server'}
                  onSelect={() => select(conflict.visitCheckId, 'server')}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View className="w-full border-t border-hairline bg-canvas px-lg py-md">
        <Pressable
          testID="record-conflict-apply"
          disabled={!allChosen}
          onPress={handleApply}
          className={`w-full items-center rounded-card py-[14px] ${
            allChosen ? 'bg-primary' : 'bg-surface-strong'
          }`}
        >
          <Text
            className={`font-noto-bold text-body ${
              allChosen ? 'text-white' : 'text-muted-soft'
            }`}
          >
            선택한 버전으로 동기화
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
