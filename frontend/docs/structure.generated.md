<!-- 자동 생성 — structure-index.cjs --write 가 만든다. 손으로 고치지 마라(다음 --write가 덮는다).
     기계 담당 절반: 파일 목록·export 심볼. 용도·경고·재사용 근거 같은 사람 담당은 structure.md 에. -->
# 구조 인벤토리 (자동 생성)

## __mocks__/@gorhom/
- `__mocks__/@gorhom/bottom-sheet.tsx`  →  BottomSheet · BottomSheetModal · BottomSheetView · BottomSheetModalProvider · BottomSheetBackdrop · BottomSheetScrollView · BottomSheetFlatList · BottomSheetTextInput · useBottomSheetModal

## __mocks__/@mj-studio/
- `__mocks__/@mj-studio/react-native-naver-map.tsx`  →  NaverMapView · NaverMapMarkerOverlay · NaverMapPathOverlay · NaverMapCircleOverlay

## __mocks__/
- `__mocks__/expo-notifications.ts`  →  getPermissionsAsync · requestPermissionsAsync · getExpoPushTokenAsync · setNotificationChannelAsync · AndroidImportance
- `__mocks__/react-native-draggable-flatlist.tsx`  →  __dragLog · ScaleDecorator · OpacityDecorator · ShadowDecorator · NestableDraggableFlatList · NestableScrollContainer

## app/(auth)/
- `app/(auth)/_layout.tsx`  →  (export 없음)
- `app/(auth)/login.tsx`  →  (export 없음)

## app/(onboarding)/
- `app/(onboarding)/_layout.tsx`  →  (export 없음)
- `app/(onboarding)/index.tsx`  →  (export 없음)
- `app/(onboarding)/location.tsx`  →  (export 없음)
- `app/(onboarding)/nickname.tsx`  →  (export 없음)
- `app/(onboarding)/pref1.tsx`  →  (export 없음)
- `app/(onboarding)/pref2.tsx`  →  (export 없음)
- `app/(onboarding)/push.tsx`  →  (export 없음)
- `app/(onboarding)/terms.tsx`  →  (export 없음)

## app/(tabs)/
- `app/(tabs)/_layout.tsx`  →  (export 없음)
- `app/(tabs)/explore.tsx`  →  (export 없음)
- `app/(tabs)/index.tsx`  →  (export 없음)
- `app/(tabs)/itinerary.tsx`  →  (export 없음)
- `app/(tabs)/my.tsx`  →  (export 없음)
- `app/(tabs)/records.tsx`  →  (export 없음)

## app/
- `app/+not-found.tsx`  →  (export 없음)

## app/_dev/
- `app/_dev/preview.tsx`  →  MUST_VISIT_THUMBNAILS · PREVIEW_STATES

## app/
- `app/_layout.tsx`  →  (export 없음)

## app/explore/destination/
- `app/explore/destination/[region].tsx`  →  (export 없음)

## app/explore/
- `app/explore/places.tsx`  →  (export 없음)

## app/explore/places/
- `app/explore/places/[poiId].tsx`  →  (export 없음)

## app/explore/
- `app/explore/region.tsx`  →  (export 없음)
- `app/explore/saved-places.tsx`  →  (export 없음)

## app/
- `app/force-update.tsx`  →  (export 없음)
- `app/magazine.tsx`  →  (export 없음)

## app/my/
- `app/my/stays.tsx`  →  (export 없음)

## app/
- `app/notifications.tsx`  →  (export 없음)
- `app/reconsent.tsx`  →  (export 없음)

## app/records/
- `app/records/style.tsx`  →  (export 없음)

## app/settings/
- `app/settings/index.tsx`  →  (export 없음)
- `app/settings/location.tsx`  →  (export 없음)
- `app/settings/notifications.tsx`  →  (export 없음)
- `app/settings/personalization.tsx`  →  (export 없음)
- `app/settings/preferences.tsx`  →  (export 없음)

## app/stays/
- `app/stays/[stayId].tsx`  →  (export 없음)
- `app/stays/index.tsx`  →  (export 없음)
- `app/stays/register.tsx`  →  (export 없음)
- `app/stays/saved.tsx`  →  (export 없음)

## app/terms/
- `app/terms/[termsType].tsx`  →  (export 없음)

## app/trips/[tripId]/
- `app/trips/[tripId]/bases.tsx`  →  (export 없음)

## app/trips/[tripId]/itinerary/copick/
- `app/trips/[tripId]/itinerary/copick/[slotKey].tsx`  →  (export 없음)
- `app/trips/[tripId]/itinerary/copick/complete.tsx`  →  (export 없음)

## app/trips/[tripId]/itinerary/
- `app/trips/[tripId]/itinerary/draft.tsx`  →  (export 없음)
- `app/trips/[tripId]/itinerary/edit.tsx`  →  (export 없음)
- `app/trips/[tripId]/itinerary/generating.tsx`  →  (export 없음)
- `app/trips/[tripId]/itinerary/index.tsx`  →  (export 없음)

## app/trips/[tripId]/itinerary/manual/
- `app/trips/[tripId]/itinerary/manual/add.tsx`  →  (export 없음)
- `app/trips/[tripId]/itinerary/manual/index.tsx`  →  (export 없음)

## app/trips/[tripId]/itinerary/
- `app/trips/[tripId]/itinerary/method.tsx`  →  (export 없음)

## app/trips/[tripId]/itinerary/must-visits/
- `app/trips/[tripId]/itinerary/must-visits/[poiId].tsx`  →  (export 없음)
- `app/trips/[tripId]/itinerary/must-visits/index.tsx`  →  (export 없음)

## app/trips/[tripId]/itinerary/
- `app/trips/[tripId]/itinerary/stay-recommend.tsx`  →  (export 없음)

## app/trips/[tripId]/live/
- `app/trips/[tripId]/live/index.tsx`  →  (export 없음)
- `app/trips/[tripId]/live/location.tsx`  →  (export 없음)

## app/trips/[tripId]/live/place/
- `app/trips/[tripId]/live/place/[poiId].tsx`  →  (export 없음)

## app/trips/[tripId]/planb/
- `app/trips/[tripId]/planb/diff.tsx`  →  (export 없음)
- `app/trips/[tripId]/planb/draft.tsx`  →  (export 없음)
- `app/trips/[tripId]/planb/index.tsx`  →  (export 없음)
- `app/trips/[tripId]/planb/manual.tsx`  →  (export 없음)
- `app/trips/[tripId]/planb/solving.tsx`  →  (export 없음)

## app/trips/[tripId]/records/
- `app/trips/[tripId]/records/add-visit.tsx`  →  (export 없음)
- `app/trips/[tripId]/records/index.tsx`  →  (export 없음)

## app/trips/[tripId]/records/reflection/
- `app/trips/[tripId]/records/reflection/[date].tsx`  →  (export 없음)

## app/trips/[tripId]/records/
- `app/trips/[tripId]/records/share.tsx`  →  (export 없음)
- `app/trips/[tripId]/records/summary.tsx`  →  (export 없음)

## app/trips/new/
- `app/trips/new/_layout.tsx`  →  (export 없음)
- `app/trips/new/step1.tsx`  →  (export 없음)
- `app/trips/new/step2.tsx`  →  (export 없음)

## src/__tests__/
- `src/__tests__/affiliateNoticeOneTruth.integration.test.tsx`  →  (export 없음)
- `src/__tests__/copickHrefRoundTrip.integration.test.tsx`  →  (export 없음)
- `src/__tests__/deletionScopeStructure.test.ts`  →  (export 없음)
- `src/__tests__/design-tokens.test.ts`  →  (export 없음)
- `src/__tests__/destinationRedirectRoute.test.tsx`  →  (export 없음)
- `src/__tests__/devPreviewReleaseGate.test.tsx`  →  (export 없음)
- `src/__tests__/generatingRouteModePassthrough.test.tsx`  →  (export 없음)
- `src/__tests__/importBoundary.test.ts`  →  (export 없음)
- `src/__tests__/importBoundaryLayers.test.ts`  →  (export 없음)
- `src/__tests__/liveHubRoute.test.tsx`  →  (export 없음)
- `src/__tests__/liveLocationRoute.test.tsx`  →  (export 없음)
- `src/__tests__/locationConsentPutBodyOwnership.test.ts`  →  (export 없음)
- `src/__tests__/magazineRoute.test.tsx`  →  (export 없음)
- `src/__tests__/manualRouteFreshPassthrough.test.tsx`  →  (export 없음)
- `src/__tests__/mapBridgeStructure.test.ts`  →  (export 없음)
- `src/__tests__/nicknameMyPageSync.integration.test.tsx`  →  (export 없음)
- `src/__tests__/notFoundRoute.integration.test.tsx`  →  (export 없음)
- `src/__tests__/notFoundRoute.test.tsx`  →  (export 없음)
- `src/__tests__/onboardingEntryGuard.test.tsx`  →  (export 없음)
- `src/__tests__/onboardingPrefRoutes.test.tsx`  →  (export 없음)
- `src/__tests__/openapiContract.test.ts`  →  (export 없음)
- `src/__tests__/placeDetailStubRoute.test.tsx`  →  (export 없음)
- `src/__tests__/planbDiffRoute.test.tsx`  →  (export 없음)
- `src/__tests__/planbManualRoute.test.tsx`  →  (export 없음)
- `src/__tests__/planbRequestRoute.test.tsx`  →  (export 없음)
- `src/__tests__/pressGuardMustVisit.integration.test.tsx`  →  (export 없음)
- `src/__tests__/pressGuardOnboardingPref.test.tsx`  →  (export 없음)
- `src/__tests__/pressGuardOnboardingPush.test.tsx`  →  (export 없음)
- `src/__tests__/pressGuardStaySeeAll.test.tsx`  →  (export 없음)
- `src/__tests__/recordAddVisitFlow.integration.test.tsx`  →  (export 없음)
- `src/__tests__/recordAddVisitRoute.test.tsx`  →  (export 없음)
- `src/__tests__/recordPhotoBinaryGuard.test.ts`  →  (export 없음)
- `src/__tests__/releaseBuildConfig.test.ts`  →  (export 없음)
- `src/__tests__/rootLayout.test.tsx`  →  (export 없음)
- `src/__tests__/rootLayoutQueryProvider.test.tsx`  →  (export 없음)
- `src/__tests__/rootLayoutSafeArea.test.tsx`  →  (export 없음)
- `src/__tests__/rootLayoutToastHost.test.tsx`  →  (export 없음)
- `src/__tests__/shareCardStructure.test.ts`  →  (export 없음)
- `src/__tests__/socialSdkConfigPlugin.test.ts`  →  (export 없음)
- `src/__tests__/socialSdkSecrets.test.ts`  →  (export 없음)
- `src/__tests__/tabsItineraryRoute.test.tsx`  →  (export 없음)
- `src/__tests__/tabsMyRoute.test.tsx`  →  (export 없음)
- `src/__tests__/tabsRecordsRoute.test.tsx`  →  (export 없음)
- `src/__tests__/tabsShell.test.tsx`  →  (export 없음)
- `src/__tests__/termsRoutes.test.tsx`  →  (export 없음)
- `src/__tests__/tripBasesRoute.test.tsx`  →  (export 없음)
- `src/__tests__/tripNightsPeriodOrder.test.tsx`  →  (export 없음)
- `src/__tests__/tripWizardEntryReset.test.tsx`  →  (export 없음)
- `src/__tests__/tripWizardReentryPreserve.test.tsx`  →  (export 없음)

## src/app/entrypoint/
- `src/app/entrypoint/AppProviders.tsx`  →  AppProviders

## src/app/
- `src/app/index.ts`  →  AppProviders · SplashGate

## src/app/model/
- `src/app/model/useAccountBoundaryReset.ts`  →  useAccountBoundaryReset

## src/app/routing/
- `src/app/routing/SplashGate.tsx`  →  SPLASH_MIN_VISIBLE_MS · SplashGate

## src/entities/itinerary-slot/config/
- `src/entities/itinerary-slot/config/altLabel.ts`  →  ALT_LABEL

## src/entities/itinerary-slot/
- `src/entities/itinerary-slot/index.ts`  →  deriveEndsNextDay · normalizeOpeningHours · formatOpeningHoursLabel · buildSlotKey · parseSlotKey · buildStatePins · projectSlotProgress · suggestNextSlotTime · timeBandLabel · VIOLATION_NOTICE · violationLabel · deriveVisitProgress · ReplanSlotRow · CategoryBuildingGlyph · CategoryCupGlyph · CategoryForkKnifeGlyph · CategoryImageGlyph · CategoryShoppingBagGlyph · CategoryTreeGlyph · SlotProgressCard · SlotStopCard

## src/entities/itinerary-slot/lib/
- `src/entities/itinerary-slot/lib/categoryPlaceholder.ts`  →  CategoryPlaceholder · resolveCategoryPlaceholder
- `src/entities/itinerary-slot/lib/endsNextDay.ts`  →  deriveEndsNextDay
- `src/entities/itinerary-slot/lib/normalizeOpeningHours.ts`  →  normalizeOpeningHours
- `src/entities/itinerary-slot/lib/openingHoursLabel.ts`  →  formatOpeningHoursLabel
- `src/entities/itinerary-slot/lib/slotKey.ts`  →  buildSlotKey · ParsedSlotKey · parseSlotKey · SlotKeySet · buildSlotKeys
- `src/entities/itinerary-slot/lib/slotMapPin.ts`  →  SlotProgressState · StatePinInput · toMapPinState · buildStatePins
- `src/entities/itinerary-slot/lib/slotProgress.ts`  →  SlotState · ProjectedSlot · SlotProgressInput · projectSlotProgress
- `src/entities/itinerary-slot/lib/suggestNextSlotTime.ts`  →  suggestNextSlotTime
- `src/entities/itinerary-slot/lib/timeBandLabel.ts`  →  TimeBandLabel · timeBandLabel
- `src/entities/itinerary-slot/lib/violationLabel.ts`  →  VIOLATION_NOTICE · formatViolationMinutes · violationLabel
- `src/entities/itinerary-slot/lib/visitProgress.ts`  →  VisitProgress · deriveVisitProgress

## src/entities/itinerary-slot/model/
- `src/entities/itinerary-slot/model/index.ts`  →  ReplanSlotTone · ReplanSlotVM · PoiCategory

## src/entities/itinerary-slot/ui/
- `src/entities/itinerary-slot/ui/PoiSlotCard.tsx`  →  PoiSlotCardVariant · PoiSlotCardProps · PoiSlotCard
- `src/entities/itinerary-slot/ui/ReplanSlotRow.tsx`  →  ReplanSlotRowProps · ReplanSlotRow
- `src/entities/itinerary-slot/ui/SlotGlyphs.tsx`  →  CategoryPinGlyph · CategoryForkKnifeGlyph · CategoryCupGlyph · CategoryNightGlyph · CategoryTreeGlyph · CategoryShoppingBagGlyph · CategoryBuildingGlyph · CategoryImageGlyph · ChevronRightGlyph · ClockGlyph · LockGlyph · PhotoGlyph · MemoGlyph · CheckGlyph
- `src/entities/itinerary-slot/ui/SlotPhotoPlaceholder.tsx`  →  SlotPhotoPlaceholderProps · SlotPhotoPlaceholder
- `src/entities/itinerary-slot/ui/SlotProgressCard.tsx`  →  SlotProgressCardProps · SlotProgressCard
- `src/entities/itinerary-slot/ui/SlotStopCard.tsx`  →  UNSPECIFIED_CHIP_LABEL · SlotStopCardProps · SlotStopCard

## src/entities/place/
- `src/entities/place/index.ts`  →  formatDistance · legDistance · pickTrendingPlaces · PlaceGridCard · PlaceRailCard · PlaceRowCard · PlaceSubtitle · SlotCandidateCard

## src/entities/place/lib/
- `src/entities/place/lib/formatDistance.ts`  →  formatDistance
- `src/entities/place/lib/legDistance.ts`  →  legDistance
- `src/entities/place/lib/trendingPlaces.ts`  →  pickTrendingPlaces

## src/entities/place/model/
- `src/entities/place/model/index.ts`  →  PlaceCardVM · PoiCategory

## src/entities/place/ui/
- `src/entities/place/ui/PlaceGridCard.tsx`  →  PlaceGridCardProps · PlaceGridCard
- `src/entities/place/ui/PlaceRailCard.tsx`  →  PlaceRailCardProps · PlaceRailCardSave · PlaceRailCard
- `src/entities/place/ui/PlaceRowCard.tsx`  →  PlaceRowCardProps · PlaceRowCard
- `src/entities/place/ui/PlaceSubtitle.tsx`  →  PlaceSubtitleProps · PlaceSubtitle
- `src/entities/place/ui/SlotCandidateCard.tsx`  →  SlotCandidateCardProps · SlotCandidateCard

## src/entities/stay/config/
- `src/entities/stay/config/affiliateNotice.ts`  →  isOtaSource · otaDisplayName · otaConfirmLabel

## src/entities/stay/
- `src/entities/stay/index.ts`  →  isOtaSource · otaConfirmLabel · otaDisplayName · formatPrice · SavedStayCard · StayRecommendCard · StaySearchCard

## src/entities/stay/lib/
- `src/entities/stay/lib/formatPrice.ts`  →  formatPrice

## src/entities/stay/model/
- `src/entities/stay/model/index.ts`  →  StayCardVM · SavedStayCardVM

## src/entities/stay/ui/
- `src/entities/stay/ui/SavedStayCard.tsx`  →  SavedStayCardProps · SavedStayCard
- `src/entities/stay/ui/StayRecommendCard.tsx`  →  StayRecommendCardProps · StayRecommendCard
- `src/entities/stay/ui/StaySearchCard.tsx`  →  StaySearchCardSave · StaySearchCardProps · StaySearchCard

## src/entities/style-analysis/
- `src/entities/style-analysis/index.ts`  →  resolveStyleFace · resolveStyleProgress

## src/entities/style-analysis/lib/
- `src/entities/style-analysis/lib/styleFace.ts`  →  StyleFace · resolveStyleFace
- `src/entities/style-analysis/lib/styleProgress.ts`  →  resolveStyleProgress

## src/entities/trip/
- `src/entities/trip/index.ts`  →  formatDayLabel · formatNightsLabel · nightsCountLabel · nightsLabel · nightsOnlyLabel · formatShareCardPeriod · dayOfWeek · formatBaseNightRange · formatConfirmedDateRange · formatDateRangeWithDow · formatLegendDateRange · formatTripDateRange · formatTripRange · tripDayNumber · classifyTripPhase · isTripOngoing · PastTripRow · TripCard · ChevronRightGlyph

## src/entities/trip/lib/
- `src/entities/trip/lib/formatDayLabel.ts`  →  formatDayLabel
- `src/entities/trip/lib/formatNights.ts`  →  formatNightsLabel · nightsLabel · nightsCountLabel · nightsOnlyLabel
- `src/entities/trip/lib/formatShareCardPeriod.ts`  →  ShareCardPeriodOptions · formatShareCardPeriod
- `src/entities/trip/lib/formatTripPeriod.ts`  →  WEEKDAY_LABELS · dayOfWeek · formatDateRange · formatSectionRange · formatTripRange · formatConfirmedDateRange · formatTripDateRange · formatLegendDateRange · formatDateRangeWithDow · formatBaseNightRange
- `src/entities/trip/lib/tripDayNumber.ts`  →  tripDayNumber
- `src/entities/trip/lib/tripPhase.ts`  →  TripPhase · classifyTripPhase · isTripOngoing

## src/entities/trip/model/
- `src/entities/trip/model/index.ts`  →  MyTripBadge · MyTripCardVM · PastTripCardVM

## src/entities/trip/ui/
- `src/entities/trip/ui/PastTripRow.tsx`  →  PastTripRowProps · PastTripRow
- `src/entities/trip/ui/TripCard.tsx`  →  TripCardProps · TripCard
- `src/entities/trip/ui/TripGlyphs.tsx`  →  ChevronRightGlyph · MoreDotsGlyph · TrashGlyph

