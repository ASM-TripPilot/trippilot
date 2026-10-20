import type { ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { Revision } from '@/shared/api/index.schemas';
import { formatRelativeTime } from '@/shared/lib/formatRelativeTime';

/**
 * h36 리비전 행 목록(TRIP-1513) — props 만 받는 순수 뷰. 서버가 준 순서(최신순)를 그대로 그리고
 * 재정렬하지 않는다. 첫 행이 현재 버전이라 [되돌리기] 가 없고, kind=BASELINE 행에만 "기준 버전"이 붙는다.
 * 소요시간(INV-3)·삭제 컨트롤은 두지 않는다.
 */

export interface RevisionListProps {
  revisions: readonly Revision[];
  now: Date;
  onRestore: (revisionId: string) => void;
}

function RevisionRow({
  revision,
  current,
  now,
  onRestore,
}: {
  revision: Revision;
  current: boolean;
  now: Date;
  onRestore: (revisionId: string) => void;
}): ReactElement {
  const baseline = revision.kind === 'BASELINE';
  const sub = [revision.detail, baseline ? 'AI가 처음 짠 일정이에요' : null];
  return (
    <View
      testID={`itinerary-history-${revision.revisionId}`}
      className={`gap-md border-b border-hairline p-lg ${baseline ? 'bg-surface-soft' : ''}`}
    >
      <View className="gap-xs">
        <View className="flex-row items-center gap-sm">
          <View className="rounded-[12px] bg-primary-pale px-sm py-[3px]">
            <Text className="font-noto-bold text-micro font-bold text-primary">
              {revision.actor === 'USER' ? '나' : 'AI'}
            </Text>
          </View>
          <Text className="flex-1 font-noto-bold text-card-title font-bold text-ink">
            {revision.summary}
          </Text>
        </View>
        {sub.map((line) =>
          line ? (
            <Text key={line} className="font-noto text-caption text-muted">
              {line}
            </Text>
          ) : null
        )}
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="font-noto text-caption text-muted">
          {formatRelativeTime(revision.createdAt, now)}
        </Text>
        <View className="flex-row items-center gap-md">
          {baseline ? (
            <Text
              testID="itinerary-history-baseline"
              className="font-noto text-label text-muted"
            >
              기준 버전
            </Text>
          ) : null}
          {current ? (
            <Text
              testID="itinerary-history-current"
              className="font-noto text-label text-muted"
            >
              현재 버전
            </Text>
          ) : (
            <Pressable
              testID={`itinerary-history-restore-${revision.revisionId}`}
              accessibilityRole="button"
              onPress={() => onRestore(revision.revisionId)}
              className="h-[44px] items-center justify-center rounded-button border border-hairline-strong bg-canvas px-lg"
            >
              <Text className="font-noto-bold text-label font-bold text-ink">
                이 버전으로 되돌리기
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

export function RevisionList({
  revisions,
  now,
  onRestore,
}: RevisionListProps): ReactElement {
  return (
    <View>
      {revisions.map((revision, index) => (
        <RevisionRow
          key={revision.revisionId}
          revision={revision}
          current={index === 0}
          now={now}
          onRestore={onRestore}
        />
      ))}
    </View>
  );
}
