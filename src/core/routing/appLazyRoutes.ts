import React, { lazy } from "react";

/** Lazy route helper with an explicit preload hook. Kept outside App.tsx so the
 * application shell is smaller and route ownership has a single boundary. */
export const lazyWithPreload = <T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) => {
  const LazyComponent = lazy(factory) as any;
  LazyComponent.preload = () => factory().catch(() => undefined);
  return LazyComponent as React.LazyExoticComponent<T> & {
    preload: () => Promise<any>;
  };
};

export const AuthScreen = lazyWithPreload(() => import("../../features/auth/components/AuthScreen"));
export const ProfileCompletionScreen = lazyWithPreload(() => import("../../features/auth/components/ProfileCompletionScreen"));
export const ResetPasswordScreen = lazyWithPreload(() => import("../../features/auth/components/ResetPasswordScreen"));
export const HomeDashboard = lazyWithPreload(() => import("../../features/home/components/HomeDashboard"));

// Preserve the previous startup behavior exactly.
AuthScreen.preload();
ProfileCompletionScreen.preload();
HomeDashboard.preload();

export const ModulesView = lazyWithPreload(() => import("../../features/modules/components/ModulesView"));
export const ModulePlaceholderView = lazyWithPreload(() => import("../../features/modules/components/ModulePlaceholderView"));
export const SubjectView = lazyWithPreload(() => import("../../features/subjects/components/SubjectView"));
export const LectureDetailView = lazyWithPreload(() => import("../../features/lectures/components/LectureDetailView"));
export const CalendarView = lazyWithPreload(() => import("../../features/calendar/components/CalendarView"));
export const ProfileView = lazyWithPreload(() => import("../../features/profile/components/ProfileView"));
export const ControlCenterView = lazyWithPreload(() => import("../../features/admin/components/ControlCenterView"));
export const SettingsView = lazyWithPreload(() => import("../../features/settings/components/SettingsView"));
export const PrivacyPolicyView = lazyWithPreload(() => import("../../features/legal/components/PrivacyPolicyView"));
export const TermsOfServiceView = lazyWithPreload(() => import("../../features/legal/components/TermsOfServiceView"));
export const SupportView = lazyWithPreload(() => import("../../features/legal/components/SupportView"));
export const MedicalDisclaimerView = lazyWithPreload(() => import("../../features/legal/components/MedicalDisclaimerView"));
export const BulletinCenter = lazyWithPreload(() => import("../../features/bulletin/components/BulletinCenter"));
export const EditCalendarEvent = lazyWithPreload(() => import("../../features/calendar/components/EditCalendarEvent"));
export const AppleEmailSelectionScreen = lazyWithPreload(() =>
  import("../../features/auth/components/AppleEmailSelectionScreen").then((m) => ({
    default: m.AppleEmailSelectionScreen,
  })),
);