## src/features/add-must-visit/
- `src/features/add-must-visit/index.ts`  →  DEFAULT_DWELL_KEY · DWELL_OPTIONS · buildAnytimeMustVisitRequest · buildFixedMustVisitRequest · canSubmitMustVisitTime · mustVisitTimeBlockReason · startTimeLabel · startTimeOptions · tripDayChips

## src/features/add-must-visit/model/
- `src/features/add-must-visit/model/mustVisitTimeForm.ts`  →  DwellKey · MustVisitTimeForm · DWELL_OPTIONS · DEFAULT_DWELL_KEY · tripDayChips · startTimeOptions · startTimeLabel · mustVisitTimeBlockReason · canSubmitMustVisitTime · buildFixedMustVisitRequest · buildAnytimeMustVisitRequest

## src/features/apply-replan/
- `src/features/apply-replan/index.ts`  →  useApplyReplan

## src/features/apply-replan/model/
- `src/features/apply-replan/model/useApplyReplan.ts`  →  useApplyReplan

## src/features/assign-trip-base/
- `src/features/assign-trip-base/index.ts`  →  useAssignBase · useTripBases

## src/features/assign-trip-base/model/
- `src/features/assign-trip-base/model/baseAssignPlan.ts`  →  BaseAssignPlan · planBaseAssign
- `src/features/assign-trip-base/model/useTripBases.ts`  →  useTripBases · useAssignBase

## src/features/attach-visit-media/
- `src/features/attach-visit-media/index.ts`  →  photoAttach · pickPhotoForVisit · useVisitMemo · MemoInline
- `src/features/attach-visit-media/index.view.ts`  →  photoAttach · MemoInline

## src/features/attach-visit-media/model/
- `src/features/attach-visit-media/model/photoAttach.ts`  →  photoAttach
- `src/features/attach-visit-media/model/pickPhotoForVisit.ts`  →  PhotoPickOutcome · pickPhotoForVisit
- `src/features/attach-visit-media/model/useVisitMemo.ts`  →  useVisitMemo

## src/features/attach-visit-media/ui/
- `src/features/attach-visit-media/ui/MemoInline.tsx`  →  MemoInlineProps · MemoInline

## src/features/auth/config/
- `src/features/auth/config/gradients.ts`  →  SPLASH_BACKGROUND_COLORS · SPLASH_BACKGROUND_LOCATIONS · APP_ICON_COLORS · AUTH_ICON_COLORS

## src/features/auth/
- `src/features/auth/index.ts`  →  APP_ICON_COLORS · getGateDestination · waitForGateDestination · useBootstrapGate · AppIconGlyph · AppleLogoGlyph · GoogleIcon · KakaoIcon · NaverIcon · SplashScreen
- `src/features/auth/index.view.ts`  →  APP_ICON_COLORS · waitForGateDestination · AppIconGlyph · AppleLogoGlyph · GoogleIcon · KakaoIcon · NaverIcon · SplashScreen

## src/features/auth/model/
- `src/features/auth/model/gateDestination.ts`  →  publishGateDestination · getGateDestination · waitForGateDestination · resetGateDestination
- `src/features/auth/model/resolveBootstrapDestination.ts`  →  BootstrapDestination · resolveBootstrapDestination
- `src/features/auth/model/useBootstrapGate.ts`  →  BOOTSTRAP_TIMEOUT_MS · useBootstrapGate

## src/features/auth/ui/
- `src/features/auth/ui/AuthGlyphs.tsx`  →  AppIconGlyph · GoogleIcon · AppleLogoGlyph · KakaoIcon · NaverIcon · WarningTriangleGlyph
- `src/features/auth/ui/SplashIllustration.tsx`  →  SplashIllustration
- `src/features/auth/ui/SplashScreen.tsx`  →  SplashScreen

## src/features/check-visit/
- `src/features/check-visit/index.ts`  →  rememberSpontaneousName · useSpontaneousNames · useVisitCheck · deriveVisitStatus · isOptimisticVisit
- `src/features/check-visit/index.view.ts`  →  rememberSpontaneousName · useSpontaneousNames · deriveVisitStatus · isOptimisticVisit

## src/features/check-visit/model/
- `src/features/check-visit/model/spontaneousNames.ts`  →  rememberSpontaneousName · useSpontaneousNames
- `src/features/check-visit/model/useVisitCheck.ts`  →  VisitCheckOutcome · useVisitCheck
- `src/features/check-visit/model/visitStatus.ts`  →  OPTIMISTIC_VISIT_ID_PREFIX · isOptimisticVisit · VisitStatus · deriveVisitStatus

## src/features/create-trip/
- `src/features/create-trip/index.ts`  →  mustVisitFailureNotice · seedMustVisits · nightsSum · validateTripDraft · formatWizardStep · summaryBudget · summaryCompanion · summaryDestinations · summaryPeriod · summaryPreferences · COMPANION_OPTIONS · deriveEndDate · fromEpochDay · minNightsFor · useTripWizardStore · isWizardOrigin · wizardOriginParams

## src/features/create-trip/model/
- `src/features/create-trip/model/mustVisitSeed.ts`  →  MustVisitSeedItem · MUST_VISIT_THUMBNAIL_LIMIT · seedMustVisits · mergeMustVisitSeeds · MustVisitSectionView · resolveMustVisitSection · mustVisitFailureNotice
- `src/features/create-trip/model/tripDraft.ts`  →  TripViolationCode · TripDraft · tripLength · nightsSum · validateTripDraft · toCompanionType
- `src/features/create-trip/model/tripSummary.ts`  →  wizardProgress · formatWizardStep · SummaryLine · PreferenceSummary · summaryDestinations · summaryPeriod · summaryCompanion · summaryPreferences · summaryBudget
- `src/features/create-trip/model/tripWizardStep1.ts`  →  PeriodPresetCode · CompanionCode · PERIOD_PRESETS · COMPANION_OPTIONS · fromEpochDay · presetRange · deriveEndDate
- `src/features/create-trip/model/tripWizardStore.ts`  →  TripWizardField · TripWizardDraft · minNightsFor · useTripWizardStore
- `src/features/create-trip/model/wizardOrigin.ts`  →  WizardOriginParams · wizardOriginParams · isWizardOrigin

## src/features/edit-itinerary/
- `src/features/edit-itinerary/index.ts`  →  buildEditItineraryRequest · addSlot · insertSlotAt · useItineraryEditStore · resolveSlotSwapError · swapSlotPoi · SaveConflictDialog

## src/features/edit-itinerary/model/
- `src/features/edit-itinerary/model/buildEditItineraryRequest.ts`  →  buildEditItineraryRequest
- `src/features/edit-itinerary/model/itineraryEditStore.ts`  →  EditorSlot · EditorDaysItem · removeSlot · addSlot · insertSlotAt · reorderKeepingFixed · ItineraryEditState · useItineraryEditStore
- `src/features/edit-itinerary/model/slotSwapError.ts`  →  SLOT_SWAP_CONFLICT_CODES · SlotSwapErrorKind · SlotSwapError · resolveSlotSwapError
- `src/features/edit-itinerary/model/swapSlotPoi.ts`  →  swapSlotPoi

## src/features/edit-itinerary/ui/
- `src/features/edit-itinerary/ui/SaveConflictDialog.tsx`  →  SaveConflictDialog

## src/features/edit-preferences/
- `src/features/edit-preferences/index.ts`  →  buildPreferenceInput · initialSelection · ACTIVITY · STYLE · toPreferenceInput · usePreferenceStore · toggleMulti · toggleSingle

## src/features/edit-preferences/model/
- `src/features/edit-preferences/model/preferenceDraft.ts`  →  PreferenceSelection · initialSelection · buildPreferenceInput
- `src/features/edit-preferences/model/preferenceInput.ts`  →  PreferenceDraftValues · STYLE · ACTIVITY · toPreferenceInput
- `src/features/edit-preferences/model/preferenceSelection.ts`  →  toggleMulti · toggleSingle
- `src/features/edit-preferences/model/preferenceStore.ts`  →  PreferenceDraft · usePreferenceStore

## src/features/execution/
- `src/features/execution/index.ts`  →  useLiveItinerary · BackArrowGlyph · HeroPhotoGlyph · HeroPinGlyph · RailActiveGlyph · RailDoneGlyph · RailUpcomingGlyph · ShareGlyph · WarningFilledGlyph
- `src/features/execution/index.view.ts`  →  BackArrowGlyph · HeroPhotoGlyph · HeroPinGlyph · RailActiveGlyph · RailDoneGlyph · RailUpcomingGlyph · ShareGlyph · WarningFilledGlyph

## src/features/execution/model/
- `src/features/execution/model/dwellMinutes.ts`  →  dwellMinutes
- `src/features/execution/model/nextNav.ts`  →  NavDest · buildAppNavUrl · buildWebNavUrl · resolveNextDest · openNextNav
- `src/features/execution/model/useLiveItinerary.ts`  →  useLiveItinerary

## src/features/execution/ui/
- `src/features/execution/ui/ExecutionGlyphs.tsx`  →  RailDoneGlyph · RailActiveGlyph · RailUpcomingGlyph · BackArrowGlyph · ShareGlyph · WarningFilledGlyph · WeatherCloudGlyph · HeroPinGlyph · HeroPhotoGlyph

## src/features/explore/
- `src/features/explore/index.ts`  →  resolvePlaceListState · regionPickerHref · filterRegions · groupRegionsBySido · regionTint · useRegions · useMultiRegionPlaces · usePlacesInfinite · BackChevronGlyph · CheckCircleFilledGlyph · CheckCircleOutlineGlyph · CircleExclaimGlyph · CloseGlyph · FilterSlidersGlyph · InfoGlyph · MapPinGlyph · PlusGlyph · SearchGlyph · ShareGlyph · SuitcaseGlyph · WarningTriangleGlyph
- `src/features/explore/index.view.ts`  →  resolvePlaceListState · regionPickerHref · filterRegions · groupRegionsBySido · regionTint · useRegions · BackChevronGlyph · CheckCircleFilledGlyph · CheckCircleOutlineGlyph · CircleExclaimGlyph · CloseGlyph · FilterSlidersGlyph · InfoGlyph · MapPinGlyph · PlusGlyph · SearchGlyph · ShareGlyph · SuitcaseGlyph · WarningTriangleGlyph

## src/features/explore/model/
- `src/features/explore/model/mergePlaces.ts`  →  mergePlacesByPoiId
- `src/features/explore/model/placeListState.ts`  →  PlaceListState · resolvePlaceListState
- `src/features/explore/model/placeListView.ts`  →  visiblePlaces
- `src/features/explore/model/regionPickerPurpose.ts`  →  RegionPickerPurpose · regionPickerHref
- `src/features/explore/model/regions.ts`  →  useRegions · filterRegions · limitRegionsWhenEmpty · RegionGroup · groupRegionsBySido · regionTint
- `src/features/explore/model/useMultiRegionPlaces.ts`  →  useMultiRegionPlaces
- `src/features/explore/model/usePlacesInfinite.ts`  →  usePlacesInfinite

## src/features/explore/ui/
- `src/features/explore/ui/ExploreGlyphs.tsx`  →  SuitcaseGlyph · CloseGlyph · PlusGlyph · BackChevronGlyph · ShareGlyph · SearchGlyph · MapPinGlyph · FilterSlidersGlyph · WarningTriangleGlyph · CheckCircleFilledGlyph · CheckCircleOutlineGlyph · CircleExclaimGlyph · InfoGlyph

## src/features/home/
- `src/features/home/index.ts`  →  BackChevronGlyph · BellGlyph · CloseGlyph · HeartFilledGlyph · HeartOutlineGlyph · LocationPinGlyph · MapPinGlyph · PlusGlyph · SearchGlyph · SparkleGlyph · SuitcaseGlyph

## src/features/home/ui/
- `src/features/home/ui/HomeGlyphs.tsx`  →  BellGlyph · SearchGlyph · BackChevronGlyph · SparkleGlyph · LocationPinGlyph · HeartOutlineGlyph · HeartFilledGlyph · PlusGlyph · MapPinGlyph · SuitcaseGlyph · CloseGlyph

## src/features/itinerary/config/
- `src/features/itinerary/config/placeCategoryChips.ts`  →  PlaceCategoryChip · PLACE_CATEGORY_CHIPS

## src/features/itinerary/
- `src/features/itinerary/index.ts`  →  countPickedCoPickSlots · firstCoPickSlotKey · nextCoPickSlotKey · DRAFT_POLL_INTERVAL_MS · buildDraftDayTabs · buildDraftPins · buildGenerationGauge · foldGenerationGauge · formatCoPickDayHeader · formatDraftDayHeader · resolveDraftView · resolveFallbackNotice · resolveShortfallNotice · shouldKeepPollingDraft · MUST_VISIT_NAME_PLACEHOLDER · buildMustVisitPins · fixedTimeLabel · joinMustVisits · resolveMustVisitListView · buildPlanDayTabs · isConfirmLocked · itineraryDestinationHref · resolveItineraryDestination · resolvePlanState · resolveUnplacedNames · isGenerationRunning · useGenerationBusy · AlertCircleGlyph · BackChevronGlyph · CalendarGlyph · CheckCircleGlyph · CheckGlyph · ChevronDownGlyph · ChevronRightGlyph · ClockGlyph · CloseGlyph · CoPickGlyph · DashGlyph · DiamondGlyph · FullAiGlyph · InfoCircleGlyph · LinkChevronGlyph · LocationOffGlyph · LockGlyph · ManualGlyph · PencilGlyph · PlusGlyph · SortCheckGlyph · WarningTriangleGlyph · PlaceAddHeader · PlaceAddRow · UnplacedMustVisitNotice
- `src/features/itinerary/index.view.ts`  →  countPickedCoPickSlots · firstCoPickSlotKey · nextCoPickSlotKey · DRAFT_POLL_INTERVAL_MS · buildDraftDayTabs · buildDraftPins · buildGenerationGauge · foldGenerationGauge · formatCoPickDayHeader · formatDraftDayHeader · resolveDraftView · resolveFallbackNotice · resolveShortfallNotice · shouldKeepPollingDraft · MUST_VISIT_NAME_PLACEHOLDER · buildMustVisitPins · fixedTimeLabel · joinMustVisits · resolveMustVisitListView · buildPlanDayTabs · isConfirmLocked · itineraryDestinationHref · resolveItineraryDestination · resolvePlanState · resolveUnplacedNames · AlertCircleGlyph · BackChevronGlyph · CalendarGlyph · CheckCircleGlyph · CheckGlyph · ChevronDownGlyph · ChevronRightGlyph · ClockGlyph · CloseGlyph · CoPickGlyph · DashGlyph · DiamondGlyph · FullAiGlyph · InfoCircleGlyph · LinkChevronGlyph · LocationOffGlyph · LockGlyph · ManualGlyph · PencilGlyph · PlusGlyph · SortCheckGlyph · WarningTriangleGlyph · PlaceAddHeader · PlaceAddRow · UnplacedMustVisitNotice

## src/features/itinerary/model/
- `src/features/itinerary/model/coPickSlots.ts`  →  firstCoPickSlotKey · nextCoPickSlotKey · countPickedCoPickSlots
- `src/features/itinerary/model/draftView.ts`  →  DRAFT_POLL_INTERVAL_MS · DRAFT_POLL_MAX_COUNT · DraftDayTab · buildDraftDayTabs · GenerationDayState · GenerationGaugeCell · buildGenerationGauge · GenerationGaugeFold · FoldedGenerationGaugeCell · foldGenerationGauge · formatDraftDayHeader · formatCoPickDayHeader · DraftPin · buildDraftPins · shouldKeepPollingDraft · DraftView · isCandidatesDemoted · FallbackNotice · resolveFallbackNotice · resolveShortfallNotice · resolveDraftView
- `src/features/itinerary/model/mustVisitList.ts`  →  MUST_VISIT_NAME_PLACEHOLDER · MustVisitListItem · MustVisitListView · joinMustVisits · fixedTimeLabel · buildMustVisitPins · resolveMustVisitListView
- `src/features/itinerary/model/planState.ts`  →  PlanState · PlanDayTab · resolvePlanState · isConfirmLocked · ItineraryDestination · resolveItineraryDestination · ItineraryDestinationHref · itineraryDestinationHref · buildPlanDayTabs
- `src/features/itinerary/model/unplacedMustVisits.ts`  →  UnplacedMustVisitRow · resolveUnplacedNames
- `src/features/itinerary/model/useGenerationBusy.ts`  →  isGenerationRunning · GenerationBusy · useGenerationBusy

## src/features/itinerary/ui/
- `src/features/itinerary/ui/ItineraryGlyphs.tsx`  →  BackChevronGlyph · LockGlyph · DragHandleGlyph · PlusGlyph · CheckGlyph · SortCheckGlyph · DashGlyph · DiamondGlyph · CheckCircleGlyph · PencilGlyph · SearchGlyph · CloseGlyph · ClockGlyph · CalendarGlyph · ChevronDownGlyph · ChevronRightGlyph · LinkChevronGlyph · LocationOffGlyph · CircleGlyphTone · InfoCircleGlyph · AlertCircleGlyph · WarningTriangleGlyph · ShareGlyph · WalkGlyph · CarGlyph · ExpandGlyph · RefreshGlyph · FullAiGlyph · CoPickGlyph · ManualGlyph
- `src/features/itinerary/ui/PlaceAddScreen.tsx`  →  PlaceAddHeaderProps · PlaceAddHeader · PlaceAddRowProps · PlaceAddRow
- `src/features/itinerary/ui/UnplacedMustVisitNotice.tsx`  →  UnplacedMustVisitNotice

## src/features/notification/
- `src/features/notification/index.ts`  →  NotifBackChevronGlyph · NotifInfoGlyph · NotifWarningGlyph

## src/features/notification/ui/
- `src/features/notification/ui/NotificationGlyphs.tsx`  →  NotifBackChevronGlyph · NotifInfoGlyph · NotifWarningGlyph

## src/features/onboarding/
- `src/features/onboarding/index.ts`  →  resolveOnboardingStep · termsDocumentTitle · useOnboardingProgress · ActivityGlyph · ArtGlyph · BackChevronGlyph · BalanceGlyph · BikeGlyph · CameraGlyph · CarGlyph · CheckGlyph · FamilyGlyph · ForkKnifeGlyph · FriendsGlyph · HeartGlyph · InfoCircleGlyph · LightningGlyph · MoonGlyph · MountainGlyph · ParentsGlyph · PetGlyph · PositiveCheckGlyph · RegenerateGlyph · ShoppingBagGlyph · SkipChevronGlyph · SoloPersonGlyph · SunGlyph · TaxiGlyph · TransitGlyph · ViewChevronGlyph · WalkGlyph

## src/features/onboarding/model/
- `src/features/onboarding/model/resolveOnboardingStep.ts`  →  OnboardingStep · OnboardingProgress · resolveOnboardingStep
- `src/features/onboarding/model/termsDocumentTitle.ts`  →  termsDocumentTitle
- `src/features/onboarding/model/useOnboardingProgress.ts`  →  useOnboardingProgress

## src/features/onboarding/ui/
- `src/features/onboarding/ui/OnboardingGlyphs.tsx`  →  BackChevronGlyph · CheckGlyph · ViewChevronGlyph · RegenerateGlyph · PositiveCheckGlyph · GlyphComponent · SunGlyph · ForkKnifeGlyph · MountainGlyph · ArtGlyph · ActivityGlyph · CameraGlyph · ShoppingBagGlyph · MoonGlyph · BalanceGlyph · LightningGlyph · SoloPersonGlyph · FriendsGlyph · HeartGlyph · FamilyGlyph · ParentsGlyph · PetGlyph · WalkGlyph · TransitGlyph · CarGlyph · TaxiGlyph · BikeGlyph · SkipChevronGlyph · InfoCircleGlyph

## src/features/planb/config/
- `src/features/planb/config/watchLabels.ts`  →  WatchKind · WATCH_CATEGORY_LABEL · WATCH_STATUS_LABEL

