import type { ReactElement, ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Revision } from '@/shared/api/index.schemas';
import { AppBar } from '@/shared/ui/AppBar';
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
import {
  AlertCircleGlyph,
  BackChevronGlyph,
  ClockGlyph,
  WarningTriangleGlyph,
} from '@/shared/ui/glyphs';
import { NoticeBanner } from '@/shared/ui/NoticeBanner';
import { Skeleton } from '@/shared/ui/Skeleton';
import { StateNotice } from '@/shared/ui/StateNotice';

import { RevisionList } from './RevisionList';

/**
 * h36 변경 이력 화면 뷰(TRIP-1513) — 얼굴(로딩·오류·빈·목록)·확인 다이얼로그·되돌리기 실패 배너를 그리기만 한다.
 * 요청·잠금·이동은 `ItineraryHistoryPage` 가 진다(프리뷰가 네트워크 없이 네 얼굴을 보게 분리).
 */

export type HistoryFace = 'loading' | 'error' | 'empty' | 'list';

export interface ItineraryHistoryViewProps {
  face: HistoryFace;
  revisions: readonly Revision[];
  now: Date;
  /** 되돌리기 확인 다이얼로그가 열려 있나. */
  confirming: boolean;
  /** 확정 요청이 나가 있는 동안 두 버튼을 잠근다. */
  restoring: boolean;
  /** 409/404 안내 문구(null = 배너 없음). */
  restoreNotice: string | null;
  onBack: () => void;
  onRetry: () => void;
  onRestore: (revisionId: string) => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
}

function FaceBox({ children }: { children: ReactNode }): ReactElement {
  return (
    <View className="h-[112px] w-[112px] items-center justify-center rounded-[24px] border-[1.5px] border-dashed border-hairline-strong bg-canvas-alt">
      {children}
    </View>
  );
}

function Centered({ children }: { children: ReactNode }): ReactElement {
  return (
    <View className="flex-1 items-center justify-center px-lg">{children}</View>
  );
}

function Body({
  face,
  revisions,
  now,
  restoreNotice,
  onRetry,
  onRestore,
}: Pick<
  ItineraryHistoryViewProps,
  'face' | 'revisions' | 'now' | 'restoreNotice' | 'onRetry' | 'onRestore'
>): ReactElement {
  if (face === 'loading') {
    return (
      <View testID="itinerary-history-loading" className="gap-md p-lg">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[96px] rounded-card bg-surface-soft" />
        ))}
      </View>
    );
  }
  if (face === 'error') {
    return (
      <Centered>
        <StateNotice
          testID="itinerary-history-error"
          illustration={
            <FaceBox>
              <WarningTriangleGlyph size={46} color="mutedSoft" />
            </FaceBox>
          }
          title="이력을 불러오지 못했어요"
          description=""
          actions={[
            {
              testID: 'itinerary-history-retry',
              label: '다시 시도',
              variant: 'filled',
              onPress: onRetry,
            },
          ]}
        />
      </Centered>
    );
  }
  if (face === 'empty') {
    return (
      <Centered>
        <StateNotice
          testID="itinerary-history-empty"
          illustration={
            <FaceBox>
              <ClockGlyph size={46} color="mutedSoft" />
            </FaceBox>
          }
          title="아직 변경 이력이 없어요"
          description="일정을 고치거나 새로 짜면 여기에 쌓여요"
          actions={[]}
        />
      </Centered>
    );
  }
  return (
    <ScrollView>
      {restoreNotice ? (
        <View className="pt-md">
          <NoticeBanner
            testID="itinerary-history-restore-error"
            notice={{ message: restoreNotice, action: null }}
            actionTestIDs={{ login: '', retry: '' }}
            icon={<AlertCircleGlyph size={20} color="primary" />}
          />
        </View>
      ) : null}
      <Text className="px-lg pb-sm pt-md font-noto text-label text-muted">
        되돌려도 지금까지의 이력은 그대로 남아요
      </Text>
      <RevisionList revisions={revisions} now={now} onRestore={onRestore} />
    </ScrollView>
  );
}

export function ItineraryHistoryView({
  face,
  revisions,
  now,
  confirming,
  restoring,
  restoreNotice,
  onBack,
  onRetry,
  onRestore,
  onCancelConfirm,
  onConfirm,
}: ItineraryHistoryViewProps): ReactElement {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas">
        <View className="border-b border-hairline">
          <AppBar
            className="flex-row items-center gap-sm py-[14px] pl-md pr-lg"
            back={{
              testID: 'itinerary-history-back',
              onPress: onBack,
              accessibilityRole: 'button',
              accessibilityLabel: '뒤로',
              hitSlop: 8,
              glyph: <BackChevronGlyph size={24} />,
            }}
            title="일정 변경 이력"
            titleClassName="font-noto-bold text-[18px] font-bold text-ink"
          />
        </View>
        <Body
          face={face}
          revisions={revisions}
          now={now}
          restoreNotice={restoreNotice}
          onRetry={onRetry}
          onRestore={onRestore}
        />
        {confirming ? (
          <ConfirmDialog
            testID="itinerary-history-confirm"
            title="이 버전으로 되돌릴까요?"
            description="지금 일정이 이 버전으로 바뀌어요. 이력은 지워지지 않아서 다시 되돌릴 수도 있어요."
            buttons={[
              {
                testID: 'itinerary-history-confirm-cancel',
                label: '취소',
                tone: 'outline',
                onPress: onCancelConfirm,
                disabled: restoring,
              },
              {
                testID: 'itinerary-history-confirm-ok',
                label: '되돌리기',
                tone: 'primary',
                onPress: onConfirm,
                disabled: restoring,
              },
            ]}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
