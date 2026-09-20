import { Fragment } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';

/**
 * TRIP-783 · 시트 헤더(widgets · presentation-only). 소비처가 `title·dayLabel·dateLabel·meta` 4문자열을
 * 조립해 주입한다 — 합산(`N곳 · X.Xkm`)·날짜 포맷은 셸을 순수하게 유지하려 소비처(페이지/픽스처) 몫이다
 * (01b Q3). 각 leaf 는 값 하나만 담아 `toHaveTextContent` 완전일치로 잠긴다 — 가운뎃점 구분자는 testID
 * 없는 별도 Text 라 어느 leaf 의 값에도 안 섞인다.
 *
 * TRIP-790 · D5 — **빈 문자열 세그먼트와 그 구분자를 안 그린다.** h07 헤더는 2세그("1일차 완성 ·
 * 6월 10일(수)")라 `dateLabel=""` 이 온다. 3세그를 항상 그리면 빈 date leaf + 꼬리 구분자("· ·")가
 * 생기므로, 비어있지 않은 세그먼트만 골라 그 사이에만 구분자를 끼운다(비어있으면 leaf 도 구분자도 없음).
 */

export interface SheetHeaderProps {
  title: string;
  dayLabel: string;
  dateLabel: string;
  meta: string;
}

export function SheetHeader({
  title,
  dayLabel,
  dateLabel,
  meta,
}: SheetHeaderProps): ReactElement {
  // 비어있지 않은 세그먼트만 남긴다 — 순서(title→day→date)는 유지. 빈 값은 leaf 도, 앞 구분자도 안 뜬다.
  const segments = [
    { testID: 'sheet-header-title', value: title },
    { testID: 'sheet-header-day', value: dayLabel },
    { testID: 'sheet-header-date', value: dateLabel },
  ].filter((segment) => segment.value !== '');

  return (
    <View
      testID="sheet-header-root"
      className="flex-row items-start justify-between gap-sm px-lg pb-md pt-sm"
    >
      <View className="flex-1 flex-row flex-wrap items-center gap-[6px]">
        {segments.map((segment, index) => (
          <Fragment key={segment.testID}>
            {/* 구분자는 세그먼트 **사이**에만(첫 세그 앞엔 없음) → 남은 세그 개수-1 개가 뜬다. */}
            {index > 0 ? (
              <Text className="font-noto-bold text-card-title font-bold text-ink">
                ·
              </Text>
            ) : null}
            <Text
              testID={segment.testID}
              className="font-noto-bold text-card-title font-bold text-ink"
            >
              {segment.value}
            </Text>
          </Fragment>
        ))}
      </View>
      <Text
        testID="sheet-header-meta"
        className="font-noto text-label text-muted"
      >
        {meta}
      </Text>
    </View>
  );
}