## src/features/planb/
- `src/features/planb/index.ts`  →  WATCH_CATEGORY_LABEL · WATCH_STATUS_LABEL · appliedSummaryBadges · appliedSummaryInputFromDiff · triggerLabel · triggerPillCopy · useActiveTriggers · AppliedAlertGlyph · RiskWarningGlyph
- `src/features/planb/index.view.ts`  →  WATCH_CATEGORY_LABEL · WATCH_STATUS_LABEL · triggerLabel · triggerPillCopy · AppliedAlertGlyph · RiskWarningGlyph

## src/features/planb/model/
- `src/features/planb/model/appliedSummary.ts`  →  AppliedSummaryInput · appliedSummaryInputFromDiff · appliedSummaryBadges
- `src/features/planb/model/slackTime.ts`  →  slackTime
- `src/features/planb/model/triggerLabel.ts`  →  TriggerLabel · TRIGGER_LABELS · triggerLabel
- `src/features/planb/model/triggerPillCopy.ts`  →  TriggerPillSlot · triggerPillCopy
- `src/features/planb/model/useActiveTriggers.ts`  →  useActiveTriggers
- `src/features/planb/model/useSlotCandidates.ts`  →  useSlotCandidates

## src/features/planb/ui/
- `src/features/planb/ui/PlanbGlyphs.tsx`  →  AppliedAlertGlyph · RiskWarningGlyph · ChevronRightGlyph · LockGlyph
- `src/features/planb/ui/SlotCandidateSheet.tsx`  →  SlotCandidateSheetProps · SlotCandidateSheet

## src/features/record/
- `src/features/record/index.ts`  →  BackArrowGlyph · CalendarGlyph · ChevronDownGlyph · ChevronRightGlyph · CloseGlyph · GpsOffGlyph · InfoCircleGlyph · LegendChevronGlyph · NoteGlyph · PlusGlyph · RetryGlyph · VisitCheckActiveGlyph · VisitCheckDoneGlyph · VisitCheckSkippedGlyph · VisitCheckUpcomingGlyph · WarningTriangleGlyph

## src/features/record/model/
- `src/features/record/model/conflict.ts`  →  ConflictChoice · ConflictSelection · ConflictRow · ConflictVisitVM · isVisitConflict

## src/features/record/ui/
- `src/features/record/ui/RecordGlyphs.tsx`  →  VisitCheckDoneGlyph · VisitCheckActiveGlyph · VisitCheckUpcomingGlyph · VisitCheckSkippedGlyph · PlusGlyph · NoteGlyph · WarningTriangleGlyph · RetryGlyph · BackArrowGlyph · ChevronRightGlyph · LegendChevronGlyph · ChevronDownGlyph · InfoCircleGlyph · GpsOffGlyph · CalendarGlyph · CloseGlyph

## src/features/reflection/
- `src/features/reflection/index.ts`  →  formatKm · CAPTION_MAX_LENGTH · HASHTAG_MAX_COUNT · SHARE_FORMATS · buildShareCard · formatShareCardStats · validateCaption · validateHashtags · summaryStats · daySubtitle · distanceSourceLabel · resolveSummaryView · shareEnabled · toOrderedVisitList · useTripSummary · BackArrowGlyph · EmptyCircleGlyph · LocationOffGlyph · PhotoOffGlyph · RetryGlyph
- `src/features/reflection/index.view.ts`  →  formatKm · CAPTION_MAX_LENGTH · HASHTAG_MAX_COUNT · SHARE_FORMATS · buildShareCard · formatShareCardStats · validateCaption · validateHashtags · summaryStats · daySubtitle · distanceSourceLabel · resolveSummaryView · shareEnabled · toOrderedVisitList · BackArrowGlyph · EmptyCircleGlyph · LocationOffGlyph · PhotoOffGlyph · RetryGlyph

## src/features/reflection/model/
- `src/features/reflection/model/formatKm.ts`  →  formatKm
- `src/features/reflection/model/shareCard.ts`  →  ShareFormat · SHARE_FORMATS · ShareCardMode · ShareCardVM · BuildShareCardInput · buildShareCard · formatShareCardStats · CAPTION_MAX_LENGTH · HASHTAG_MAX_COUNT · validateCaption · validateHashtags
- `src/features/reflection/model/summaryStats.ts`  →  SummaryStatCells · summaryStats
- `src/features/reflection/model/summaryView.ts`  →  OrderedVisit · shareEnabled · resolveSummaryView · toOrderedVisitList · distanceSourceLabel · daySubtitle
- `src/features/reflection/model/useTripSummary.ts`  →  UseTripSummaryResult · useTripSummary

## src/features/reflection/ui/
- `src/features/reflection/ui/ReflectionGlyphs.tsx`  →  BackArrowGlyph · LocationOffGlyph · PhotoOffGlyph · EmptyCircleGlyph · RetryGlyph · MoodSadGlyph · MoodSosoGlyph · MoodGoodGlyph

## src/features/request-replan/
- `src/features/request-replan/index.ts`  →  useReplanFormStore · deriveReplanMapAnchor · buildGpsOrigin · buildManualOrigin · isEstimatedOrigin · buildStartReplanRequest · REPLAN_SCOPES · useStartReplan
- `src/features/request-replan/index.view.ts`  →  useReplanFormStore · deriveReplanMapAnchor · buildGpsOrigin · buildManualOrigin · isEstimatedOrigin · buildStartReplanRequest · REPLAN_SCOPES

## src/features/request-replan/model/
- `src/features/request-replan/model/replanFormStore.ts`  →  ReplanFormState · useReplanFormStore
- `src/features/request-replan/model/replanMapCenter.ts`  →  REPLAN_MAP_FALLBACK_CENTER · deriveReplanMapAnchor
- `src/features/request-replan/model/replanOrigin.ts`  →  ReplanOrigin · buildManualOrigin · buildGpsOrigin · isEstimatedOrigin
- `src/features/request-replan/model/replanRequest.ts`  →  ReplanFormValues · buildStartReplanRequest
- `src/features/request-replan/model/replanScope.ts`  →  ReplanScopeOption · REPLAN_SCOPES · DEFAULT_REPLAN_SCOPE
- `src/features/request-replan/model/useStartReplan.ts`  →  useStartReplan

## src/features/save-place/
- `src/features/save-place/index.ts`  →  COORD_BLOCKED_NOTICE · REMOVE_FAILURE_NOTICE · SAVE_FAILURE_NOTICE · hasUsableCoords · usePlaceSaveToggle · optimisticSavedPlaceId · useSavedPlaces
- `src/features/save-place/index.view.ts`  →  COORD_BLOCKED_NOTICE · REMOVE_FAILURE_NOTICE · SAVE_FAILURE_NOTICE · hasUsableCoords · usePlaceSaveToggle · optimisticSavedPlaceId

## src/features/save-place/model/
- `src/features/save-place/model/placeSaveGuard.ts`  →  PlaceSaveNotice · hasUsableCoords · SAVE_FAILURE_NOTICE · COORD_BLOCKED_NOTICE · REMOVE_FAILURE_NOTICE
- `src/features/save-place/model/placeSaveToggle.ts`  →  usePlaceSaveToggle
- `src/features/save-place/model/savedPlaceIndex.ts`  →  findSavedPlaceId · optimisticSavedPlaceId
- `src/features/save-place/model/savedPlaces.ts`  →  SavedPlacesFailureReason · SavedPlacesOutcome · useSavedPlaces

## src/features/save-stay/
- `src/features/save-stay/index.ts`  →  useSavedStays · stayKey
- `src/features/save-stay/index.view.ts`  →  stayKey

## src/features/save-stay/model/
- `src/features/save-stay/model/buildSaveStayRequest.ts`  →  buildSaveStayRequest
- `src/features/save-stay/model/savedStayIndex.ts`  →  findSavedStayId · optimisticSavedStayId
- `src/features/save-stay/model/savedStays.ts`  →  SavedStaysFailureReason · SavedStaysOutcome · useSavedStays
- `src/features/save-stay/model/stayKey.ts`  →  stayKey

## src/features/settings/
- `src/features/settings/index.ts`  →  BarChartGlyph · BedGlyph · BellGlyph · ChevronLeftGlyph · ChevronRightGlyph · ContrastGlyph · DocumentGlyph · DownloadGlyph · ExternalLinkGlyph · EyeOffGlyph · GearGlyph · ListGlyph · LogoutGlyph · MUTED · MUTED_SOFT · MenuBedGlyph · PersonGlyph · PinGlyph · ShareNodesGlyph · SparkleGlyph · TrashGlyph · CARD_SHADOW

## src/features/settings/ui/
- `src/features/settings/ui/BaseToggleDialog.tsx`  →  BaseToggleDialog
- `src/features/settings/ui/SettingsGlyphs.tsx`  →  MUTED · MUTED_SOFT · ChevronRightGlyph · BookmarkGlyph · BarChartGlyph · ShareNodesGlyph · ListGlyph · EyeOffGlyph · GearGlyph · PencilGlyph · HeartGlyph · ChevronLeftGlyph · PersonGlyph · DownloadGlyph · ContrastGlyph · PinGlyph · BellGlyph · SparkleGlyph · ExternalLinkGlyph · BedGlyph · MenuBedGlyph · TrashGlyph · DocumentGlyph · LogoutGlyph
- `src/features/settings/ui/cardShadow.ts`  →  CARD_SHADOW

## src/features/share-trip-card/
- `src/features/share-trip-card/index.ts`  →  isShareCaptureArmed · saveShareCardImage · shareShareCardImage

## src/features/share-trip-card/model/
- `src/features/share-trip-card/model/shareCapture.ts`  →  SaveShareCardResult · ShareShareCardResult · isShareCaptureArmed · saveShareCardImage · shareShareCardImage
- `src/features/share-trip-card/model/shareCaptureNative.ts`  →  captureRef · requestPermissionsAsync · saveToLibraryAsync · shareAsync

## src/features/stay/
- `src/features/stay/index.ts`  →  useStaySearch · AmenityGlyph · BackChevronGlyph · BedGlyph · BreakfastGlyph · CheckGlyph · ChevronDownGlyph · ChevronRightGlyph · ExternalLinkGlyph · FilterSlidersGlyph · HeartFilledGlyph · HeartOutlineGlyph · InfoGlyph · MapPinGlyph · OceanViewGlyph · ParkingGlyph · PlusGlyph · RefreshGlyph · SearchGlyph · ShareGlyph · WarningTriangleGlyph · WifiGlyph
- `src/features/stay/index.view.ts`  →  AmenityGlyph · BackChevronGlyph · BedGlyph · BreakfastGlyph · CheckGlyph · ChevronDownGlyph · ChevronRightGlyph · ExternalLinkGlyph · FilterSlidersGlyph · HeartFilledGlyph · HeartOutlineGlyph · InfoGlyph · MapPinGlyph · OceanViewGlyph · ParkingGlyph · PlusGlyph · RefreshGlyph · SearchGlyph · ShareGlyph · WarningTriangleGlyph · WifiGlyph

## src/features/stay/model/
- `src/features/stay/model/useStaySearch.ts`  →  useStaySearch

## src/features/stay/ui/
- `src/features/stay/ui/StayGlyphs.tsx`  →  BackChevronGlyph · ChevronDownGlyph · FilterSlidersGlyph · WarningTriangleGlyph · MapPinGlyph · SearchGlyph · PlusGlyph · ChevronRightGlyph · HeartOutlineGlyph · ShareGlyph · InfoGlyph · BedGlyph · CheckGlyph · RefreshGlyph · ExternalLinkGlyph · AmenityGlyph · ParkingGlyph · BreakfastGlyph · WifiGlyph · OceanViewGlyph · HeartFilledGlyph

## src/features/trip/
- `src/features/trip/index.ts`  →  SHEET_HANDLE_INDICATOR_STYLE · addressInRegion · placeLocationLabel · regionCodeInTrip · sidoKey · sigunguLabel · useSavedStays · AlertCircleGlyph · BackChevronGlyph · BedGlyph · CheckGlyph · ChevronRightGlyph · FamilyGlyph · FriendsGlyph · GlobeGlyph · HeartGlyph · PlusGlyph · RemoveGlyph · SearchGlyph · SoloGlyph · SparkleGlyph · StepperMinusGlyph · StepperPlusGlyph · WarningTriangleGlyph
- `src/features/trip/index.view.ts`  →  SHEET_HANDLE_INDICATOR_STYLE · addressInRegion · placeLocationLabel · regionCodeInTrip · sidoKey · sigunguLabel · AlertCircleGlyph · BackChevronGlyph · BedGlyph · CheckGlyph · ChevronRightGlyph · FamilyGlyph · FriendsGlyph · GlobeGlyph · HeartGlyph · PlusGlyph · RemoveGlyph · SearchGlyph · SoloGlyph · SparkleGlyph · StepperMinusGlyph · StepperPlusGlyph · WarningTriangleGlyph

## src/features/trip/lib/
- `src/features/trip/lib/sheetHandle.ts`  →  SHEET_HANDLE_INDICATOR_STYLE

## src/features/trip/model/
- `src/features/trip/model/baseScreen.ts`  →  UnresolvedDaysView · unresolvedDaysView
- `src/features/trip/model/regionMatch.ts`  →  sidoKey · addressInRegion · regionCodeInTrip · placeLocationLabel · sigunguLabel
- `src/features/trip/model/useSavedStays.ts`  →  useSavedStays

## src/features/trip/ui/
- `src/features/trip/ui/TripGlyphs.tsx`  →  GlyphComponent · BackChevronGlyph · PinGlyph · RemoveGlyph · ThumbRemoveGlyph · PlusGlyph · CalendarGlyph · ChevronDownGlyph · StepperMinusGlyph · StepperPlusGlyph · SoloGlyph · FriendsGlyph · HeartGlyph · FamilyGlyph · SparkleGlyph · AlertCircleGlyph · GlobeGlyph · BedTone · BedGlyph · ChevronRightGlyph · BaseBadgePinGlyph · HeartFilledGlyph · CheckGlyph · SearchGlyph · WarningTriangleGlyph

## src/mocks/
- `src/mocks/handlers.ts`  →  handlers
- `src/mocks/scenarios.ts`  →  AuthOutcome · SocialServerBehavior · BootstrapBehavior · MockScenario · SCENARIOS · ScenarioKey · setScenario · getScenario · resetScenario
- `src/mocks/server.ts`  →  server

## src/pages/auth/login/config/
- `src/pages/auth/login/config/oauthConfig.ts`  →  OAuthDiscovery · OAuthProviderConfig · getOAuthConfig

## src/pages/auth/login/
- `src/pages/auth/login/index.ts`  →  LoginPage

## src/pages/auth/login/lib/
- `src/pages/auth/login/lib/appleAuthorize.tsx`  →  appleAuthorize · isAppleSignInAvailable · AppleSignInButton
- `src/pages/auth/login/lib/kakaoAuthorize.ts`  →  kakaoAuthorize
- `src/pages/auth/login/lib/makeAuthorize.ts`  →  makeAuthorize
- `src/pages/auth/login/lib/naverAuthorize.ts`  →  naverAuthorize
- `src/pages/auth/login/lib/realAuthorize.ts`  →  realAuthorize

## src/pages/auth/login/model/
- `src/pages/auth/login/model/useAppleButton.ts`  →  useAppleButton
- `src/pages/auth/login/model/useSocialLogin.ts`  →  SocialLoginPhase · AuthorizeResult · Authorize · useSocialLogin

## src/pages/auth/login/ui/
- `src/pages/auth/login/ui/LoginPage.tsx`  →  LoginPage
- `src/pages/auth/login/ui/SocialLoginScreen.tsx`  →  SocialLoginScreenProps · SocialLoginScreen

## src/pages/auth/reconsent/
- `src/pages/auth/reconsent/index.ts`  →  ReconsentPage

## src/pages/auth/reconsent/ui/
- `src/pages/auth/reconsent/ui/ReconsentPage.tsx`  →  ReconsentPage
- `src/pages/auth/reconsent/ui/ReconsentScreen.tsx`  →  ReconsentItemView · ReconsentScreenProps · ReconsentScreen

## src/pages/auth/terms-viewer/
- `src/pages/auth/terms-viewer/index.ts`  →  TermsViewerPage

## src/pages/auth/terms-viewer/model/
- `src/pages/auth/terms-viewer/model/parseTermsMarkdown.ts`  →  Span · Block · parseTermsMarkdown

## src/pages/auth/terms-viewer/ui/
- `src/pages/auth/terms-viewer/ui/TermsViewerPage.tsx`  →  TermsViewerPage
- `src/pages/auth/terms-viewer/ui/TermsViewerScreen.tsx`  →  TermsViewerScreenProps · TermsViewerScreen

## src/pages/explore/explore-landing/
- `src/pages/explore/explore-landing/index.ts`  →  ExploreLandingPage

## src/pages/explore/explore-landing/model/
- `src/pages/explore/explore-landing/model/exploreFixtures.ts`  →  PREVIEW_PLACES · PREVIEW_SAVED_POI_IDS · PREVIEW_SAVED_PLACES · PREVIEW_REGIONS

## src/pages/explore/explore-landing/ui/
- `src/pages/explore/explore-landing/ui/ExploreLandingPage.tsx`  →  ExploreLandingPage
- `src/pages/explore/explore-landing/ui/ExploreLandingScreen.tsx`  →  ExploreLandingScreenProps · ExploreLandingScreen

## src/pages/explore/place-detail/
- `src/pages/explore/place-detail/index.ts`  →  PlaceDetailPage

## src/pages/explore/place-detail/ui/
- `src/pages/explore/place-detail/ui/PlaceDetailPage.tsx`  →  PlaceDetailPage
- `src/pages/explore/place-detail/ui/PlaceDetailScreen.tsx`  →  PlaceDetailScreenProps · PlaceDetailScreen

## src/pages/explore/place-explore/
- `src/pages/explore/place-explore/index.ts`  →  PlaceExplorePage

## src/pages/explore/place-explore/model/
- `src/pages/explore/place-explore/model/regionChipLabel.ts`  →  formatRegionChipLabel

## src/pages/explore/place-explore/ui/
- `src/pages/explore/place-explore/ui/PartialFailureBanner.tsx`  →  PartialFailureBanner
- `src/pages/explore/place-explore/ui/PlaceExplorePage.tsx`  →  PlaceExplorePage
- `src/pages/explore/place-explore/ui/PlaceExploreScreen.tsx`  →  PlaceExploreScreenProps · PlaceExploreScreen

## src/pages/explore/region-picker/
- `src/pages/explore/region-picker/index.ts`  →  RegionPickerPage

## src/pages/explore/region-picker/ui/
- `src/pages/explore/region-picker/ui/RegionPickerPage.tsx`  →  RegionPickerPage
- `src/pages/explore/region-picker/ui/RegionPickerScreen.tsx`  →  RegionPurpose · RegionPickerScreenProps · RegionPickerScreen

## src/pages/explore/saved-places/
- `src/pages/explore/saved-places/index.ts`  →  SavedPlacesPage

## src/pages/explore/saved-places/model/
- `src/pages/explore/saved-places/model/filterSavedPlacesByTripRegions.ts`  →  filterSavedPlacesByTripRegions
- `src/pages/explore/saved-places/model/savedPlaceList.ts`  →  orderSavedPlaces · SAVED_PLACE_BADGE

## src/pages/explore/saved-places/ui/
- `src/pages/explore/saved-places/ui/MustVisitOutsideConfirmDialog.tsx`  →  MustVisitOutsideConfirmDialog
- `src/pages/explore/saved-places/ui/MustVisitPickScreen.tsx`  →  MustVisitPickScreenProps · MustVisitPickScreen
- `src/pages/explore/saved-places/ui/SavedPlaceListScreen.tsx`  →  SavedPlaceListScreenProps · SavedPlaceListScreen
- `src/pages/explore/saved-places/ui/SavedPlacesPage.tsx`  →  SavedPlacesPage

## src/pages/home/
- `src/pages/home/index.ts`  →  HomePage

## src/pages/home/lib/
- `src/pages/home/lib/formatCountBadge.ts`  →  formatCountBadge

