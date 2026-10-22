/**
 * 인기 숙소 줄 + 「Trip.com에서 전체 숙소 보기」 + 제휴 고지 시트 한 덩어리(TRIP-1579 · B안).
 *
 * 세 feature 를 조립한다 — 목록(`curated-stay`)·하트(`save-stay`)·제휴 흐름(`stay-outbound`). features 끼리는
 * 서로 모르므로 이어 붙이는 일은 여기서만 한다. 카드·전체 보기 누름은 둘 다 고지 시트(BR-U1-30)를 거쳐 서버
 * 아웃바운드로 간다(저장값이 켜져 있으면 바로). 하트는 좌표 없이 담고(인기 숙소엔 좌표가 없다), 미인증 결과면
 * 로그인으로 보낸다(StayDetailPage 와 같은 방식).
 *
 * 목록이 숨김(조건 없음·게스트·로딩·실패·빈 목록)이면 카드 줄(과 제목)만 숨기고 전체 보기는 `showBrowseAll` 일 때
 * 남긴다 — 죽은 줄·죽은 버튼을 만들지 않는다.
 *
 * ⚠️ 시트(`OtaChoiceSheet` = gorhom `BottomSheet`, 포털 없음)는 이 위젯의 부모를 채운다 — 화면 루트 가까이 둘 것.
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { getAccessToken } from '@/shared/api';
import type { CuratedStay } from '@/shared/api/index.schemas';

import {
  BrowseAllButton,
  CuratedStayRow,
  curatedKey,
  useCuratedStays,
} from '@/features/curated-stay';
import { stayKey, useSavedStays } from '@/features/save-stay';
import {
  OtaChoiceSheet,
  useStayOutboundFlow,
  type OutboundQuery,
} from '@/features/stay-outbound';

export interface CuratedStaysSectionProps {
  /** 지역 카탈로그 코드 — 인기 숙소 조회와 전체 보기에 그대로 쓴다. */
  regionCode?: string;
  /** 지역 이름 — 전체 보기(`region`)에만 쓴다(인기 숙소 조회에 이름을 넘기면 빈 목록이다). */
  regionName?: string;
  /** 여행 맥락 — 값이 맞을 때만 아웃바운드 쿼리에 붙는다. */
  trip?: OutboundQuery;
  variant: 'lane' | 'list' | 'sheet';
  /** 생략 = true. */
  showBrowseAll?: boolean;
  title?: string;
  /** 덩어리·줄·제목 testID 앞부분(생략 = `curated-stays`). 카드·하트·전체 보기 testID 는 고정이다. */
  testIDPrefix?: string;
}

// 좌우 여백 — 'lane' 은 이미 여백이 있는 부모 안에서 줄만 화면 끝까지 번지고, 'list'·'sheet' 는 여백 없는
// 부모라 덩어리가 스스로 16 을 둔다. ponytail: 두 갈래뿐 — 배치 화면이 다른 여백을 요구하면 그때 늘린다.
const GUTTER = {
  lane: { row: '-mx-lg', rowContent: 'px-lg', block: '' },
  list: { row: '', rowContent: 'px-lg', block: 'px-lg' },
  sheet: { row: '', rowContent: 'px-lg', block: 'px-lg' },
} as const;

export function CuratedStaysSection({
  regionCode,
  regionName,
  trip,
  variant,
  showBrowseAll = true,
  title,
  testIDPrefix = 'curated-stays',
}: CuratedStaysSectionProps): ReactElement | null {
  const router = useRouter();
  // 렌더 시점 1회 동기 판정(StayDetailPage 선례).
  const isAuthed = getAccessToken() !== null;
  const { items, hidden } = useCuratedStays({ regionCode, isAuthed });
  const { isSaved, save, remove } = useSavedStays({ isAuthed });
  const outbound = useStayOutboundFlow();
  const [pendingStayId, setPendingStayId] = useState<string | null>(null);

  async function handleToggleSave(stay: CuratedStay): Promise<void> {
    const key = curatedKey(stay);
    setPendingStayId(stay.stayId);
    const outcome = isSaved(stayKey(key)) ? await remove(key) : await save(key);
    setPendingStayId(null);
    if (outcome.kind === 'failed' && outcome.reason === 'unauthenticated') {
      router.push('/(auth)/login');
    }
  }

  if (hidden && !showBrowseAll) {
    return null;
  }

  const gutter = GUTTER[variant];
  return (
    <>
      <View testID={testIDPrefix} className="w-full gap-md">
        {!hidden && title ? (
          <Text
            testID={`${testIDPrefix}-title`}
            className={`font-noto-bold text-card-title font-bold text-ink ${gutter.block}`}
          >
            {title}
          </Text>
        ) : null}
        {!hidden ? (
          <CuratedStayRow
            testID={`${testIDPrefix}-row`}
            items={items}
            isSaved={(stay) => isSaved(stayKey(curatedKey(stay)))}
            pendingStayId={pendingStayId}
            onPressCard={(stay) =>
              outbound.request(
                {
                  kind: 'stay',
                  stayId: stay.stayId,
                  source: curatedKey(stay).externalSource,
                },
                trip
              )
            }
            onToggleSave={(stay) => void handleToggleSave(stay)}
            className={gutter.row}
            contentPaddingClassName={gutter.rowContent}
          />
        ) : null}
        {showBrowseAll ? (
          <View className={gutter.block}>
            <BrowseAllButton
              onPress={() =>
                outbound.request(
                  { kind: 'browse', region: regionName, regionCode },
                  trip
                )
              }
            />
          </View>
        ) : null}
      </View>
      {/* 시트는 덩어리 View 밖 형제 — gorhom 시트(포털 없음)는 부모를 채우므로, 소비처는 이 위젯을 스크롤 안에
          두면 시트가 스크롤 내용 안에 갇힌다(배치 티켓 6-b 확인 몫). */}
      {outbound.sheetProps !== null ? (
        <OtaChoiceSheet {...outbound.sheetProps} />
      ) : null}
    </>
  );
}