## src/pages/home/model/
- `src/pages/home/model/homeFixtures.ts`  →  HOME_DEFAULT_PROPS · HOME_LOADING_PROPS · HOME_PLANNING_PROPS · HOME_TRAVELING_PROPS · HOME_POST_TRIP_PROPS
- `src/pages/home/model/homePhase.ts`  →  HomeTripInput · ResolveHomePhaseInput · formatDday · resolveHomePhase · HomeItineraryTarget · applyItineraryTarget
- `src/pages/home/model/homeTypes.ts`  →  HomeCollectionCard · HomeSpotCard · HomeSpotsLane · HomeItineraryCard · HomeMagazineHero · HomeSections · TripHeroData · PastTrip · HomeSoftNote · HomePhase · HomeScreenProps

## src/pages/home/ui/
- `src/pages/home/ui/HomePage.tsx`  →  HomePage
- `src/pages/home/ui/HomeScreen.tsx`  →  HomeScreen

## src/pages/itinerary/itinerary-copick/config/
- `src/pages/itinerary/itinerary-copick/config/conceptCards.ts`  →  CONCEPT_DESCRIPTIONS

## src/pages/itinerary/itinerary-copick/
- `src/pages/itinerary/itinerary-copick/index.ts`  →  SlotFillPage · CoPickCompletePage

## src/pages/itinerary/itinerary-copick/model/
- `src/pages/itinerary/itinerary-copick/model/candidateSelection.ts`  →  resolveCandidateSelection
- `src/pages/itinerary/itinerary-copick/model/dayRegion.ts`  →  regionForDay
- `src/pages/itinerary/itinerary-copick/model/radiusUsedLabel.ts`  →  formatRadiusUsed

## src/pages/itinerary/itinerary-copick/ui/
- `src/pages/itinerary/itinerary-copick/ui/CoPickCompletePage.tsx`  →  CoPickCompletePageProps · CoPickCompletePage
- `src/pages/itinerary/itinerary-copick/ui/CoPickLeaveDialog.tsx`  →  CoPickLeaveDialog
- `src/pages/itinerary/itinerary-copick/ui/CoPickStepper.tsx`  →  CoPickStep · CoPickStepperProps · CoPickStepper
- `src/pages/itinerary/itinerary-copick/ui/CoPickStepperGlyphs.tsx`  →  StepperSunGlyph · StepperCheckBadge
- `src/pages/itinerary/itinerary-copick/ui/ConceptPickerScreen.tsx`  →  ConceptProgress · ConceptPickerScreenProps · ConceptPickerScreen
- `src/pages/itinerary/itinerary-copick/ui/SlotCandidateCard.tsx`  →  SlotCandidateCardProps · SlotCandidateCard
- `src/pages/itinerary/itinerary-copick/ui/SlotFillPage.tsx`  →  SlotFillPageProps · SlotFillPage
- `src/pages/itinerary/itinerary-copick/ui/SlotFillScreen.tsx`  →  SlotFillScreenProps · SlotFillScreen

## src/pages/itinerary/itinerary-draft/config/
- `src/pages/itinerary/itinerary-draft/config/generationFallback.ts`  →  GENERATION_FALLBACK_PROGRESS · GENERATION_FALLBACK_TITLE · GENERATION_FALLBACK_MAP_PILL · GENERATION_FALLBACK_MESSAGE_TITLE · GENERATION_FALLBACK_MESSAGE_BODY · GENERATION_FALLBACK_CHECK_ROUTE · GENERATION_FALLBACK_CHECK_SKIPPED · GENERATION_FALLBACK_CHECK_DONE · GENERATION_FALLBACK_VIEW_PLAN · GENERATION_FALLBACK_MANUAL · GENERATION_FALLBACK_FAILED_TITLE · GENERATION_FALLBACK_FAILED_NOTE · GENERATION_FALLBACK_RETRY

## src/pages/itinerary/itinerary-draft/
- `src/pages/itinerary/itinerary-draft/index.ts`  →  DraftPage

## src/pages/itinerary/itinerary-draft/ui/
- `src/pages/itinerary/itinerary-draft/ui/DraftFallbackBanner.tsx`  →  DraftFallbackBanner
- `src/pages/itinerary/itinerary-draft/ui/DraftPage.tsx`  →  DraftPage
- `src/pages/itinerary/itinerary-draft/ui/DraftScreen.tsx`  →  DraftScreenProps · DraftScreen
- `src/pages/itinerary/itinerary-draft/ui/GenerationFallbackScreen.tsx`  →  GenerationFallbackScreenProps · GenerationFallbackScreen
- `src/pages/itinerary/itinerary-draft/ui/SlotCandidatePanelContainer.tsx`  →  SlotCandidatePanelContainerProps · SlotCandidatePanelContainer
- `src/pages/itinerary/itinerary-draft/ui/SlotCandidateSheet.tsx`  →  SlotCandidateSheetRow · SlotCandidateSheetProps · SlotCandidateSheet

## src/pages/itinerary/itinerary-edit/
- `src/pages/itinerary/itinerary-edit/index.ts`  →  ItineraryEditPage

## src/pages/itinerary/itinerary-edit/model/
- `src/pages/itinerary/itinerary-edit/model/reorderKeepingLocked.ts`  →  reorderKeepingLocked

## src/pages/itinerary/itinerary-edit/ui/
- `src/pages/itinerary/itinerary-edit/ui/ItineraryEditPage.tsx`  →  ItineraryEditPage

## src/pages/itinerary/itinerary-generating/
- `src/pages/itinerary/itinerary-generating/index.ts`  →  GeneratingPage

## src/pages/itinerary/itinerary-generating/ui/
- `src/pages/itinerary/itinerary-generating/ui/GeneratingPage.tsx`  →  GeneratingPage
- `src/pages/itinerary/itinerary-generating/ui/GeneratingScreen.tsx`  →  GeneratingScreenProps · GeneratingScreen

## src/pages/itinerary/itinerary-list/
- `src/pages/itinerary/itinerary-list/index.ts`  →  MyTripsListPage

## src/pages/itinerary/itinerary-list/model/
- `src/pages/itinerary/itinerary-list/model/doneBar.ts`  →  DoneBarEntry · DoneBarPick · pickDoneBar
- `src/pages/itinerary/itinerary-list/model/myTripsOrder.ts`  →  MyTripsSortKey · byLatest · byStart · byTitle · parseMyTripsSortKey · orderMyTrips
- `src/pages/itinerary/itinerary-list/model/tripCardFace.ts`  →  TripCardFace · deriveTripCardFace

## src/pages/itinerary/itinerary-list/ui/
- `src/pages/itinerary/itinerary-list/ui/GenerationDoneBar.tsx`  →  GenerationDoneBarProps · GenerationDoneBar
- `src/pages/itinerary/itinerary-list/ui/GenerationDoneBarGlyphs.tsx`  →  DoneCheckGlyph
- `src/pages/itinerary/itinerary-list/ui/MyTripCard.tsx`  →  MyTripCardProps · MyTripCard
- `src/pages/itinerary/itinerary-list/ui/MyTripsListPage.tsx`  →  MyTripsListPage
- `src/pages/itinerary/itinerary-list/ui/MyTripsListScreen.tsx`  →  MyTripsListMode · MyTripsListScreenProps · MyTripsListScreen
- `src/pages/itinerary/itinerary-list/ui/MyTripsSortSheet.tsx`  →  MyTripsSortSheetProps · MyTripsSortSheet
- `src/pages/itinerary/itinerary-list/ui/TripCardContainer.tsx`  →  TripCardContainerProps · TripCardContainer
- `src/pages/itinerary/itinerary-list/ui/TripDeleteDialog.tsx`  →  TripDeleteDialog

## src/pages/itinerary/itinerary-manual/
- `src/pages/itinerary/itinerary-manual/index.ts`  →  ManualPlanPage · PlaceAddPage

## src/pages/itinerary/itinerary-manual/model/
- `src/pages/itinerary/itinerary-manual/model/editorMapCenter.ts`  →  resolveEditorMapCenter

## src/pages/itinerary/itinerary-manual/ui/
- `src/pages/itinerary/itinerary-manual/ui/ManualPlanPage.tsx`  →  ManualPlanPage
- `src/pages/itinerary/itinerary-manual/ui/PlaceAddPage.tsx`  →  PlaceAddPage

## src/pages/itinerary/itinerary-method/config/
- `src/pages/itinerary/itinerary-method/config/methodPicker.ts`  →  METHOD_PROGRESS · METHOD_SUBTITLE · METHOD_SWITCH_NOTE

## src/pages/itinerary/itinerary-method/
- `src/pages/itinerary/itinerary-method/index.ts`  →  ItineraryMethodPage

## src/pages/itinerary/itinerary-method/ui/
- `src/pages/itinerary/itinerary-method/ui/ItineraryMethodPage.tsx`  →  ItineraryMethodPage
- `src/pages/itinerary/itinerary-method/ui/MethodPickerScreen.tsx`  →  ActiveGeneration · MethodPickerScreenProps · MethodPickerScreen

## src/pages/itinerary/itinerary-mustvisit/
- `src/pages/itinerary/itinerary-mustvisit/index.ts`  →  MustVisitListPage · MustVisitTimePage

## src/pages/itinerary/itinerary-mustvisit/ui/
- `src/pages/itinerary/itinerary-mustvisit/ui/MustVisitListPage.tsx`  →  MustVisitListPage
- `src/pages/itinerary/itinerary-mustvisit/ui/MustVisitPickerScreen.tsx`  →  MustVisitPickerScreenProps · MustVisitPickerScreen
- `src/pages/itinerary/itinerary-mustvisit/ui/MustVisitTimePage.tsx`  →  MustVisitTimePage
- `src/pages/itinerary/itinerary-mustvisit/ui/MustVisitTimeScreen.tsx`  →  MustVisitTimeScreenProps · MustVisitTimeScreen

## src/pages/itinerary/itinerary-plan/
- `src/pages/itinerary/itinerary-plan/index.ts`  →  ItineraryPlanPage

## src/pages/itinerary/itinerary-plan/ui/
- `src/pages/itinerary/itinerary-plan/ui/ItineraryPlanPage.tsx`  →  ItineraryPlanPage
- `src/pages/itinerary/itinerary-plan/ui/NoBaseNoticeCard.tsx`  →  NoBaseNoticeCard

## src/pages/itinerary/itinerary-stay-recommend/
- `src/pages/itinerary/itinerary-stay-recommend/index.ts`  →  StayRecommendPage

## src/pages/itinerary/itinerary-stay-recommend/lib/
- `src/pages/itinerary/itinerary-stay-recommend/lib/objectParticle.ts`  →  withObjectParticle

## src/pages/itinerary/itinerary-stay-recommend/model/
- `src/pages/itinerary/itinerary-stay-recommend/model/stayRecommend.ts`  →  StayRecommendCandidate · StayRecommendView

## src/pages/itinerary/itinerary-stay-recommend/ui/
- `src/pages/itinerary/itinerary-stay-recommend/ui/StayRecommendPage.tsx`  →  StayRecommendPageProps · StayRecommendPage
- `src/pages/itinerary/itinerary-stay-recommend/ui/StayRecommendView.tsx`  →  StayRecommendViewProps · StayRecommendView

## src/pages/live/live-itinerary/
- `src/pages/live/live-itinerary/index.ts`  →  LiveItineraryPage

## src/pages/live/live-itinerary/model/
- `src/pages/live/live-itinerary/model/foldScope.ts`  →  foldScope
- `src/pages/live/live-itinerary/model/liveState.ts`  →  LiveState · ResolveLiveStateInput · resolveLiveState
- `src/pages/live/live-itinerary/model/riskAffectedRow.ts`  →  RiskAffectedRow · riskAffectedRow
- `src/pages/live/live-itinerary/model/triggerWatchlist.ts`  →  TriggerWatchlistRow · triggerWatchlist
- `src/pages/live/live-itinerary/model/useVisitCheck.ts`  →  VisitCheckOutcome · useVisitCheck

## src/pages/live/live-itinerary/ui/
- `src/pages/live/live-itinerary/ui/LiveHubView.tsx`  →  LiveHubSlot · LiveHubViewProps · LiveHubView
- `src/pages/live/live-itinerary/ui/LiveItineraryPage.tsx`  →  LiveItineraryPageProps · LiveItineraryPage
- `src/pages/live/live-itinerary/ui/MemoSheet.tsx`  →  MemoSheetProps · MemoSheet
- `src/pages/live/live-itinerary/ui/ReplanAppliedSheet.tsx`  →  AppliedDiffKind · AppliedDiffRow · ReplanAppliedSheetProps · ReplanAppliedSheet
- `src/pages/live/live-itinerary/ui/RiskDetailSheet.tsx`  →  RiskDetailSheetProps · RiskDetailSheet
- `src/pages/live/live-itinerary/ui/TriggerChip.tsx`  →  TriggerChipProps · TriggerChip

## src/pages/live/live-location/
- `src/pages/live/live-location/index.ts`  →  LiveLocationPage

## src/pages/live/live-location/ui/
- `src/pages/live/live-location/ui/LiveLocationPage.tsx`  →  LiveLocationPageProps · LiveLocationPage
- `src/pages/live/live-location/ui/LiveLocationView.tsx`  →  LiveLocationState · LiveLocationViewProps · LiveLocationView

## src/pages/live/live-place/
- `src/pages/live/live-place/index.ts`  →  LivePlacePage

## src/pages/live/live-place/model/
- `src/pages/live/live-place/model/placeDetailView.ts`  →  PlaceDetailView · buildPlaceDetailView · buildPlaceShareMessage
- `src/pages/live/live-place/model/usePlaceDetail.ts`  →  usePlaceDetail

## src/pages/live/live-place/ui/
- `src/pages/live/live-place/ui/LivePlacePage.tsx`  →  LivePlacePageProps · LivePlacePage
- `src/pages/live/live-place/ui/PlaceDetailScreen.tsx`  →  PlaceDetailScreenProps · PlaceDetailScreen

## src/pages/live/planb-diff/
- `src/pages/live/planb-diff/index.ts`  →  PlanbDiffPage

## src/pages/live/planb-diff/model/
- `src/pages/live/planb-diff/model/useCancelReplan.ts`  →  useCancelReplan

## src/pages/live/planb-diff/ui/
- `src/pages/live/planb-diff/ui/PlanbDiffPage.tsx`  →  PlanbDiffPageProps · PlanbDiffPage

## src/pages/live/planb-draft/
- `src/pages/live/planb-draft/index.ts`  →  PlanbSolvingPage · PlanbDraftPage

## src/pages/live/planb-draft/model/
- `src/pages/live/planb-draft/model/replanFromInstant.ts`  →  readFromInstant
- `src/pages/live/planb-draft/model/replanState.ts`  →  ReplanState · resolveReplanState
- `src/pages/live/planb-draft/model/useReplanDiff.ts`  →  useReplanDiff
- `src/pages/live/planb-draft/model/useReplanSession.ts`  →  useReplanSession

## src/pages/live/planb-draft/ui/
- `src/pages/live/planb-draft/ui/PlanbDraftPage.tsx`  →  PlanbDraftPageProps · PlanbDraftPage
- `src/pages/live/planb-draft/ui/PlanbSolvingPage.tsx`  →  PlanbSolvingPageProps · PlanbSolvingPage
- `src/pages/live/planb-draft/ui/ReplanDraftView.tsx`  →  ReplanRemovedVM · ReplanDraftViewProps · ReplanDraftView
- `src/pages/live/planb-draft/ui/ReplanLeaveDialog.tsx`  →  ReplanLeaveDialog
- `src/pages/live/planb-draft/ui/ReplanSolvingView.tsx`  →  ReplanSolvingViewProps · ReplanSolvingView

## src/pages/live/planb-request/config/
- `src/pages/live/planb-request/config/replanChoices.ts`  →  ReplanChoice · REPLAN_REASONS · REPLAN_DIRECTIVES · TRIGGER_REASON_KEY

## src/pages/live/planb-request/
- `src/pages/live/planb-request/index.ts`  →  PlanbRequestPage

## src/pages/live/planb-request/model/
- `src/pages/live/planb-request/model/useReplanGpsOrigin.ts`  →  ReadReplanGpsOrigin · useReplanGpsOrigin

## src/pages/live/planb-request/ui/
- `src/pages/live/planb-request/ui/PlanbRequestPage.tsx`  →  PlanbRequestPageProps · PlanbRequestPage
- `src/pages/live/planb-request/ui/ReplanRequestSheet.tsx`  →  ReplanDetectedChip · ReplanRequestSheetProps · ReplanRequestSheet

## src/pages/magazine/
- `src/pages/magazine/index.ts`  →  MagazinePage

## src/pages/magazine/model/
- `src/pages/magazine/model/magazineFixtures.ts`  →  MAGAZINE_DEFAULT_PROPS
- `src/pages/magazine/model/magazineTypes.ts`  →  MagazineCard · MagazineEditorial · MagazineScreenProps

## src/pages/magazine/ui/
- `src/pages/magazine/ui/MagazinePage.tsx`  →  MagazinePage
- `src/pages/magazine/ui/MagazineScreen.tsx`  →  MagazineScreen

## src/pages/onboarding/onboarding-location/
- `src/pages/onboarding/onboarding-location/index.ts`  →  LocationPage

## src/pages/onboarding/onboarding-location/ui/
- `src/pages/onboarding/onboarding-location/ui/LocationPage.tsx`  →  LocationPage

## src/pages/onboarding/onboarding-nickname/
- `src/pages/onboarding/onboarding-nickname/index.ts`  →  NicknamePage

## src/pages/onboarding/onboarding-nickname/model/
- `src/pages/onboarding/onboarding-nickname/model/useNickname.ts`  →  UseNickname · useNickname
- `src/pages/onboarding/onboarding-nickname/model/validateNicknameFormat.ts`  →  validateNicknameFormat · NICKNAME_MIN_LENGTH · NICKNAME_MAX_LENGTH · type NicknameFormatReason · type NicknameFormatResult

## src/pages/onboarding/onboarding-nickname/ui/
- `src/pages/onboarding/onboarding-nickname/ui/NicknamePage.tsx`  →  NicknamePage
- `src/pages/onboarding/onboarding-nickname/ui/NicknameScreen.tsx`  →  NicknameErrorReason · NicknameScreenProps · NicknameScreen

## src/pages/onboarding/onboarding-pref1/
- `src/pages/onboarding/onboarding-pref1/index.ts`  →  PrefStep1Page

## src/pages/onboarding/onboarding-pref1/ui/
- `src/pages/onboarding/onboarding-pref1/ui/PrefStep1Page.tsx`  →  PrefStep1Page
- `src/pages/onboarding/onboarding-pref1/ui/PrefStep1Screen.tsx`  →  PrefStep1ScreenProps · PrefStep1Screen

## src/pages/onboarding/onboarding-pref2/
- `src/pages/onboarding/onboarding-pref2/index.ts`  →  PrefStep2Page

## src/pages/onboarding/onboarding-pref2/ui/
- `src/pages/onboarding/onboarding-pref2/ui/PrefStep2Page.tsx`  →  PrefStep2Page
- `src/pages/onboarding/onboarding-pref2/ui/PrefStep2Screen.tsx`  →  PrefStep2ScreenProps · PrefStep2Screen

## src/pages/onboarding/onboarding-push/
- `src/pages/onboarding/onboarding-push/index.ts`  →  PushPage

## src/pages/onboarding/onboarding-push/ui/
- `src/pages/onboarding/onboarding-push/ui/PushPage.tsx`  →  PushPage

## src/pages/onboarding/onboarding-terms/
- `src/pages/onboarding/onboarding-terms/index.ts`  →  TermsPage

## src/pages/onboarding/onboarding-terms/model/
- `src/pages/onboarding/onboarding-terms/model/useTermsConsent.ts`  →  UseTermsConsent · useTermsConsent

## src/pages/onboarding/onboarding-terms/ui/
- `src/pages/onboarding/onboarding-terms/ui/TermsPage.tsx`  →  TermsPage
- `src/pages/onboarding/onboarding-terms/ui/TermsScreen.tsx`  →  TermsItemView · TermsScreenProps · TermsScreen

## src/pages/record/daily-reflection/
- `src/pages/record/daily-reflection/index.ts`  →  DailyReflectionPage

## src/pages/record/daily-reflection/model/
- `src/pages/record/daily-reflection/model/editCard.ts`  →  buildEditCard
- `src/pages/record/daily-reflection/model/missingParts.ts`  →  LocationPermissionState · MapNoticeReason · MapNotice · MissingParts · missingParts
- `src/pages/record/daily-reflection/model/reflectionFallback.ts`  →  resolveDisplayNarrative
- `src/pages/record/daily-reflection/model/statsCard.ts`  →  statsCard
- `src/pages/record/daily-reflection/model/useDailyReflection.ts`  →  UseDailyReflectionResult · useDailyReflection

## src/pages/record/daily-reflection/ui/
- `src/pages/record/daily-reflection/ui/ChangeSummaryRow.tsx`  →  ChangeSummaryRowProps · ChangeSummaryRow
- `src/pages/record/daily-reflection/ui/DailyReflectionPage.tsx`  →  DailyReflectionPageProps · DailyReflectionPage
- `src/pages/record/daily-reflection/ui/DailyReflectionScreen.tsx`  →  ReflectionFace · ReflectionDayTab · DailyReflectionScreenProps · DailyReflectionScreen
- `src/pages/record/daily-reflection/ui/NarrativeBlock.tsx`  →  NarrativeBlockProps · NarrativeBlock
- `src/pages/record/daily-reflection/ui/ReflectionPhotoGrid.tsx`  →  ReflectionPhotoGridProps · ReflectionPhotoGrid
- `src/pages/record/daily-reflection/ui/ReflectionStatsRow.tsx`  →  ReflectionStatsRowProps · ReflectionStatsRow

## src/pages/record/record-add-visit/
- `src/pages/record/record-add-visit/index.ts`  →  RecordAddVisitPage

## src/pages/record/record-add-visit/ui/
- `src/pages/record/record-add-visit/ui/RecordAddVisitPage.tsx`  →  RecordAddVisitPage

## src/pages/record/records-calendar/
- `src/pages/record/records-calendar/index.ts`  →  RecordsCalendarPage

## src/pages/record/records-calendar/model/
- `src/pages/record/records-calendar/model/recordsCalendar.ts`  →  markedDaysOfMonth · buildPastTripCards · LegendRow · MonthLegends · buildMonthLegends · canOpenTripRecords · recordsTripIdForDate · openableTripIds · OngoingTripEntry · OngoingTripCardVM · pickOngoingTrip · formatTripDateRange · nightsLabel
- `src/pages/record/records-calendar/model/useRecordsCalendar.ts`  →  useRecordsCalendar

## src/pages/record/records-calendar/ui/
- `src/pages/record/records-calendar/ui/PastTripList.tsx`  →  PastTripListProps · PastTripList
- `src/pages/record/records-calendar/ui/RecordsCalendarPage.tsx`  →  RecordsCalendarPage
- `src/pages/record/records-calendar/ui/RecordsCalendarScreen.tsx`  →  RecordsCalendarScreenProps · RecordsCalendarScreen
- `src/pages/record/records-calendar/ui/TripCalendarMonth.tsx`  →  TripCalendarMonthProps · TripCalendarMonth

## src/pages/record/share-card/
- `src/pages/record/share-card/index.ts`  →  ShareCardPage

## src/pages/record/share-card/ui/
- `src/pages/record/share-card/ui/FormatSegment.tsx`  →  FormatSegmentProps · FormatSegment
- `src/pages/record/share-card/ui/ShareCardGlyphs.tsx`  →  DownloadGlyph · ShareGlyph · WatermarkLogoGlyph
- `src/pages/record/share-card/ui/ShareCardPage.tsx`  →  ShareCardPageProps · ShareCardPage
- `src/pages/record/share-card/ui/ShareCardPreview.tsx`  →  ShareCardPreviewProps · ShareCardPreview
- `src/pages/record/share-card/ui/ShareCardScreen.tsx`  →  ShareCardScreenProps · ShareCardScreen

## src/pages/record/travel-style/
- `src/pages/record/travel-style/index.ts`  →  TravelStylePage

## src/pages/record/travel-style/model/
- `src/pages/record/travel-style/model/styleThreshold.ts`  →  categoryLabel
- `src/pages/record/travel-style/model/useStyleAnalysis.ts`  →  useStyleAnalysis

## src/pages/record/travel-style/ui/
- `src/pages/record/travel-style/ui/CategoryBarList.tsx`  →  CategoryBarListProps · CategoryBarList
- `src/pages/record/travel-style/ui/StatTile.tsx`  →  StatTileProps · StatTile
- `src/pages/record/travel-style/ui/TravelStylePage.tsx`  →  TravelStylePage
- `src/pages/record/travel-style/ui/TravelStyleScreen.tsx`  →  TravelStyleScreenProps · TravelStyleScreen

## src/pages/record/trip-records/
- `src/pages/record/trip-records/index.ts`  →  TripRecordsPage

## src/pages/record/trip-records/model/
- `src/pages/record/trip-records/model/adjustTimesDraft.ts`  →  AdjustTimesViolation · AdjustTimesDraftResult · adjustTimesDraft
- `src/pages/record/trip-records/model/photoAvailability.ts`  →  PhotoAvailability · photoAvailability
- `src/pages/record/trip-records/model/stayAttribution.ts`  →  AttributedStay · DayAttribution · deriveStayAttribution
- `src/pages/record/trip-records/model/useAdjustVisitTimes.ts`  →  VISIT_CONFLICT_NOTICE · AdjustVisitTimesOutcome · useAdjustVisitTimes
- `src/pages/record/trip-records/model/useTripRecords.ts`  →  useTripRecords · useRecordBases · useRecordSavedStays
- `src/pages/record/trip-records/model/useVisitAttachments.ts`  →  useVisitAttachments
- `src/pages/record/trip-records/model/visitOrder.ts`  →  orderByArrival

## src/pages/record/trip-records/ui/
- `src/pages/record/trip-records/ui/PhotoThumbStrip.tsx`  →  PhotoThumbVM · PhotoThumbStripProps · PhotoThumbStrip
- `src/pages/record/trip-records/ui/SkipVisitDialog.tsx`  →  SkipVisitDialog
- `src/pages/record/trip-records/ui/SpontaneousVisitButton.tsx`  →  SpontaneousVisitButtonProps · SpontaneousVisitButton
- `src/pages/record/trip-records/ui/TripRecordsPage.tsx`  →  TripRecordsPageProps · TripRecordsPage
- `src/pages/record/trip-records/ui/TripRecordsView.tsx`  →  TripRecordsDayTab · DayAttributionHeader · RecordPlanRowVM · TripRecordsViewProps · TripRecordsView
- `src/pages/record/trip-records/ui/VisitRecordCard.tsx`  →  VisitRecordCardVM · VisitRecordCardProps · VisitRecordCard
- `src/pages/record/trip-records/ui/VisitRecordCardContainer.tsx`  →  VisitRecordCardContainerProps · VisitRecordCardContainer
- `src/pages/record/trip-records/ui/VisitTimeSheet.tsx`  →  VisitTimeSheetProps · VisitTimeSheet

## src/pages/record/trip-summary/
- `src/pages/record/trip-summary/index.ts`  →  TripSummaryPage

## src/pages/record/trip-summary/ui/
- `src/pages/record/trip-summary/ui/DayHighlightCard.tsx`  →  DayHighlightCardProps · DayHighlightCard
- `src/pages/record/trip-summary/ui/TripSummaryPage.tsx`  →  TripSummaryPageProps · TripSummaryPage
- `src/pages/record/trip-summary/ui/TripSummaryScreen.tsx`  →  SummaryViewMode · DayReflectionVM · DayCardVM · TripSummaryScreenProps · TripSummaryScreen

## src/pages/settings/my-page/
- `src/pages/settings/my-page/index.ts`  →  MyPage

## src/pages/settings/my-page/model/
- `src/pages/settings/my-page/model/styleCardModel.ts`  →  StyleGauge · StyleCardVM · buildStyleCardModel
- `src/pages/settings/my-page/model/tripBuckets.ts`  →  TripBucket · phaseBucket · bucketTrips

## src/pages/settings/my-page/ui/
- `src/pages/settings/my-page/ui/InfoChip.tsx`  →  InfoChip
- `src/pages/settings/my-page/ui/MyPage.tsx`  →  MyPage
- `src/pages/settings/my-page/ui/MyPageScreen.tsx`  →  MyPageScreenProps · MyPageScreen
- `src/pages/settings/my-page/ui/ProfileCard.tsx`  →  ProfileCardCounts · ProfileCardProps · ProfileCard
- `src/pages/settings/my-page/ui/StyleSummaryCard.tsx`  →  StyleSummaryCardProps · StyleSummaryCard

## src/pages/settings/notification-inbox/
- `src/pages/settings/notification-inbox/index.ts`  →  NotificationInboxPage

## src/pages/settings/notification-inbox/model/
- `src/pages/settings/notification-inbox/model/groupByDay.ts`  →  NotificationGroups · groupByDay
- `src/pages/settings/notification-inbox/model/notificationAction.ts`  →  notificationAction
- `src/pages/settings/notification-inbox/model/notificationKind.ts`  →  NotificationIconKind · NotificationKindMeta · notificationKind
- `src/pages/settings/notification-inbox/model/useNotificationInbox.ts`  →  UseNotificationInboxResult · useNotificationInbox

## src/pages/settings/notification-inbox/ui/
- `src/pages/settings/notification-inbox/ui/NotificationInboxGlyphs.tsx`  →  NotificationKindIcon · NotifBellGlyph
- `src/pages/settings/notification-inbox/ui/NotificationInboxPage.tsx`  →  NotificationInboxPage
- `src/pages/settings/notification-inbox/ui/NotificationInboxScreen.tsx`  →  NotificationRowVM · NotificationSection · NotificationInboxScreenProps · NotificationInboxScreen
- `src/pages/settings/notification-inbox/ui/NotificationRow.tsx`  →  NotificationRowProps · NotificationRow

## src/pages/settings/settings-location/
- `src/pages/settings/settings-location/index.ts`  →  LocationConsentPage

## src/pages/settings/settings-location/ui/
- `src/pages/settings/settings-location/ui/LocationConsentPage.tsx`  →  LocationConsentPage
- `src/pages/settings/settings-location/ui/LocationConsentScreen.tsx`  →  LocationConsentScreenProps · LocationConsentScreen
- `src/pages/settings/settings-location/ui/RevokeConfirmDialog.tsx`  →  RevokeConfirmDialog

## src/pages/settings/settings-notifications/
- `src/pages/settings/settings-notifications/index.ts`  →  NotificationSettingsPage

## src/pages/settings/settings-notifications/model/
- `src/pages/settings/settings-notifications/model/channelAvailability.ts`  →  PushPermission · PushColumnState · resolvePushColumn
- `src/pages/settings/settings-notifications/model/useToggles.ts`  →  ToggleChannel · ToggleOutcome · UseTogglesResult · useToggles

## src/pages/settings/settings-notifications/ui/
- `src/pages/settings/settings-notifications/ui/NotificationSettingsPage.tsx`  →  NotificationSettingsPage
- `src/pages/settings/settings-notifications/ui/NotificationSettingsScreen.tsx`  →  ToggleValueMap · NotificationSettingsScreenProps · NotificationSettingsScreen
- `src/pages/settings/settings-notifications/ui/PermissionBanner.tsx`  →  PermissionBanner
- `src/pages/settings/settings-notifications/ui/ToggleRow.tsx`  →  ToggleRowProps · ToggleRow

## src/pages/settings/settings-personalization/
- `src/pages/settings/settings-personalization/index.ts`  →  PersonalizationPage

## src/pages/settings/settings-personalization/model/
- `src/pages/settings/settings-personalization/model/personalizationCopy.ts`  →  personalizationCopy
- `src/pages/settings/settings-personalization/model/usePersonalization.ts`  →  UsePersonalizationResult · usePersonalization

## src/pages/settings/settings-personalization/ui/
- `src/pages/settings/settings-personalization/ui/PersonalizationPage.tsx`  →  PersonalizationPage
- `src/pages/settings/settings-personalization/ui/PersonalizationScreen.tsx`  →  PersonalizationScreenProps · PersonalizationScreen

## src/pages/settings/settings-preferences/
- `src/pages/settings/settings-preferences/index.ts`  →  SettingsPreferencesPage

## src/pages/settings/settings-preferences/model/
- `src/pages/settings/settings-preferences/model/usePreferences.ts`  →  UsePreferencesResult · usePreferences

## src/pages/settings/settings-preferences/ui/
- `src/pages/settings/settings-preferences/ui/PreferencesEditScreen.tsx`  →  PreferencesEditScreen
- `src/pages/settings/settings-preferences/ui/PreferencesEditView.tsx`  →  EditableAxis · isMultiAxis · PreferencesEditViewProps · PreferencesEditView
- `src/pages/settings/settings-preferences/ui/SettingsPreferencesPage.tsx`  →  SettingsPreferencesPage

## src/pages/settings/settings/
- `src/pages/settings/settings/index.ts`  →  SettingsPage

## src/pages/settings/settings/model/
- `src/pages/settings/settings/model/dataAttribution.ts`  →  OSM_COPYRIGHT_URL
- `src/pages/settings/settings/model/deletionScope.ts`  →  DELETION_SCOPE
- `src/pages/settings/settings/model/exportSummary.ts`  →  ExportSummary · resolveExportSummary
- `src/pages/settings/settings/model/preferenceSummary.ts`  →  PreferenceRowKey · PreferenceSummary · summarizePreferences
- `src/pages/settings/settings/model/settingsSections.ts`  →  SettingsInput · SettingsRowChip · SettingsRowVM · SettingsGroupVM · buildSettingsSections · filterReadySettingsSections

## src/pages/settings/settings/ui/
- `src/pages/settings/settings/ui/DeleteAccountDialog.tsx`  →  DeleteAccountDialog
- `src/pages/settings/settings/ui/ExportRow.tsx`  →  ExportRow
- `src/pages/settings/settings/ui/LogoutConfirmDialog.tsx`  →  LogoutConfirmDialog
- `src/pages/settings/settings/ui/NicknameEditRow.tsx`  →  NicknameEditRow
- `src/pages/settings/settings/ui/SettingsGroup.tsx`  →  SettingsGroup
- `src/pages/settings/settings/ui/SettingsPage.tsx`  →  SettingsPage
- `src/pages/settings/settings/ui/SettingsRow.tsx`  →  RowBody · PreparingRow · NavRow
- `src/pages/settings/settings/ui/SettingsScreen.tsx`  →  SettingsScreenProps · SettingsScreen

## src/pages/stay/my-stays/
- `src/pages/stay/my-stays/index.ts`  →  MyStaysPage

## src/pages/stay/my-stays/model/
- `src/pages/stay/my-stays/model/stayTripLink.ts`  →  StayTripLink · buildStayTripLink

## src/pages/stay/my-stays/ui/
- `src/pages/stay/my-stays/ui/MyStaysPage.tsx`  →  MyStaysPage
- `src/pages/stay/my-stays/ui/MyStaysScreen.tsx`  →  MyStayBaseState · MyStayRowVM · MyStaysScreenProps · MyStaysScreen

## src/pages/stay/stay-detail/config/
- `src/pages/stay/stay-detail/config/amenityIcons.ts`  →  resolveAmenityIcon

## src/pages/stay/stay-detail/
- `src/pages/stay/stay-detail/index.ts`  →  StayDetailPage

## src/pages/stay/stay-detail/model/
- `src/pages/stay/stay-detail/model/stayOutbound.ts`  →  StayOutboundMode · stayOutboundMode · openStayOutbound

## src/pages/stay/stay-detail/ui/
- `src/pages/stay/stay-detail/ui/OtaChoiceSheet.tsx`  →  OtaChoiceSheetProps · OtaChoiceSheet
- `src/pages/stay/stay-detail/ui/StayDetailPage.tsx`  →  StayDetailPage
- `src/pages/stay/stay-detail/ui/StayDetailScreen.tsx`  →  StayDetailState · StayDetailScreenProps · StayDetailScreen

## src/pages/stay/stay-register/
- `src/pages/stay/stay-register/index.ts`  →  StayRegisterPage

## src/pages/stay/stay-register/model/
- `src/pages/stay/stay-register/model/stayRegisterForm.ts`  →  StayRegisterTab · StayRegisterFlow · resolveName · canSubmitStayRegister · buildStayRegisterRequest

## src/pages/stay/stay-register/ui/
- `src/pages/stay/stay-register/ui/StayRegisterPage.tsx`  →  StayRegisterPage
- `src/pages/stay/stay-register/ui/StayRegisterScreen.tsx`  →  StayRegisterScreenProps · StayRegisterScreen

## src/pages/stay/stay-saved/
- `src/pages/stay/stay-saved/index.ts`  →  SavedStayPage

## src/pages/stay/stay-saved/ui/
- `src/pages/stay/stay-saved/ui/SavedStayListScreen.tsx`  →  SavedStayFace · SavedStayListScreenProps · SavedStayListScreen
- `src/pages/stay/stay-saved/ui/SavedStayPage.tsx`  →  SavedStayPage

## src/pages/stay/stay-search/
- `src/pages/stay/stay-search/index.ts`  →  StaySearchPage

## src/pages/stay/stay-search/model/
- `src/pages/stay/stay-search/model/filterReasonLabel.ts`  →  filterReasonLabel
- `src/pages/stay/stay-search/model/priceRangeFilter.ts`  →  PriceBucketId · PRICE_BUCKETS · filterByPriceRange
- `src/pages/stay/stay-search/model/relaxCulpritFilter.ts`  →  relaxCulpritFilter
- `src/pages/stay/stay-search/model/stayFilterOptions.ts`  →  StayFilterOption · StayFilterOptions · buildStayFilterOptions · toggleFilterValue · countActiveFilters
- `src/pages/stay/stay-search/model/staySearchState.ts`  →  StaySearchState · resolveStaySearchState

## src/pages/stay/stay-search/ui/
- `src/pages/stay/stay-search/ui/PartialFailureBanner.tsx`  →  PartialFailureBanner
- `src/pages/stay/stay-search/ui/SkeletonList.tsx`  →  SkeletonList
- `src/pages/stay/stay-search/ui/StayFilterSheet.tsx`  →  StayFilterSheetProps · StayFilterSheet
- `src/pages/stay/stay-search/ui/StayPriceSheet.tsx`  →  StayPriceSheetProps · StayPriceSheet
- `src/pages/stay/stay-search/ui/StaySearchPage.tsx`  →  StaySearchPage
- `src/pages/stay/stay-search/ui/StaySearchScreen.tsx`  →  StaySearchScreenProps · StaySearchScreen

## src/pages/trip/trip-new-step1/
- `src/pages/trip/trip-new-step1/index.ts`  →  TripNewStep1Page

## src/pages/trip/trip-new-step1/model/
- `src/pages/trip/trip-new-step1/model/budgetAmount.ts`  →  BudgetAmount · parseBudgetAmount · formatBudgetAmount · BudgetTier · budgetForTier · isBudgetTier · tierForAmount
- `src/pages/trip/trip-new-step1/model/createTripRequest.ts`  →  CreateTripInput · buildCreateTripRequest
- `src/pages/trip/trip-new-step1/model/mustVisitSync.ts`  →  MustVisitSyncPlan · planMustVisitSync
- `src/pages/trip/trip-new-step1/model/tripDatePicker.ts`  →  dateCell · TripDateRange
- `src/pages/trip/trip-new-step1/model/useCreateTrip.ts`  →  useCreateTrip
- `src/pages/trip/trip-new-step1/model/usePreferencePrefill.ts`  →  usePreferencePrefill

## src/pages/trip/trip-new-step1/ui/
- `src/pages/trip/trip-new-step1/ui/BudgetEditSheet.tsx`  →  BudgetEditSheetProps · BudgetEditSheet
- `src/pages/trip/trip-new-step1/ui/CompanionEditSheet.tsx`  →  CompanionEditSheetProps · CompanionEditSheet
- `src/pages/trip/trip-new-step1/ui/DestinationEditSheet.tsx`  →  DestinationEditSheetProps · DestinationEditSheet
- `src/pages/trip/trip-new-step1/ui/PeriodEditSheet.tsx`  →  PeriodEditSheetProps · PeriodEditSheet
- `src/pages/trip/trip-new-step1/ui/PrefOverrideSheet.tsx`  →  PrefOverrideSheetProps · PrefOverrideSheet
- `src/pages/trip/trip-new-step1/ui/TripNewStep1Page.tsx`  →  TripNewStep1PageProps · TripNewStep1Page
- `src/pages/trip/trip-new-step1/ui/TripWizardLeaveDialog.tsx`  →  TripWizardLeaveDialog
- `src/pages/trip/trip-new-step1/ui/TripWizardStep1Screen.tsx`  →  TripWizardStep1ScreenProps · TripWizardStep1Screen

## src/pages/trip/trip-new-step2/
- `src/pages/trip/trip-new-step2/index.ts`  →  TripNewStep2Page · TripBasesPage

## src/pages/trip/trip-new-step2/model/
- `src/pages/trip/trip-new-step2/model/baseSections.ts`  →  BaseSection · toBaseSections · NightlyBaseCard · nightlyBaseCards
- `src/pages/trip/trip-new-step2/model/basesChanged.ts`  →  basesChanged
- `src/pages/trip/trip-new-step2/model/staySheetSections.ts`  →  StayAddressState · StaySheetSection · staySheetSections
- `src/pages/trip/trip-new-step2/model/useStayAddresses.ts`  →  useStayAddresses

## src/pages/trip/trip-new-step2/ui/
- `src/pages/trip/trip-new-step2/ui/BaseRegenerateDialog.tsx`  →  BaseRegenerateDialog
- `src/pages/trip/trip-new-step2/ui/StaySelectSheet.tsx`  →  StaySelectCandidate · StaySelectSection · StaySelectSheetProps · StaySelectSheet
- `src/pages/trip/trip-new-step2/ui/TripBasesPage.tsx`  →  TripBasesPage
- `src/pages/trip/trip-new-step2/ui/TripNewStep2Page.tsx`  →  TripNewStep2Page · BaseNightsFlowProps · BaseNightsFlow
- `src/pages/trip/trip-new-step2/ui/TripWizardStep2Screen.tsx`  →  NightlyBaseCardVM · Step2Variant · TripWizardStep2ScreenProps · TripWizardStep2Screen

## src/shared/api/generated/account/
- `src/shared/api/generated/account/account.ts`  →  getMe · getGetMeQueryKey · getGetMeQueryOptions · GetMeQueryResult · GetMeQueryError · useGetMe · postMeDeletion · getPostMeDeletionMutationOptions · PostMeDeletionMutationResult · PostMeDeletionMutationError · usePostMeDeletion · deleteMeDeletion · getDeleteMeDeletionMutationOptions · DeleteMeDeletionMutationResult · DeleteMeDeletionMutationError · useDeleteMeDeletion · getMeExport · getGetMeExportQueryKey · getGetMeExportQueryOptions · GetMeExportQueryResult · GetMeExportQueryError · useGetMeExport

## src/shared/api/generated/location/
- `src/shared/api/generated/location/location.ts`  →  getMeLocationConsent · getGetMeLocationConsentQueryKey · getGetMeLocationConsentQueryOptions · GetMeLocationConsentQueryResult · GetMeLocationConsentQueryError · useGetMeLocationConsent · putMeLocationConsent · getPutMeLocationConsentMutationOptions · PutMeLocationConsentMutationResult · PutMeLocationConsentMutationBody · PutMeLocationConsentMutationError · usePutMeLocationConsent · patchMeLocationConsentOsPermission · getPatchMeLocationConsentOsPermissionMutationOptions · PatchMeLocationConsentOsPermissionMutationResult · PatchMeLocationConsentOsPermissionMutationBody · PatchMeLocationConsentOsPermissionMutationError · usePatchMeLocationConsentOsPermission

## src/shared/api/generated/notification/
- `src/shared/api/generated/notification/notification.ts`  →  getMeNotificationSettings · getGetMeNotificationSettingsQueryKey · getGetMeNotificationSettingsQueryOptions · GetMeNotificationSettingsQueryResult · GetMeNotificationSettingsQueryError · useGetMeNotificationSettings · patchMeNotificationSettingsKind · getPatchMeNotificationSettingsKindMutationOptions · PatchMeNotificationSettingsKindMutationResult · PatchMeNotificationSettingsKindMutationBody · PatchMeNotificationSettingsKindMutationError · usePatchMeNotificationSettingsKind · getMeNotifications · getGetMeNotificationsQueryKey · getGetMeNotificationsQueryOptions · GetMeNotificationsQueryResult · GetMeNotificationsQueryError · useGetMeNotifications · postMeNotificationsNotificationIdRead · getPostMeNotificationsNotificationIdReadMutationOptions · PostMeNotificationsNotificationIdReadMutationResult · PostMeNotificationsNotificationIdReadMutationError · usePostMeNotificationsNotificationIdRead · postMeNotificationsReadAll · getPostMeNotificationsReadAllMutationOptions · PostMeNotificationsReadAllMutationResult · PostMeNotificationsReadAllMutationError · usePostMeNotificationsReadAll

## src/shared/api/generated/notifications/
- `src/shared/api/generated/notifications/notifications.ts`  →  postMePushTokens · getPostMePushTokensMutationOptions · PostMePushTokensMutationResult · PostMePushTokensMutationBody · PostMePushTokensMutationError · usePostMePushTokens · deleteMePushTokensToken · getDeleteMePushTokensTokenMutationOptions · DeleteMePushTokensTokenMutationResult · DeleteMePushTokensTokenMutationError · useDeleteMePushTokensToken

## src/shared/api/generated/places/
- `src/shared/api/generated/places/places.ts`  →  getRegions · getGetRegionsQueryKey · getGetRegionsQueryOptions · GetRegionsQueryResult · GetRegionsQueryError · useGetRegions · getPlaces · getGetPlacesQueryKey · getGetPlacesQueryOptions · GetPlacesQueryResult · GetPlacesQueryError · useGetPlaces · postSavedPlaces · getPostSavedPlacesMutationOptions · PostSavedPlacesMutationResult · PostSavedPlacesMutationBody · PostSavedPlacesMutationError · usePostSavedPlaces · getSavedPlaces · getGetSavedPlacesQueryKey · getGetSavedPlacesQueryOptions · GetSavedPlacesQueryResult · GetSavedPlacesQueryError · useGetSavedPlaces · deleteSavedPlacesSavedPlaceId · getDeleteSavedPlacesSavedPlaceIdMutationOptions · DeleteSavedPlacesSavedPlaceIdMutationResult · DeleteSavedPlacesSavedPlaceIdMutationError · useDeleteSavedPlacesSavedPlaceId

## src/shared/api/generated/preferences/
- `src/shared/api/generated/preferences/preferences.ts`  →  getMePreferences · getGetMePreferencesQueryKey · getGetMePreferencesQueryOptions · GetMePreferencesQueryResult · GetMePreferencesQueryError · useGetMePreferences · putMePreferences · getPutMePreferencesMutationOptions · PutMePreferencesMutationResult · PutMePreferencesMutationBody · PutMePreferencesMutationError · usePutMePreferences

## src/shared/api/generated/profile/
- `src/shared/api/generated/profile/profile.ts`  →  getMeProfile · getGetMeProfileQueryKey · getGetMeProfileQueryOptions · GetMeProfileQueryResult · GetMeProfileQueryError · useGetMeProfile · patchMeProfileNickname · getPatchMeProfileNicknameMutationOptions · PatchMeProfileNicknameMutationResult · PatchMeProfileNicknameMutationBody · PatchMeProfileNicknameMutationError · usePatchMeProfileNickname · postNicknameSuggestions · getPostNicknameSuggestionsMutationOptions · PostNicknameSuggestionsMutationResult · PostNicknameSuggestionsMutationError · usePostNicknameSuggestions · postNicknameCheck · getPostNicknameCheckMutationOptions · PostNicknameCheckMutationResult · PostNicknameCheckMutationBody · PostNicknameCheckMutationError · usePostNicknameCheck · getMeSettings · getGetMeSettingsQueryKey · getGetMeSettingsQueryOptions · GetMeSettingsQueryResult · GetMeSettingsQueryError · useGetMeSettings · patchMeSettings · getPatchMeSettingsMutationOptions · PatchMeSettingsMutationResult · PatchMeSettingsMutationBody · PatchMeSettingsMutationError · usePatchMeSettings

## src/shared/api/generated/reflection/
- `src/shared/api/generated/reflection/reflection.ts`  →  getMePersonalization · getGetMePersonalizationQueryKey · getGetMePersonalizationQueryOptions · GetMePersonalizationQueryResult · GetMePersonalizationQueryError · useGetMePersonalization · getMeStyle · getGetMeStyleQueryKey · getGetMeStyleQueryOptions · GetMeStyleQueryResult · GetMeStyleQueryError · useGetMeStyle · getTripsTripIdSummary · getGetTripsTripIdSummaryQueryKey · getGetTripsTripIdSummaryQueryOptions · GetTripsTripIdSummaryQueryResult · GetTripsTripIdSummaryQueryError · useGetTripsTripIdSummary · getTripsTripIdReflections · getGetTripsTripIdReflectionsQueryKey · getGetTripsTripIdReflectionsQueryOptions · GetTripsTripIdReflectionsQueryResult · GetTripsTripIdReflectionsQueryError · useGetTripsTripIdReflections · postTripsTripIdReflectionsDayDate · getPostTripsTripIdReflectionsDayDateMutationOptions · PostTripsTripIdReflectionsDayDateMutationResult · PostTripsTripIdReflectionsDayDateMutationError · usePostTripsTripIdReflectionsDayDate · putTripsTripIdReflectionsDayDate · getPutTripsTripIdReflectionsDayDateMutationOptions · PutTripsTripIdReflectionsDayDateMutationResult · PutTripsTripIdReflectionsDayDateMutationBody · PutTripsTripIdReflectionsDayDateMutationError · usePutTripsTripIdReflectionsDayDate

## src/shared/api/generated/replan/
- `src/shared/api/generated/replan/replan.ts`  →  getTripsTripIdReplanSessionsSessionIdDiff · getGetTripsTripIdReplanSessionsSessionIdDiffQueryKey · getGetTripsTripIdReplanSessionsSessionIdDiffQueryOptions · GetTripsTripIdReplanSessionsSessionIdDiffQueryResult · GetTripsTripIdReplanSessionsSessionIdDiffQueryError · useGetTripsTripIdReplanSessionsSessionIdDiff

## src/shared/api/generated/saved-stays/
- `src/shared/api/generated/saved-stays/saved-stays.ts`  →  postSavedStays · getPostSavedStaysMutationOptions · PostSavedStaysMutationResult · PostSavedStaysMutationBody · PostSavedStaysMutationError · usePostSavedStays · getSavedStays · getGetSavedStaysQueryKey · getGetSavedStaysQueryOptions · GetSavedStaysQueryResult · GetSavedStaysQueryError · useGetSavedStays · getSavedStaysSavedStayId · getGetSavedStaysSavedStayIdQueryKey · getGetSavedStaysSavedStayIdQueryOptions · GetSavedStaysSavedStayIdQueryResult · GetSavedStaysSavedStayIdQueryError · useGetSavedStaysSavedStayId · patchSavedStaysSavedStayId · getPatchSavedStaysSavedStayIdMutationOptions · PatchSavedStaysSavedStayIdMutationResult · PatchSavedStaysSavedStayIdMutationBody · PatchSavedStaysSavedStayIdMutationError · usePatchSavedStaysSavedStayId · deleteSavedStaysSavedStayId · getDeleteSavedStaysSavedStayIdMutationOptions · DeleteSavedStaysSavedStayIdMutationResult · DeleteSavedStaysSavedStayIdMutationError · useDeleteSavedStaysSavedStayId

## src/shared/api/generated/schemas/
- `src/shared/api/generated/schemas/accountExport.ts`  →  AccountExport
- `src/shared/api/generated/schemas/accountSettings.ts`  →  AccountSettings
- `src/shared/api/generated/schemas/accountSummary.ts`  →  AccountSummary
- `src/shared/api/generated/schemas/accountSummarySocialProvidersItem.ts`  →  AccountSummarySocialProvidersItem
- `src/shared/api/generated/schemas/accountSummaryStatus.ts`  →  AccountSummaryStatus
- `src/shared/api/generated/schemas/actualVisit.ts`  →  ActualVisit
- `src/shared/api/generated/schemas/addMustVisitRequest.ts`  →  AddMustVisitRequest
- `src/shared/api/generated/schemas/addPhotoRequest.ts`  →  AddPhotoRequest
- `src/shared/api/generated/schemas/adjustTimesRequest.ts`  →  AdjustTimesRequest
- `src/shared/api/generated/schemas/arriveRequest.ts`  →  ArriveRequest
- `src/shared/api/generated/schemas/arriveRequestSource.ts`  →  ArriveRequestSource
- `src/shared/api/generated/schemas/assignBaseRequest.ts`  →  AssignBaseRequest
- `src/shared/api/generated/schemas/baseAssignment.ts`  →  BaseAssignment
- `src/shared/api/generated/schemas/categoryShare.ts`  →  CategoryShare
- `src/shared/api/generated/schemas/changeLog.ts`  →  ChangeLog
- `src/shared/api/generated/schemas/changeLogEntry.ts`  →  ChangeLogEntry
- `src/shared/api/generated/schemas/changeLogEntrySourceType.ts`  →  ChangeLogEntrySourceType
- `src/shared/api/generated/schemas/companionType.ts`  →  CompanionType
- `src/shared/api/generated/schemas/coverage.ts`  →  Coverage
- `src/shared/api/generated/schemas/createTripRequest.ts`  →  CreateTripRequest
- `src/shared/api/generated/schemas/createTripRequestPreferenceSnapshot.ts`  →  CreateTripRequestPreferenceSnapshot
- `src/shared/api/generated/schemas/dayCoverage.ts`  →  DayCoverage
- `src/shared/api/generated/schemas/dayCoverageResolution.ts`  →  DayCoverageResolution
- `src/shared/api/generated/schemas/dayCoverageStatus.ts`  →  DayCoverageStatus
- `src/shared/api/generated/schemas/dayHighlight.ts`  →  DayHighlight
- `src/shared/api/generated/schemas/deletionResponse.ts`  →  DeletionResponse
- `src/shared/api/generated/schemas/deletionResponseCascadeSummary.ts`  →  DeletionResponseCascadeSummary
- `src/shared/api/generated/schemas/editItineraryRequest.ts`  →  EditItineraryRequest
- `src/shared/api/generated/schemas/editItineraryRequestDaysItem.ts`  →  EditItineraryRequestDaysItem
- `src/shared/api/generated/schemas/editItineraryRequestDaysItemSlotsItem.ts`  →  EditItineraryRequestDaysItemSlotsItem
- `src/shared/api/generated/schemas/editReflectionRequest.ts`  →  EditReflectionRequest
- `src/shared/api/generated/schemas/editSavedStayRequest.ts`  →  EditSavedStayRequest
- `src/shared/api/generated/schemas/editTripRequest.ts`  →  EditTripRequest
- `src/shared/api/generated/schemas/errorResponse.ts`  →  ErrorResponse
- `src/shared/api/generated/schemas/errorResponseError.ts`  →  ErrorResponseError
- `src/shared/api/generated/schemas/errorResponseErrorExistingProvider.ts`  →  ErrorResponseErrorExistingProvider
- `src/shared/api/generated/schemas/errorResponseErrorFieldsItem.ts`  →  ErrorResponseErrorFieldsItem
- `src/shared/api/generated/schemas/exportSection.ts`  →  ExportSection
- `src/shared/api/generated/schemas/exportSectionItemsItem.ts`  →  ExportSectionItemsItem
- `src/shared/api/generated/schemas/generateItineraryRequest.ts`  →  GenerateItineraryRequest
- `src/shared/api/generated/schemas/generateItineraryRequestGenerationMode.ts`  →  GenerateItineraryRequestGenerationMode
- `src/shared/api/generated/schemas/generationSession.ts`  →  GenerationSession
- `src/shared/api/generated/schemas/generationSessionMode.ts`  →  GenerationSessionMode
- `src/shared/api/generated/schemas/generationSessionStatus.ts`  →  GenerationSessionStatus
- `src/shared/api/generated/schemas/geocodeCandidate.ts`  →  GeocodeCandidate
- `src/shared/api/generated/schemas/getMeExportParams.ts`  →  GetMeExportParams
- `src/shared/api/generated/schemas/getMeNotificationsParams.ts`  →  GetMeNotificationsParams
- `src/shared/api/generated/schemas/getMeRecordsParams.ts`  →  GetMeRecordsParams
- `src/shared/api/generated/schemas/getPlacesParams.ts`  →  GetPlacesParams
- `src/shared/api/generated/schemas/getRegionsParams.ts`  →  GetRegionsParams
- `src/shared/api/generated/schemas/getStaysGeocodeParams.ts`  →  GetStaysGeocodeParams
- `src/shared/api/generated/schemas/getStaysReverseGeocodeParams.ts`  →  GetStaysReverseGeocodeParams
- `src/shared/api/generated/schemas/getStaysSearchParams.ts`  →  GetStaysSearchParams
- `src/shared/api/generated/schemas/getTripsTripIdChangeLogParams.ts`  →  GetTripsTripIdChangeLogParams
- `src/shared/api/generated/schemas/getTripsTripIdItineraryRevisionsParams.ts`  →  GetTripsTripIdItineraryRevisionsParams
- `src/shared/api/generated/schemas/getTripsTripIdRecordsParams.ts`  →  GetTripsTripIdRecordsParams
- `src/shared/api/generated/schemas/index.ts`  →  (export 없음)
- `src/shared/api/generated/schemas/itinerary.ts`  →  Itinerary
- `src/shared/api/generated/schemas/itineraryCandidatesSummary.ts`  →  ItineraryCandidatesSummary
- `src/shared/api/generated/schemas/itineraryDaysItem.ts`  →  ItineraryDaysItem
- `src/shared/api/generated/schemas/itineraryDaysItemSlotsItem.ts`  →  ItineraryDaysItemSlotsItem
- `src/shared/api/generated/schemas/itineraryDaysItemSlotsItemAlternativesItem.ts`  →  ItineraryDaysItemSlotsItemAlternativesItem
- `src/shared/api/generated/schemas/itineraryGenerationMode.ts`  →  ItineraryGenerationMode
- `src/shared/api/generated/schemas/itineraryGenerationState.ts`  →  ItineraryGenerationState
- `src/shared/api/generated/schemas/itinerarySnapshot.ts`  →  ItinerarySnapshot
- `src/shared/api/generated/schemas/itinerarySnapshotDaysItem.ts`  →  ItinerarySnapshotDaysItem
- `src/shared/api/generated/schemas/itinerarySnapshotDaysItemSlotsItem.ts`  →  ItinerarySnapshotDaysItemSlotsItem
- `src/shared/api/generated/schemas/itinerarySolveMode.ts`  →  ItinerarySolveMode
- `src/shared/api/generated/schemas/itineraryStatus.ts`  →  ItineraryStatus
- `src/shared/api/generated/schemas/itineraryUnplacedMustVisitsItem.ts`  →  ItineraryUnplacedMustVisitsItem
- `src/shared/api/generated/schemas/itineraryUnplacedMustVisitsItemReasonCode.ts`  →  ItineraryUnplacedMustVisitsItemReasonCode
- `src/shared/api/generated/schemas/locationConsent.ts`  →  LocationConsent
- `src/shared/api/generated/schemas/locationConsentCapabilities.ts`  →  LocationConsentCapabilities
- `src/shared/api/generated/schemas/locationConsentOsPermissionMirror.ts`  →  LocationConsentOsPermissionMirror
- `src/shared/api/generated/schemas/moderationUnavailableResponse.ts`  →  ModerationUnavailableResponse
- `src/shared/api/generated/schemas/mustVisit.ts`  →  MustVisit
- `src/shared/api/generated/schemas/mustVisitType.ts`  →  MustVisitType
- `src/shared/api/generated/schemas/nicknameTakenResponse.ts`  →  NicknameTakenResponse
- `src/shared/api/generated/schemas/notFoundResponse.ts`  →  NotFoundResponse
- `src/shared/api/generated/schemas/notification.ts`  →  Notification
- `src/shared/api/generated/schemas/notificationActionType.ts`  →  NotificationActionType
- `src/shared/api/generated/schemas/notificationKind.ts`  →  NotificationKind
- `src/shared/api/generated/schemas/notificationList.ts`  →  NotificationList
- `src/shared/api/generated/schemas/notificationPlanBAction.ts`  →  NotificationPlanBAction
- `src/shared/api/generated/schemas/notificationReflectionAction.ts`  →  NotificationReflectionAction
- `src/shared/api/generated/schemas/notificationStayAction.ts`  →  NotificationStayAction
- `src/shared/api/generated/schemas/notificationToggle.ts`  →  NotificationToggle
- `src/shared/api/generated/schemas/notificationToggleKind.ts`  →  NotificationToggleKind
- `src/shared/api/generated/schemas/notificationToggleList.ts`  →  NotificationToggleList
- `src/shared/api/generated/schemas/notificationTripAction.ts`  →  NotificationTripAction
- `src/shared/api/generated/schemas/patchMeLocationConsentOsPermissionBody.ts`  →  PatchMeLocationConsentOsPermissionBody
- `src/shared/api/generated/schemas/patchMeLocationConsentOsPermissionBodyOsPermission.ts`  →  PatchMeLocationConsentOsPermissionBodyOsPermission
- `src/shared/api/generated/schemas/patchMeProfileNicknameBody.ts`  →  PatchMeProfileNicknameBody
- `src/shared/api/generated/schemas/personalizationInfo.ts`  →  PersonalizationInfo
- `src/shared/api/generated/schemas/personalizationInfoReason.ts`  →  PersonalizationInfoReason
- `src/shared/api/generated/schemas/personalizationItem.ts`  →  PersonalizationItem
- `src/shared/api/generated/schemas/place.ts`  →  Place
- `src/shared/api/generated/schemas/placeDataStatus.ts`  →  PlaceDataStatus
- `src/shared/api/generated/schemas/placeList.ts`  →  PlaceList
- `src/shared/api/generated/schemas/placeSearchUnavailableResponse.ts`  →  PlaceSearchUnavailableResponse
- `src/shared/api/generated/schemas/plannedSlot.ts`  →  PlannedSlot
- `src/shared/api/generated/schemas/poiCategory.ts`  →  PoiCategory
- `src/shared/api/generated/schemas/postNicknameCheck200.ts`  →  PostNicknameCheck200
- `src/shared/api/generated/schemas/postNicknameCheck200Reason.ts`  →  PostNicknameCheck200Reason
- `src/shared/api/generated/schemas/postNicknameCheckBody.ts`  →  PostNicknameCheckBody
- `src/shared/api/generated/schemas/postNicknameSuggestions200.ts`  →  PostNicknameSuggestions200
- `src/shared/api/generated/schemas/prefArrayAxis.ts`  →  PrefArrayAxis
- `src/shared/api/generated/schemas/prefScalarAxis.ts`  →  PrefScalarAxis
- `src/shared/api/generated/schemas/preferenceInput.ts`  →  PreferenceInput
- `src/shared/api/generated/schemas/preferenceInputActivitiesItem.ts`  →  PreferenceInputActivitiesItem
- `src/shared/api/generated/schemas/preferenceInputBudgetTier.ts`  →  PreferenceInputBudgetTier
- `src/shared/api/generated/schemas/preferenceInputCompanionTypesItem.ts`  →  PreferenceInputCompanionTypesItem
- `src/shared/api/generated/schemas/preferenceInputFoodTastesItem.ts`  →  PreferenceInputFoodTastesItem
- `src/shared/api/generated/schemas/preferenceInputPace.ts`  →  PreferenceInputPace
- `src/shared/api/generated/schemas/preferenceInputStylesItem.ts`  →  PreferenceInputStylesItem
- `src/shared/api/generated/schemas/preferenceInputTransportModesItem.ts`  →  PreferenceInputTransportModesItem
- `src/shared/api/generated/schemas/preferenceView.ts`  →  PreferenceView
- `src/shared/api/generated/schemas/preferenceViewBudget.ts`  →  PreferenceViewBudget
- `src/shared/api/generated/schemas/preferenceViewCompanion.ts`  →  PreferenceViewCompanion
- `src/shared/api/generated/schemas/profile.ts`  →  Profile
- `src/shared/api/generated/schemas/pushTokenResponse.ts`  →  PushTokenResponse
- `src/shared/api/generated/schemas/pushTokenResponseOsPermission.ts`  →  PushTokenResponseOsPermission
- `src/shared/api/generated/schemas/pushTokenResponsePlatform.ts`  →  PushTokenResponsePlatform
- `src/shared/api/generated/schemas/putMeLocationConsentBody.ts`  →  PutMeLocationConsentBody
- `src/shared/api/generated/schemas/putMemoRequest.ts`  →  PutMemoRequest
- `src/shared/api/generated/schemas/reflection.ts`  →  Reflection
- `src/shared/api/generated/schemas/reflectionCard.ts`  →  ReflectionCard
- `src/shared/api/generated/schemas/reflectionList.ts`  →  ReflectionList
- `src/shared/api/generated/schemas/reflectionSource.ts`  →  ReflectionSource
- `src/shared/api/generated/schemas/reflectionStats.ts`  →  ReflectionStats
- `src/shared/api/generated/schemas/reflectionStatsDistanceSource.ts`  →  ReflectionStatsDistanceSource
- `src/shared/api/generated/schemas/region.ts`  →  Region
- `src/shared/api/generated/schemas/regionLevel.ts`  →  RegionLevel
- `src/shared/api/generated/schemas/registerPushTokenRequest.ts`  →  RegisterPushTokenRequest
- `src/shared/api/generated/schemas/registerPushTokenRequestOsPermission.ts`  →  RegisterPushTokenRequestOsPermission
- `src/shared/api/generated/schemas/registerPushTokenRequestPlatform.ts`  →  RegisterPushTokenRequestPlatform
- `src/shared/api/generated/schemas/registerRoute.ts`  →  RegisterRoute
- `src/shared/api/generated/schemas/registerSavedStayRequest.ts`  →  RegisterSavedStayRequest
- `src/shared/api/generated/schemas/reorderPhotosRequest.ts`  →  ReorderPhotosRequest
- `src/shared/api/generated/schemas/replanDiff.ts`  →  ReplanDiff
- `src/shared/api/generated/schemas/replanDiffEntry.ts`  →  ReplanDiffEntry
- `src/shared/api/generated/schemas/replanDiffEntryChange.ts`  →  ReplanDiffEntryChange
- `src/shared/api/generated/schemas/replanDiffSlot.ts`  →  ReplanDiffSlot
- `src/shared/api/generated/schemas/replanDiffStatus.ts`  →  ReplanDiffStatus
- `src/shared/api/generated/schemas/replanImpact.ts`  →  ReplanImpact
- `src/shared/api/generated/schemas/replanSession.ts`  →  ReplanSession
- `src/shared/api/generated/schemas/replanSessionOriginKind.ts`  →  ReplanSessionOriginKind
- `src/shared/api/generated/schemas/replanSessionScope.ts`  →  ReplanSessionScope
- `src/shared/api/generated/schemas/replanSessionStatus.ts`  →  ReplanSessionStatus
- `src/shared/api/generated/schemas/resolveCoverageDayRequest.ts`  →  ResolveCoverageDayRequest
- `src/shared/api/generated/schemas/reverseGeocodeResult.ts`  →  ReverseGeocodeResult
- `src/shared/api/generated/schemas/revision.ts`  →  Revision
- `src/shared/api/generated/schemas/revisionActor.ts`  →  RevisionActor
- `src/shared/api/generated/schemas/revisionKind.ts`  →  RevisionKind
- `src/shared/api/generated/schemas/revisionList.ts`  →  RevisionList
- `src/shared/api/generated/schemas/savePlaceRequest.ts`  →  SavePlaceRequest
- `src/shared/api/generated/schemas/savedPlace.ts`  →  SavedPlace
- `src/shared/api/generated/schemas/savedStay.ts`  →  SavedStay
- `src/shared/api/generated/schemas/slotCandidates.ts`  →  SlotCandidates
- `src/shared/api/generated/schemas/slotCandidatesCandidatesItem.ts`  →  SlotCandidatesCandidatesItem
- `src/shared/api/generated/schemas/slotCandidatesEmptyReason.ts`  →  SlotCandidatesEmptyReason
- `src/shared/api/generated/schemas/slotCandidatesRequest.ts`  →  SlotCandidatesRequest
- `src/shared/api/generated/schemas/startReplanRequest.ts`  →  StartReplanRequest
- `src/shared/api/generated/schemas/startReplanRequestOriginKind.ts`  →  StartReplanRequestOriginKind
- `src/shared/api/generated/schemas/startReplanRequestScope.ts`  →  StartReplanRequestScope
- `src/shared/api/generated/schemas/stayDetail.ts`  →  StayDetail
- `src/shared/api/generated/schemas/stayItem.ts`  →  StayItem
- `src/shared/api/generated/schemas/stayPrice.ts`  →  StayPrice
- `src/shared/api/generated/schemas/stayRecommendation.ts`  →  StayRecommendation
- `src/shared/api/generated/schemas/stayRecommendationCandidatesItem.ts`  →  StayRecommendationCandidatesItem
- `src/shared/api/generated/schemas/stayRecommendationRequest.ts`  →  StayRecommendationRequest
- `src/shared/api/generated/schemas/stayRecommendationRequestCandidatesItem.ts`  →  StayRecommendationRequestCandidatesItem
- `src/shared/api/generated/schemas/staySearchResponse.ts`  →  StaySearchResponse
- `src/shared/api/generated/schemas/styleAnalysisBody.ts`  →  StyleAnalysisBody
- `src/shared/api/generated/schemas/styleAnalysisEnvelope.ts`  →  StyleAnalysisEnvelope
- `src/shared/api/generated/schemas/stylePreview.ts`  →  StylePreview
- `src/shared/api/generated/schemas/styleProgress.ts`  →  StyleProgress
- `src/shared/api/generated/schemas/traitGauges.ts`  →  TraitGauges
- `src/shared/api/generated/schemas/trigger.ts`  →  Trigger
- `src/shared/api/generated/schemas/triggerKind.ts`  →  TriggerKind
- `src/shared/api/generated/schemas/triggerList.ts`  →  TriggerList
- `src/shared/api/generated/schemas/triggerScope.ts`  →  TriggerScope
- `src/shared/api/generated/schemas/trip.ts`  →  Trip
- `src/shared/api/generated/schemas/tripDestination.ts`  →  TripDestination
- `src/shared/api/generated/schemas/tripPreferenceSnapshot.ts`  →  TripPreferenceSnapshot
- `src/shared/api/generated/schemas/tripRecord.ts`  →  TripRecord
- `src/shared/api/generated/schemas/tripRecordDay.ts`  →  TripRecordDay
- `src/shared/api/generated/schemas/tripRecordList.ts`  →  TripRecordList
- `src/shared/api/generated/schemas/tripRecordListEmptyState.ts`  →  TripRecordListEmptyState
- `src/shared/api/generated/schemas/tripRecordSummary.ts`  →  TripRecordSummary
- `src/shared/api/generated/schemas/tripStatus.ts`  →  TripStatus
- `src/shared/api/generated/schemas/tripSummary.ts`  →  TripSummary
- `src/shared/api/generated/schemas/tripSummaryEnvelope.ts`  →  TripSummaryEnvelope
- `src/shared/api/generated/schemas/tripSummarySource.ts`  →  TripSummarySource
- `src/shared/api/generated/schemas/tripSummaryStats.ts`  →  TripSummaryStats
- `src/shared/api/generated/schemas/tripSummaryStatsDistanceSource.ts`  →  TripSummaryStatsDistanceSource
- `src/shared/api/generated/schemas/updateAccountSettingsRequest.ts`  →  UpdateAccountSettingsRequest
- `src/shared/api/generated/schemas/updateToggleRequest.ts`  →  UpdateToggleRequest
- `src/shared/api/generated/schemas/validationErrorResponse.ts`  →  ValidationErrorResponse
- `src/shared/api/generated/schemas/visitCheck.ts`  →  VisitCheck
- `src/shared/api/generated/schemas/visitCheckList.ts`  →  VisitCheckList
- `src/shared/api/generated/schemas/visitCheckSource.ts`  →  VisitCheckSource
- `src/shared/api/generated/schemas/visitMemo.ts`  →  VisitMemo
- `src/shared/api/generated/schemas/visitPhoto.ts`  →  VisitPhoto
- `src/shared/api/generated/schemas/visitPhotoList.ts`  →  VisitPhotoList

## src/shared/api/generated/stays/
- `src/shared/api/generated/stays/stays.ts`  →  getStaysSearch · getGetStaysSearchQueryKey · getGetStaysSearchQueryOptions · GetStaysSearchQueryResult · GetStaysSearchQueryError · useGetStaysSearch · getStaysStayId · getGetStaysStayIdQueryKey · getGetStaysStayIdQueryOptions · GetStaysStayIdQueryResult · GetStaysStayIdQueryError · useGetStaysStayId · getStaysGeocode · getGetStaysGeocodeQueryKey · getGetStaysGeocodeQueryOptions · GetStaysGeocodeQueryResult · GetStaysGeocodeQueryError · useGetStaysGeocode · getStaysReverseGeocode · getGetStaysReverseGeocodeQueryKey · getGetStaysReverseGeocodeQueryOptions · GetStaysReverseGeocodeQueryResult · GetStaysReverseGeocodeQueryError · useGetStaysReverseGeocode

## src/shared/api/generated/trips/
- `src/shared/api/generated/trips/trips.ts`  →  postTrips · getPostTripsMutationOptions · PostTripsMutationResult · PostTripsMutationBody · PostTripsMutationError · usePostTrips · getTrips · getGetTripsQueryKey · getGetTripsQueryOptions · GetTripsQueryResult · GetTripsQueryError · useGetTrips · getTripsTripId · getGetTripsTripIdQueryKey · getGetTripsTripIdQueryOptions · GetTripsTripIdQueryResult · GetTripsTripIdQueryError · useGetTripsTripId · patchTripsTripId · getPatchTripsTripIdMutationOptions · PatchTripsTripIdMutationResult · PatchTripsTripIdMutationBody · PatchTripsTripIdMutationError · usePatchTripsTripId · deleteTripsTripId · getDeleteTripsTripIdMutationOptions · DeleteTripsTripIdMutationResult · DeleteTripsTripIdMutationError · useDeleteTripsTripId · postTripsTripIdBases · getPostTripsTripIdBasesMutationOptions · PostTripsTripIdBasesMutationResult · PostTripsTripIdBasesMutationBody · PostTripsTripIdBasesMutationError · usePostTripsTripIdBases · getTripsTripIdBases · getGetTripsTripIdBasesQueryKey · getGetTripsTripIdBasesQueryOptions · GetTripsTripIdBasesQueryResult · GetTripsTripIdBasesQueryError · useGetTripsTripIdBases · deleteTripsTripIdBasesBaseAssignmentId · getDeleteTripsTripIdBasesBaseAssignmentIdMutationOptions · DeleteTripsTripIdBasesBaseAssignmentIdMutationResult · DeleteTripsTripIdBasesBaseAssignmentIdMutationError · useDeleteTripsTripIdBasesBaseAssignmentId · getTripsTripIdCoverage · getGetTripsTripIdCoverageQueryKey · getGetTripsTripIdCoverageQueryOptions · GetTripsTripIdCoverageQueryResult · GetTripsTripIdCoverageQueryError · useGetTripsTripIdCoverage · putTripsTripIdCoverageDaysDayDate · getPutTripsTripIdCoverageDaysDayDateMutationOptions · PutTripsTripIdCoverageDaysDayDateMutationResult · PutTripsTripIdCoverageDaysDayDateMutationBody · PutTripsTripIdCoverageDaysDayDateMutationError · usePutTripsTripIdCoverageDaysDayDate · postTripsTripIdMustVisits · getPostTripsTripIdMustVisitsMutationOptions · PostTripsTripIdMustVisitsMutationResult · PostTripsTripIdMustVisitsMutationBody · PostTripsTripIdMustVisitsMutationError · usePostTripsTripIdMustVisits · getTripsTripIdMustVisits · getGetTripsTripIdMustVisitsQueryKey · getGetTripsTripIdMustVisitsQueryOptions · GetTripsTripIdMustVisitsQueryResult · GetTripsTripIdMustVisitsQueryError · useGetTripsTripIdMustVisits · getTripsTripIdItinerary · getGetTripsTripIdItineraryQueryKey · getGetTripsTripIdItineraryQueryOptions · GetTripsTripIdItineraryQueryResult · GetTripsTripIdItineraryQueryError · useGetTripsTripIdItinerary · postTripsTripIdItinerary · getPostTripsTripIdItineraryMutationOptions · PostTripsTripIdItineraryMutationResult · PostTripsTripIdItineraryMutationBody · PostTripsTripIdItineraryMutationError · usePostTripsTripIdItinerary · putTripsTripIdItinerary · getPutTripsTripIdItineraryMutationOptions · PutTripsTripIdItineraryMutationResult · PutTripsTripIdItineraryMutationBody · PutTripsTripIdItineraryMutationError · usePutTripsTripIdItinerary · getTripsTripIdGenerationSessionsSessionId · getGetTripsTripIdGenerationSessionsSessionIdQueryKey · getGetTripsTripIdGenerationSessionsSessionIdQueryOptions · GetTripsTripIdGenerationSessionsSessionIdQueryResult · GetTripsTripIdGenerationSessionsSessionIdQueryError · useGetTripsTripIdGenerationSessionsSessionId · postTripsTripIdGenerationSessionsSessionIdCancel · getPostTripsTripIdGenerationSessionsSessionIdCancelMutationOptions · PostTripsTripIdGenerationSessionsSessionIdCancelMutationResult · PostTripsTripIdGenerationSessionsSessionIdCancelMutationError · usePostTripsTripIdGenerationSessionsSessionIdCancel · postTripsTripIdItinerarySlotCandidates · getPostTripsTripIdItinerarySlotCandidatesMutationOptions · PostTripsTripIdItinerarySlotCandidatesMutationResult · PostTripsTripIdItinerarySlotCandidatesMutationBody · PostTripsTripIdItinerarySlotCandidatesMutationError · usePostTripsTripIdItinerarySlotCandidates · postTripsTripIdVisits · getPostTripsTripIdVisitsMutationOptions · PostTripsTripIdVisitsMutationResult · PostTripsTripIdVisitsMutationBody · PostTripsTripIdVisitsMutationError · usePostTripsTripIdVisits · getTripsTripIdVisitsDaysDay · getGetTripsTripIdVisitsDaysDayQueryKey · getGetTripsTripIdVisitsDaysDayQueryOptions · GetTripsTripIdVisitsDaysDayQueryResult · GetTripsTripIdVisitsDaysDayQueryError · useGetTripsTripIdVisitsDaysDay · patchTripsTripIdVisitsVisitCheckId · getPatchTripsTripIdVisitsVisitCheckIdMutationOptions · PatchTripsTripIdVisitsVisitCheckIdMutationResult · PatchTripsTripIdVisitsVisitCheckIdMutationBody · PatchTripsTripIdVisitsVisitCheckIdMutationError · usePatchTripsTripIdVisitsVisitCheckId · postTripsTripIdVisitsVisitCheckIdComplete · getPostTripsTripIdVisitsVisitCheckIdCompleteMutationOptions · PostTripsTripIdVisitsVisitCheckIdCompleteMutationResult · PostTripsTripIdVisitsVisitCheckIdCompleteMutationError · usePostTripsTripIdVisitsVisitCheckIdComplete · postTripsTripIdVisitsVisitCheckIdSkip · getPostTripsTripIdVisitsVisitCheckIdSkipMutationOptions · PostTripsTripIdVisitsVisitCheckIdSkipMutationResult · PostTripsTripIdVisitsVisitCheckIdSkipMutationError · usePostTripsTripIdVisitsVisitCheckIdSkip · postTripsTripIdVisitsVisitCheckIdPhotos · getPostTripsTripIdVisitsVisitCheckIdPhotosMutationOptions · PostTripsTripIdVisitsVisitCheckIdPhotosMutationResult · PostTripsTripIdVisitsVisitCheckIdPhotosMutationBody · PostTripsTripIdVisitsVisitCheckIdPhotosMutationError · usePostTripsTripIdVisitsVisitCheckIdPhotos · getTripsTripIdVisitsVisitCheckIdPhotos · getGetTripsTripIdVisitsVisitCheckIdPhotosQueryKey · getGetTripsTripIdVisitsVisitCheckIdPhotosQueryOptions · GetTripsTripIdVisitsVisitCheckIdPhotosQueryResult · GetTripsTripIdVisitsVisitCheckIdPhotosQueryError · useGetTripsTripIdVisitsVisitCheckIdPhotos · putTripsTripIdVisitsVisitCheckIdPhotosOrder · getPutTripsTripIdVisitsVisitCheckIdPhotosOrderMutationOptions · PutTripsTripIdVisitsVisitCheckIdPhotosOrderMutationResult · PutTripsTripIdVisitsVisitCheckIdPhotosOrderMutationBody · PutTripsTripIdVisitsVisitCheckIdPhotosOrderMutationError · usePutTripsTripIdVisitsVisitCheckIdPhotosOrder · deleteTripsTripIdVisitsVisitCheckIdPhotosVisitPhotoMetaId · getDeleteTripsTripIdVisitsVisitCheckIdPhotosVisitPhotoMetaIdMutationOptions · DeleteTripsTripIdVisitsVisitCheckIdPhotosVisitPhotoMetaIdMutationResult · DeleteTripsTripIdVisitsVisitCheckIdPhotosVisitPhotoMetaIdMutationError · useDeleteTripsTripIdVisitsVisitCheckIdPhotosVisitPhotoMetaId · getMeRecords · getGetMeRecordsQueryKey · getGetMeRecordsQueryOptions · GetMeRecordsQueryResult · GetMeRecordsQueryError · useGetMeRecords · getTripsTripIdRecords · getGetTripsTripIdRecordsQueryKey · getGetTripsTripIdRecordsQueryOptions · GetTripsTripIdRecordsQueryResult · GetTripsTripIdRecordsQueryError · useGetTripsTripIdRecords · putTripsTripIdVisitsVisitCheckIdMemo · getPutTripsTripIdVisitsVisitCheckIdMemoMutationOptions · PutTripsTripIdVisitsVisitCheckIdMemoMutationResult · PutTripsTripIdVisitsVisitCheckIdMemoMutationBody · PutTripsTripIdVisitsVisitCheckIdMemoMutationError · usePutTripsTripIdVisitsVisitCheckIdMemo · getTripsTripIdTriggers · getGetTripsTripIdTriggersQueryKey · getGetTripsTripIdTriggersQueryOptions · GetTripsTripIdTriggersQueryResult · GetTripsTripIdTriggersQueryError · useGetTripsTripIdTriggers · weatherCheck · getWeatherCheckMutationOptions · WeatherCheckMutationResult · WeatherCheckMutationError · useWeatherCheck · postTripsTripIdTriggersTriggerIdDismiss · getPostTripsTripIdTriggersTriggerIdDismissMutationOptions · PostTripsTripIdTriggersTriggerIdDismissMutationResult · PostTripsTripIdTriggersTriggerIdDismissMutationError · usePostTripsTripIdTriggersTriggerIdDismiss · postTripsTripIdStayRecommendations · getPostTripsTripIdStayRecommendationsMutationOptions · PostTripsTripIdStayRecommendationsMutationResult · PostTripsTripIdStayRecommendationsMutationBody · PostTripsTripIdStayRecommendationsMutationError · usePostTripsTripIdStayRecommendations · postTripsTripIdReplanSessions · getPostTripsTripIdReplanSessionsMutationOptions · PostTripsTripIdReplanSessionsMutationResult · PostTripsTripIdReplanSessionsMutationBody · PostTripsTripIdReplanSessionsMutationError · usePostTripsTripIdReplanSessions · getTripsTripIdReplanSessionsSessionId · getGetTripsTripIdReplanSessionsSessionIdQueryKey · getGetTripsTripIdReplanSessionsSessionIdQueryOptions · GetTripsTripIdReplanSessionsSessionIdQueryResult · GetTripsTripIdReplanSessionsSessionIdQueryError · useGetTripsTripIdReplanSessionsSessionId · postTripsTripIdReplanSessionsSessionIdApply · getPostTripsTripIdReplanSessionsSessionIdApplyMutationOptions · PostTripsTripIdReplanSessionsSessionIdApplyMutationResult · PostTripsTripIdReplanSessionsSessionIdApplyMutationError · usePostTripsTripIdReplanSessionsSessionIdApply · postTripsTripIdReplanSessionsSessionIdCancel · getPostTripsTripIdReplanSessionsSessionIdCancelMutationOptions · PostTripsTripIdReplanSessionsSessionIdCancelMutationResult · PostTripsTripIdReplanSessionsSessionIdCancelMutationError · usePostTripsTripIdReplanSessionsSessionIdCancel · getTripsTripIdItineraryRevisions · getGetTripsTripIdItineraryRevisionsQueryKey · getGetTripsTripIdItineraryRevisionsQueryOptions · GetTripsTripIdItineraryRevisionsQueryResult · GetTripsTripIdItineraryRevisionsQueryError · useGetTripsTripIdItineraryRevisions · postTripsTripIdItineraryRevisionsRevisionIdRestore · getPostTripsTripIdItineraryRevisionsRevisionIdRestoreMutationOptions · PostTripsTripIdItineraryRevisionsRevisionIdRestoreMutationResult · PostTripsTripIdItineraryRevisionsRevisionIdRestoreMutationError · usePostTripsTripIdItineraryRevisionsRevisionIdRestore · postTripsTripIdItineraryConfirm · getPostTripsTripIdItineraryConfirmMutationOptions · PostTripsTripIdItineraryConfirmMutationResult · PostTripsTripIdItineraryConfirmMutationError · usePostTripsTripIdItineraryConfirm · getTripsTripIdChangeLog · getGetTripsTripIdChangeLogQueryKey · getGetTripsTripIdChangeLogQueryOptions · GetTripsTripIdChangeLogQueryResult · GetTripsTripIdChangeLogQueryError · useGetTripsTripIdChangeLog · deleteTripsTripIdMustVisitsMustVisitId · getDeleteTripsTripIdMustVisitsMustVisitIdMutationOptions · DeleteTripsTripIdMustVisitsMustVisitIdMutationResult · DeleteTripsTripIdMustVisitsMustVisitIdMutationError · useDeleteTripsTripIdMustVisitsMustVisitId

## src/shared/api/
- `src/shared/api/generationInProgress.ts`  →  resolveGenerationInProgress · cancelActiveGeneration
- `src/shared/api/index.hooks.ts`  →  cancelActiveGeneration · resolveGenerationInProgress
- `src/shared/api/index.schemas.ts`  →  (export 없음)
- `src/shared/api/index.ts`  →  SocialProvider · BootstrapResponse · AgeConfirmation · SocialLoginBody · SocialTokenLoginBody · AccountSummary · TokenPair · NormalizedApiError · AuthedApiClientOptions · TermsVersion · ConsentAction · ConsentInput · NicknameCheckReason · NicknameCheckResult · createAuthedApiClient · API_BASE_URL · fetchBootstrap · postSocialLogin · postSocialTokenLogin · refreshTokens · logout · fetchTerms · fetchTermsByType · authedClient · submitConsents · patchConsent · fetchNicknameSuggestions · checkNickname · updateNickname · completeOnboarding · isAlreadyRegistered · isNotFound · retryUnlessNotFound · getAccessToken · hydrate · setAccessToken · subscribeAccessToken · resolveVisitConflict
- `src/shared/api/isAlreadyRegistered.ts`  →  isAlreadyRegistered
- `src/shared/api/isNotFound.ts`  →  isNotFound · retryUnlessNotFound
- `src/shared/api/mutator.ts`  →  customInstance
- `src/shared/api/tokenManager.ts`  →  getAccessToken · setAccessToken · clearAccessToken · hydrate · subscribeAccessToken
- `src/shared/api/visitConflict.ts`  →  VISIT_CONFLICT_CODES · VisitConflictKind · resolveVisitConflict

## src/shared/lib/
- `src/shared/lib/bootstrapReeval.ts`  →  subscribeBootstrapReeval · notifyBootstrapReeval
- `src/shared/lib/compareVersion.ts`  →  compareVersion
- `src/shared/lib/formatKoreanDate.ts`  →  formatKoreanDate
- `src/shared/lib/formatRelativeTime.ts`  →  formatRelativeTime
- `src/shared/lib/monthGrid.ts`  →  MonthCell · daysInMonth · firstWeekdayOfMonth · shiftMonth · isDateInRange · buildMonthGrid
- `src/shared/lib/nicknameFormat.ts`  →  NicknameFormatReason · NicknameFormatResult · NICKNAME_MIN_LENGTH · NICKNAME_MAX_LENGTH · validateNicknameFormat
- `src/shared/lib/pressGuard.ts`  →  guardPress · openPressGuardWindow · resetPressGuard
- `src/shared/lib/reduceMotion.ts`  →  startUnlessReduceMotion
- `src/shared/lib/seoulDate.ts`  →  seoulDate · seoulTime · seoulInstant
- `src/shared/lib/useElapsedFlag.ts`  →  useElapsedFlag

## src/shared/location/
- `src/shared/location/LocationGlyphs.tsx`  →  LocationBackChevronGlyph · LocationRadarHero · LocationOffGlyph · LocationInfoGlyph · LocationClockGlyph · LocationSwapGlyph · LocationPinGlyph · LocationWarningGlyph
- `src/shared/location/LocationPreprompt.tsx`  →  LocationPrepromptState · LocationPrepromptProps · LocationPreprompt
- `src/shared/location/consentPutBody.ts`  →  consentPutBody
- `src/shared/location/geofence.ts`  →  GeofenceRegion · buildGeofenceRegions · geofenceArriveRequest · registerGeofences · clearGeofences
- `src/shared/location/index.ts`  →  LocationBackChevronGlyph · LocationClockGlyph · LocationInfoGlyph · LocationPinGlyph · LocationSwapGlyph · LocationWarningGlyph · LocationPreprompt · LOCATION_ICON_COLORS · readDevicePosition · revokeImpact · useLocationConsent
- `src/shared/location/index.view.ts`  →  LocationBackChevronGlyph · LocationClockGlyph · LocationInfoGlyph · LocationPinGlyph · LocationSwapGlyph · LocationWarningGlyph · LocationPreprompt · LOCATION_ICON_COLORS · revokeImpact
- `src/shared/location/locationColors.ts`  →  LOCATION_ICON_COLORS
- `src/shared/location/readDevicePosition.ts`  →  readDevicePosition
- `src/shared/location/revokeImpact.ts`  →  RevokeImpact · revokeImpact
- `src/shared/location/useLocationConsent.ts`  →  LocationConsentModel · useLocationConsent

## src/shared/map/
- `src/shared/map/CenterPinPicker.tsx`  →  CenterPinPickerProps · CenterPinPicker
- `src/shared/map/MapView.tsx`  →  MapCenter · MapPinState · MapPinKind · MapPin · MapViewProps · MapView
- `src/shared/map/fitRegion.ts`  →  buildFitRegion · buildCircleRegion
- `src/shared/map/index.ts`  →  MapView · CenterPinPicker

## src/shared/photo/
- `src/shared/photo/index.ts`  →  PhotoAssetMeta · PhotoPickResult · pickPhotoAsset · resolvePhotoUri

## src/shared/push/
- `src/shared/push/PushGlyphs.tsx`  →  PushBellHero
- `src/shared/push/PushPreprompt.tsx`  →  PushPrepromptProps · PushPreprompt
- `src/shared/push/index.ts`  →  getPushPermission · type PushPermissionStatus · requestPushPermission · registerPushToken · unregisterDeviceToken · toServerOsPermission · isDeviceNotRegistered · promptAndRegisterPush · registerPushIfGranted · unregisterStoredPushToken · PushPreprompt
- `src/shared/push/index.view.ts`  →  PushPreprompt
- `src/shared/push/permissions.ts`  →  PushPermissionStatus · getPushPermission
- `src/shared/push/pushColors.ts`  →  PUSH_ICON_COLORS
- `src/shared/push/register.ts`  →  toServerOsPermission · isDeviceNotRegistered · unregisterDeviceToken · registerPushToken · promptAndRegisterPush · registerPushIfGranted · unregisterStoredPushToken
- `src/shared/push/request.ts`  →  ensureAndroidChannels · requestPushPermission

## src/shared/storage/
- `src/shared/storage/idSet.ts`  →  readIdSet · writeIdSet
- `src/shared/storage/index.ts`  →  TokenBundle · saveTokens · getTokens · clearTokens · hasStoredToken · readIdSet · writeIdSet · getInstallId · readStringValue · writeStringValue
- `src/shared/storage/installId.ts`  →  getInstallId
- `src/shared/storage/stringValue.ts`  →  readStringValue · writeStringValue

## src/shared/ui/
- `src/shared/ui/BottomTabBar.tsx`  →  ShellTabKey · shellTabHref · BottomTabBarProps · BottomTabBar
- `src/shared/ui/CollageEmptyState.tsx`  →  CollageEmptyStateProps · CollageEmptyState
- `src/shared/ui/HeartButton.tsx`  →  HeartButtonProps · HeartButton
- `src/shared/ui/HeartGlyphs.tsx`  →  HeartOutlineGlyph · HeartFilledGlyph · HeartBadgeGlyph
- `src/shared/ui/SegmentedControl.tsx`  →  SegmentedOption · SegmentedControlProps · SegmentedControl
- `src/shared/ui/Skeleton.tsx`  →  SkeletonProps · Skeleton
- `src/shared/ui/StateNotice.tsx`  →  StateNoticeAction · StateNoticeProps · StateNotice
- `src/shared/ui/Toast.tsx`  →  TOAST_VISIBLE_MS · showToast · hideToast · ToastHost
- `src/shared/ui/ToastGlyphs.tsx`  →  ToastSuccessGlyph
- `src/shared/ui/Toggle.tsx`  →  ToggleProps · Toggle
- `src/shared/ui/WheelPicker.tsx`  →  WHEEL_CELL_HEIGHT · WheelPickerProps · WheelPicker

## src/shared/ui/placeholders/
- `src/shared/ui/placeholders/index.ts`  →  PLACEHOLDER_PHOTOS

## src/shared/ui/pref/
- `src/shared/ui/pref/PrefChip.tsx`  →  PrefChipProps · PrefChip
- `src/shared/ui/pref/PrefTile.tsx`  →  PrefTileIcon · PrefTileProps · PrefTile
- `src/shared/ui/pref/index.ts`  →  PrefChip · PrefTile

## src/test-support/
- `src/test-support/editDragList.ts`  →  EDIT_LIST · editListData · moveItem · fireEditDragEnd · fireEditDropOnZone · fireEditDragBegin
- `src/test-support/expoAppleAuthenticationMock.tsx`  →  appleSignInAsyncSpy · appleIsAvailableAsyncSpy · expoAppleAuthenticationModule · resetExpoAppleAuthenticationMock
- `src/test-support/expoAuthSessionMock.ts`  →  promptAsyncSpy · authRequestConstructorSpy · makeRedirectUriSpy · expoAuthSessionModule · expoWebBrowserModule · expoCryptoModule · setPromptResult · setCodeVerifier · resetExpoAuthSessionMock
- `src/test-support/expoRouterRedirectMock.tsx`  →  Redirect · Stack
- `src/test-support/expoRouterStackMock.tsx`  →  Stack
- `src/test-support/expoRouterTabsMock.tsx`  →  capturedTabsProps · Tabs · useRouter
- `src/test-support/flushNotifications.ts`  →  flushNotifications
- `src/test-support/mapViewMock.tsx`  →  MapCenter · MapPin · MapView · CenterPinPicker
- `src/test-support/myPageItineraries.tsx`  →  DURING · PAST · FUTURE · itin · CONFIRMED · PLANNED · AXIOS_404 · AXIOS_500 · ItinScript · scriptItineraryOptions · deferred · newTestQueryClient · renderWithQueryClient · settle · myPageTrip
- `src/test-support/nativeSocialSdkMock.ts`  →  kakaoLoginSpy · naverLoginSpy · naverInitializeSpy · kakaoLogoutSpy · kakaoLoginModule · naverLoginModule · resetNativeSocialSdkMock
- `src/test-support/onboardingScenarios.ts`  →  ConsentBehavior · NicknameBehavior · OnboardingScenario · ONBOARDING_SCENARIOS · OnboardingScenarioKey · setOnboardingScenario · getOnboardingScenario · resetOnboardingScenario
- `src/test-support/pushOsFake.ts`  →  OsPermission · primeOsPermission · primeExpoToken
- `src/test-support/queryClientProbe.tsx`  →  SplashGate · getObservedQueryClient · resetObservedQueryClient
- `src/test-support/sheetTree.ts`  →  closestAncestor · isInsideSheet · sheetScrollOf · treeIndexOf · renderedText
- `src/test-support/splashGateMock.tsx`  →  SplashGate
- `src/test-support/toastHarness.tsx`  →  WithToastHost · resetToast
- `src/test-support/tripRecordsTrip.ts`  →  tripRecordsTrip
- `src/test-support/wizardDraftFixture.ts`  →  WizardDraftData · wizardDraftData · freshWizardDraft · withoutSeedFields · leavePreviousTripDraft · captureDraftAtNextCall · resetWizardDraft

## src/widgets/map-sheet-shell/
- `src/widgets/map-sheet-shell/index.ts`  →  DayChipOverlay · DistanceConnector · EditorView · GenerationProgressCard · BackChevronGlyph · FullAiGlyph · MapSheetShell · SheetHeader

## src/widgets/map-sheet-shell/ui/
- `src/widgets/map-sheet-shell/ui/CtaBar.tsx`  →  CtaButton · CtaBarProps · CTA_BAR_HEIGHT · CtaBar
- `src/widgets/map-sheet-shell/ui/DayChipOverlay.tsx`  →  DayChip · DayChipOverlayProps · DayChipOverlay
- `src/widgets/map-sheet-shell/ui/DistanceConnector.tsx`  →  isZeroDistance · DistanceConnectorProps · DistanceConnector
- `src/widgets/map-sheet-shell/ui/EditorGlyphs.tsx`  →  TrashGlyph · PlusGlyph · InfoCircleGlyph
- `src/widgets/map-sheet-shell/ui/EditorView.tsx`  →  EditorViewSlot · EditorViewProps · EditorView
- `src/widgets/map-sheet-shell/ui/GenerationProgressCard.tsx`  →  GenerationProgressCell · GenerationProgressCardProps · GenerationProgressCard
- `src/widgets/map-sheet-shell/ui/MapFallbackBar.tsx`  →  MapFallbackBar
- `src/widgets/map-sheet-shell/ui/MapSheetGlyphs.tsx`  →  BackChevronGlyph · WalkGlyph · CarGlyph · FullAiGlyph · CheckGlyph · MapPinOffGlyph · RetryGlyph
- `src/widgets/map-sheet-shell/ui/MapSheetShell.tsx`  →  MapSheetListSlot · MapSheetShellProps · MapSheetShell
- `src/widgets/map-sheet-shell/ui/SheetHeader.tsx`  →  SheetHeaderProps · SheetHeader
- `src/widgets/map-sheet-shell/ui/SlotDropZone.tsx`  →  SlotDropZoneProps · SlotDropZone

## src/widgets/time-sheet/
- `src/widgets/time-sheet/index.ts`  →  TimeSheet

## src/widgets/time-sheet/ui/
- `src/widgets/time-sheet/ui/TimeSheet.tsx`  →  TimeSheetPlaceSummary · TimeSheetProps · TimeSheet

합계 961개 파일
