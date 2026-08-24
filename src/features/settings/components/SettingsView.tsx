/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation, Language } from "../../../core/i18n/translations";
import {
 Settings,
 Sun,
 Moon,
 Languages,
 ShieldCheck,
 Trash2,
 Lock,
 Database,
 CheckCircle,
 AlertTriangle,
 ChevronRight,
 X,
 Bell,
 BellOff,
  FileText,
  LifeBuoy,
  Book,
  Scale
} from "lucide-react";
import { HapticFeedback } from "../../../core/device/haptic";

interface SettingsViewProps {
  isActive?: boolean;
 language: Language;
 onLanguageChange: (lang: Language) => void;
 theme: "light" | "dark" | "system";
 onThemeChange: (theme: "light" | "dark" | "system") => void;
 pushAlerts: boolean;
 onPushAlertsChange: (val: boolean) => void;
  onAccountDeleted?: (confirmation: string) => Promise<boolean>;
}

const SettingsActionItem = memo(({
  onClick,
  Icon,
  title,
  subtitle,
  gradientFrom,
  gradientTo,
  iconColor,
  isDanger = false,
  isRtl,
}: {
  onClick: () => void;
  Icon: React.ElementType;
  title: string;
  subtitle: string;
  gradientFrom: string;
  gradientTo: string;
  iconColor: string;
  isDanger?: boolean;
  isRtl: boolean;
}) => (
  <button type="button" 
    onClick={onClick}
    className={`group flex items-center justify-between p-3 -mx-3 rounded-lg transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-elevation-1 dark:hover:shadow-elevation-1 min-h-[56px] cursor-pointer ${isDanger ? 'hover:bg-red-50 dark:hover:bg-med-error/10' : 'hover:bg-neutral-50 dark:hover:bg-white/[0.04]'}`}
  >
    <div className="flex items-center gap-4 text-start">
      <div className={`w-10 h-10 rounded-full bg-gradient-to-b ${gradientFrom} ${gradientTo} shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.03] dark:ring-white/10 flex items-center justify-center shrink-0`}>
        <Icon className={`w-icon-md h-icon-md ${iconColor}`} />
      </div>
      <div className="flex flex-col">
        <span className={`text-base font-medium ${isDanger ? 'text-med-error dark:text-red-400' : 'text-neutral-900 dark:text-white'}`}>
          {title}
        </span>
        <span className={`text-sm mt-1 ${isDanger ? 'text-red-400 dark:text-med-error/80' : 'text-neutral-500 dark:text-[#EBEBF599]'}`}>
          {subtitle}
        </span>
      </div>
    </div>
    <div className="shrink-0 ml-4">
      <ChevronRight className={`w-icon-md h-icon-md transition-colors ${isDanger ? 'text-red-300 dark:text-red-900/60 group-hover:text-med-error' : 'text-neutral-500 dark:text-[#EBEBF599] group-hover:text-neutral-500'}`} />
    </div>
  </button>
));
SettingsActionItem.displayName = "SettingsActionItem";

const SettingsView = function SettingsView({
 language,
 onLanguageChange,
 theme,
 onThemeChange,
 pushAlerts,
 onPushAlertsChange,
 onAccountDeleted,
}: SettingsViewProps) {
 const { t } = useTranslation(language);

 const isRtl = language === "ar";

 const [privacyModalInfo, setPrivacyModalInfo] = useState<{title: string, desc: string} | null>(null);

 // Account Self-deletion state
 const [showDeletionConfirm, setShowDeletionConfirm] = useState(false);
 const [deleteInput, setDeleteInput] = useState("");
 const [isDeleting, setIsDeleting] = useState(false);
 const [deleteError, setDeleteError] = useState("");
 const [deleteSuccess, setDeleteSuccess] = useState(false);

  const closePrivacyModal = useCallback(() => {
    setPrivacyModalInfo(null);
    HapticFeedback.selection();
  }, []);

  const openPrivacyModal = useCallback((title: string, desc: string) => {
    setPrivacyModalInfo({ title, desc });
    HapticFeedback.selection();
  }, []);

  const handleOpenDataCollection = useCallback(() => {
    openPrivacyModal(
      isRtl ? "جمع البيانات الأكاديمية" : "Data Collection",
      isRtl ? "يتم فقط حفظ بيانات التقدم الأكاديمي، النقاط، والبريد الإلكتروني المسجل بشكل آمن لتشغيل لوحة الشرف الشخصية والمزامنة الأكاديمية." : "We store progress ledger statistics, points logs, and registered emails to power your personalized study dashboard and student directory."
    );
  }, [isRtl, openPrivacyModal]);

  const handleOpenCookieSession = useCallback(() => {
    openPrivacyModal(
      isRtl ? "سياسة ملفات تعريف الارتباط" : "Cookie & Session",
      isRtl ? "يستخدم التطبيق ملفات تعريف ارتباط أساسية آمنة (HTTP-Only) لحفظ جلسة الدخول وتأمين الاتصال دون أي إعلانات أو تتبع خارجي." : "Our app uses secure HTTP-Only session cookies strictly to verify student credentials and protect session states. No tracking, zero third-party ads."
    );
  }, [isRtl, openPrivacyModal]);

  const handleOpenTracking = useCallback(() => {
    openPrivacyModal(
      isRtl ? "عدم وجود تتبع خارجي" : "Tracking & Analytics",
      isRtl ? "مبني وفق مبدأ الخصوصية أولاً. لا توجد برمجيات تتبع خارجي (مثل فيسبوك أو جوجل أناليتكس) ولا يتم بيع أو مشاركة بياناتك مطلقاً." : "Privacy first. No external telemetry SDKs or analytics engines are embedded. Your activity is kept exclusively private to the platform."
    );
  }, [isRtl, openPrivacyModal]);

  const initiateDelete = useCallback(() => {
    setShowDeletionConfirm(true);
    setDeleteInput("");
    setDeleteError("");
    setDeleteSuccess(false);
    HapticFeedback.selection();
  }, []);

  const handleDeleteInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDeleteInput(e.target.value);
  }, []);

  const cancelDelete = useCallback(() => {
    if (!isDeleting) {
      setShowDeletionConfirm(false);
      setDeleteInput("");
      setDeleteError("");
      HapticFeedback.selection();
    }
  }, [isDeleting]);

  const handlePushAlertsToggle = useCallback(() => {
    onPushAlertsChange(!pushAlerts);
    HapticFeedback.selection();
  }, [onPushAlertsChange, pushAlerts]);

  const handleThemeLight = useCallback(() => {
    onThemeChange("light");
    HapticFeedback.selection();
  }, [onThemeChange]);

  const handleThemeDark = useCallback(() => {
    onThemeChange("dark");
    HapticFeedback.selection();
  }, [onThemeChange]);

  const handleThemeSystem = useCallback(() => {
    onThemeChange("system");
    HapticFeedback.selection();
  }, [onThemeChange]);

  const handleLangEn = useCallback(() => {
    onLanguageChange("en");
    HapticFeedback.selection();
  }, [onLanguageChange]);

  const handleLangAr = useCallback(() => {
    onLanguageChange("ar");
    HapticFeedback.selection();
  }, [onLanguageChange]);

 const handleDeleteAccount = useCallback(async (e: React.FormEvent) => {
 e.preventDefault();
  if (deleteInput !== "DELETE") {
  setDeleteError(
  isRtl
  ? "اكتب DELETE بأحرف إنجليزية كبيرة لتأكيد الحذف."
  : "Type DELETE in uppercase English letters to confirm deletion.",
 );
 HapticFeedback.notification("error");
 return;
 }

 try {
 setIsDeleting(true);
 setDeleteError("");
 HapticFeedback.selection();

 if (onAccountDeleted) {
  const success = await onAccountDeleted(deleteInput);
 if (success) {
 setDeleteSuccess(true);
 HapticFeedback.notification("success");
 } else {
 setDeleteError(
 isRtl
 ? "فشل حذف الحساب. الرجاء المحاولة مرة أخرى لاحقاً."
 : "Failed to delete account. Please try again later.",
 );
 HapticFeedback.notification("error");
 }
 }
 } catch (err: any) {
 setDeleteError(
 err?.message ||
 (isRtl
 ? "حدث خطأ غير متوقع أثناء حذف الحساب."
 : "An unexpected error occurred during account deletion."),
 );
 HapticFeedback.notification("error");
 } finally {
 setIsDeleting(false);
 }
 }, [deleteInput, isRtl, onAccountDeleted]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.currentTarget.click();
    }
  }, []);

  return (
 <div
 id="settings_panel"
  className="settings-view-root space-y-4 animate-fadeIn pb-[calc(5rem+env(safe-area-inset-bottom,0px))] px-2 sm:px-0"
 style={{ direction: isRtl ? "rtl" : "ltr" }}
 >
 {/* 1. Account & System Preferences */}
 <div className="bg-white dark:bg-[#2C2C2E] border border-neutral-200/40 dark:border-white/[0.10] p-4 rounded-lg shadow-elevation-1 space-y-1">
 <h3 className="font-semibold text-base text-neutral-800 dark:text-white flex items-center gap-2 mb-3">
 <Settings className="w-icon-sm h-icon-sm text-neutral-500" />
 {isRtl ? "تفضيلات النظام والحساب" : "Account & System Preferences"}
 </h3>

 {/* Interface Theme Segmented Control */}
 <div className="group flex items-center justify-between p-3 -mx-3 rounded-lg hover:bg-neutral-50 dark:hover:bg-white/[0.04] transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-elevation-1 dark:hover:shadow-elevation-1 min-h-[56px]">
 <div className="flex items-center gap-4">
 <div className="w-10 h-10 rounded-full bg-gradient-to-b from-indigo-50 to-indigo-100/50 dark:from-indigo-500/20 dark:to-indigo-500/10 shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.03] dark:ring-white/10 flex items-center justify-center shrink-0">
 <Sun className="w-icon-md h-icon-md text-indigo-500 dark:hidden" />
 <Moon className="w-icon-md h-icon-md text-indigo-400 hidden dark:block" />
 </div>
 <div className="flex flex-col">
 <span className="text-base font-medium text-neutral-900 dark:text-white">
 {isRtl ? "مظهر الواجهة" : "Interface Theme"}
 </span>
 <span className="text-sm text-neutral-500 dark:text-[#EBEBF599] mt-1">
 {isRtl ? "تخصيص ألوان التطبيق" : "Customize application colors"}
 </span>
 </div>
 </div>
 <div className="settings-segment shrink-0 ml-4 flex bg-neutral-100 dark:bg-[#2C2C2E]/80 p-1 rounded-lg text-sm font-medium">
 <button
 onClick={handleThemeLight}
 className={`px-3 py-2 rounded-md settings-segment-btn transition ${theme === "light" ? "bg-white dark:bg-neutral-700 shadow-elevation-1 text-neutral-900 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"}`}
 >
 {isRtl ? "فاتح" : "Light"}
 </button>
 <button
 onClick={handleThemeDark}
 className={`px-3 py-2 rounded-md settings-segment-btn transition ${theme === "dark" ? "bg-white dark:bg-neutral-700 shadow-elevation-1 text-neutral-900 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"}`}
 >
 {isRtl ? "داكن" : "Dark"}
 </button>
 <button
 onClick={handleThemeSystem}
 className={`px-3 py-2 rounded-md settings-segment-btn transition ${theme === "system" ? "bg-white dark:bg-neutral-700 shadow-elevation-1 text-neutral-900 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"}`}
 >
 {isRtl ? "تلقائي" : "Auto"}
 </button>
 </div>
 </div>

 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 {/* Clinical Language Toggle */}
 <div className="group flex items-center justify-between p-3 -mx-3 rounded-lg hover:bg-neutral-50 dark:hover:bg-white/[0.04] transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-elevation-1 dark:hover:shadow-elevation-1 min-h-[56px]">
 <div className="flex items-center gap-4">
 <div className="w-10 h-10 rounded-full bg-gradient-to-b from-blue-50 to-blue-100/50 dark:from-blue-500/20 dark:to-blue-500/10 shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.03] dark:ring-white/10 flex items-center justify-center shrink-0">
 <Languages className="w-icon-md h-icon-md text-med-blue dark:text-blue-400" />
 </div>
 <div className="flex flex-col">
 <span className="text-base font-medium text-neutral-900 dark:text-white">
 {isRtl ? "لغة التطبيق السريرية" : "Clinical Language"}
 </span>
 <span className="text-sm text-neutral-500 dark:text-[#EBEBF599] mt-1">
 {isRtl ? "اختر لغة الواجهة" : "Select interface language"}
 </span>
 </div>
 </div>
 <div className="settings-segment shrink-0 ml-4 flex bg-neutral-100 dark:bg-[#2C2C2E]/80 p-1 rounded-lg text-sm font-medium">
 <button
 onClick={handleLangEn}
 className={`px-3 py-2 rounded-md settings-segment-btn transition ${language === "en" ? "bg-white dark:bg-neutral-700 shadow-elevation-1 text-neutral-900 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"}`}
 >
 English
 </button>
 <button
 onClick={handleLangAr}
 className={`px-3 py-2 rounded-md settings-segment-btn transition ${language === "ar" ? "bg-white dark:bg-neutral-700 shadow-elevation-1 text-neutral-900 dark:text-white" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-500 dark:text-[#EBEBF599]"}`}
 >
 العربية
 </button>
 </div>
 </div>

 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 {/* Academic Alerts Switch */}
 <div 
 className="group flex items-center justify-between p-3 -mx-3 rounded-lg hover:bg-neutral-50 dark:hover:bg-white/[0.04] transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-elevation-1 dark:hover:shadow-elevation-1 min-h-[56px] cursor-pointer"
 role="button" tabIndex={0} onKeyDown={handleKeyDown} onClick={handlePushAlertsToggle}
 >
 <div className="flex items-center gap-4 pointer-events-none">
 <div className={`w-10 h-10 rounded-full bg-gradient-to-b ${pushAlerts ? 'from-emerald-50 to-emerald-100/50 dark:from-emerald-500/20 dark:to-emerald-500/10' : 'from-neutral-50 to-neutral-100/50 dark:from-neutral-500/20 dark:to-neutral-500/10'} shadow-elevation-1 dark:shadow-[0_2px_10px_rgba(0,0,0,0.4)] ring-1 ring-black/[0.03] dark:ring-white/10 flex items-center justify-center shrink-0`}>
 {pushAlerts ? (
 <Bell className="w-icon-md h-icon-md text-emerald-500 dark:text-emerald-400" />
 ) : (
 <BellOff className="w-icon-md h-icon-md text-neutral-500 dark:text-[#EBEBF599]" />
 )}
 </div>
 <div className="flex flex-col">
 <span className="text-base font-medium text-neutral-900 dark:text-white">
 {isRtl ? "تنبيهات أكاديمية" : "Academic Alerts"}
 </span>
 <span className="text-sm text-neutral-500 dark:text-[#EBEBF599] mt-1">
 {isRtl ? "تلقي الإشعارات الهامة" : "Receive important notifications"}
 </span>
 </div>
 </div>
 <div className="shrink-0 ml-4 pointer-events-none">
 <div className={`relative inline-flex h-8 w-12 items-center rounded-full transition-colors ${pushAlerts ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}>
 <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition shadow-elevation-1 ${pushAlerts ? (isRtl ? '-translate-x-[26px]' : 'translate-x-[26px]') : (isRtl ? '-translate-x-1' : 'translate-x-1')}`} />
 </div>
 </div>
 </div>
 </div>

 {/* 2. Privacy & Security */}
 <div className="bg-white dark:bg-[#2C2C2E] border border-neutral-200/40 dark:border-white/[0.10] p-4 rounded-lg shadow-elevation-1 space-y-1">
 <h3 className="font-semibold text-base text-neutral-800 dark:text-white flex items-center gap-2 mb-3">
 <ShieldCheck className="w-icon-sm h-icon-sm text-emerald-500" />
 {isRtl ? "الخصوصية والأمان" : "Privacy & Security"}
 </h3>
 
 <div className="flex flex-col">
 <SettingsActionItem
  onClick={handleOpenDataCollection}
  Icon={Database}
  title={isRtl ? "جمع البيانات الأكاديمية" : "Data Collection"}
  subtitle={isRtl ? "تعرف على كيفية استخدامنا لبياناتك" : "Learn how we use your data"}
  gradientFrom="from-teal-50 dark:from-teal-500/20"
  gradientTo="to-teal-100/50 dark:to-teal-500/10"
  iconColor="text-teal-500 dark:text-teal-400"
  isRtl={isRtl}
/>
 
 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 <SettingsActionItem
  onClick={handleOpenCookieSession}
  Icon={Lock}
  title={isRtl ? "سياسة ملفات تعريف الارتباط" : "Cookie & Session"}
  subtitle={isRtl ? "إعدادات الأمان وجلسات الدخول" : "Security and session settings"}
  gradientFrom="from-orange-50 dark:from-orange-500/20"
  gradientTo="to-orange-100/50 dark:to-orange-500/10"
  iconColor="text-orange-500 dark:text-orange-400"
  isRtl={isRtl}
/>

 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 <SettingsActionItem
  onClick={handleOpenTracking}
  Icon={ShieldCheck}
  title={isRtl ? "عدم وجود تتبع خارجي" : "Tracking & Analytics"}
  subtitle={isRtl ? "نحن لا نتتبع نشاطك" : "We do not track your activity"}
  gradientFrom="from-purple-50 dark:from-purple-500/20"
  gradientTo="to-purple-100/50 dark:to-purple-500/10"
  iconColor="text-purple-500 dark:text-purple-400"
  isRtl={isRtl}
/>
 </div>
 </div>

 {/* Legal & Support */}
 <div className="bg-white dark:bg-[#2C2C2E] border border-neutral-200/40 dark:border-white/[0.10] p-4 rounded-lg shadow-elevation-1 space-y-1 mt-4">
 <h3 className="font-semibold text-base text-neutral-800 dark:text-white flex items-center gap-2 mb-3">
 <Scale className="w-icon-sm h-icon-sm text-neutral-500" />
 {isRtl ? "القانونية والدعم" : "Legal & Support"}
 </h3>
 
 <div className="flex flex-col">
 <SettingsActionItem
  onClick={() => { window.location.hash = "#privacy"; }}
  Icon={ShieldCheck}
  title={isRtl ? "سياسة الخصوصية" : "Privacy Policy"}
  subtitle={isRtl ? "كيفية تعاملنا مع بياناتك الأكاديمية" : "How we handle your academic data"}
  gradientFrom="from-blue-50 dark:from-blue-500/20"
  gradientTo="to-blue-100/50 dark:to-blue-500/10"
  iconColor="text-blue-500 dark:text-blue-400"
  isRtl={isRtl}
/>
 
 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 <SettingsActionItem
  onClick={() => { window.location.hash = "#terms"; }}
  Icon={FileText}
  title={isRtl ? "شروط الخدمة" : "Terms of Service"}
  subtitle={isRtl ? "القواعد والشروط للاستخدام" : "Rules and conditions for usage"}
  gradientFrom="from-cyan-50 dark:from-cyan-500/20"
  gradientTo="to-cyan-100/50 dark:to-cyan-500/10"
  iconColor="text-cyan-500 dark:text-cyan-400"
  isRtl={isRtl}
/>

 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 <SettingsActionItem
  onClick={() => { window.location.hash = "#support"; }}
  Icon={LifeBuoy}
  title={isRtl ? "مركز المساعدة والدعم" : "Help & Support Center"}
  subtitle={isRtl ? "اتصل بنا أو ابحث عن الإجابات" : "Contact us or find answers"}
  gradientFrom="from-indigo-50 dark:from-indigo-500/20"
  gradientTo="to-indigo-100/50 dark:to-indigo-500/10"
  iconColor="text-indigo-500 dark:text-indigo-400"
  isRtl={isRtl}
/>

 <div className="h-0 w-full bg-black/5 dark:bg-white/[0.08] my-1" />

 <SettingsActionItem
  onClick={() => { window.location.hash = "#disclaimer"; }}
  Icon={Book}
  title={isRtl ? "إخلاء المسؤولية الطبية" : "Medical Disclaimer"}
  subtitle={isRtl ? "إشعار هام للاستخدام الأكاديمي" : "Important notice for academic use"}
  gradientFrom="from-rose-50 dark:from-rose-500/20"
  gradientTo="to-rose-100/50 dark:to-rose-500/10"
  iconColor="text-rose-500 dark:text-rose-400"
  isRtl={isRtl}
/>
 </div>
 </div>

 {/* Danger Zone */}
 <div className="bg-white dark:bg-[#2C2C2E] border border-neutral-200/40 dark:border-white/[0.10] p-4 rounded-lg shadow-elevation-1 space-y-1 mt-4">
 <h3 className="font-semibold text-base text-neutral-800 dark:text-white flex items-center gap-2 mb-3">
 <AlertTriangle className="w-icon-sm h-icon-sm text-med-error" />
 {isRtl ? "منطقة الخطر" : "Danger Zone"}
 </h3>
 
 <div className="flex flex-col">
 <SettingsActionItem
  onClick={initiateDelete}
  Icon={Trash2}
  title={isRtl ? "حذف بيانات الحساب" : "Delete Account Data"}
  subtitle={isRtl ? "حذف الحساب يمحو كل البيانات الأكاديمية نهائياً" : "Expunge all academic progress permanently"}
  gradientFrom="from-red-50 dark:from-red-500/20"
  gradientTo="to-red-100/50 dark:to-red-500/10"
  iconColor="text-med-error dark:text-red-400"
  isDanger={true}
  isRtl={isRtl}
/>
 </div>
 </div>

 <div className="mt-8 mb-6 flex flex-col items-center justify-center text-center space-y-2 px-4 pb-8">
 <h4 className="text-sm font-semibold text-[#8e8e93]">
 99's Guide • Bulletin
 </h4>
 <p className="text-xs text-[#8e8e93] max-w-md">
 Designed for medical students. Features dual-language localization, fully persistent JSON databases, and custom study forest orchards. If you encounter any academic errors or timetable conflicts, reach out to administrators.
 </p>
 <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-xs text-[#8e8e93]">
  <span>Version: 1.0.0</span>
 <span>•</span>
 <span>Branch: Summer Clerkships</span>
 </div>
 </div>

 <AnimatePresence>
 {showDeletionConfirm && (
  <div className="mobile-dialog-shell fixed inset-0 z-[100] flex items-center justify-center p-4">
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 onClick={cancelDelete}
 className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-pointer"
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.95, y: 10 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.95, y: 10 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }} className="mobile-dialog-panel relative w-full max-w-sm bg-white dark:bg-[#2C2C2E] rounded-2xl p-6 shadow-elevation-3 border border-neutral-200/50 dark:border-white/[0.10]"
 >
 <div className="flex justify-between items-start mb-4">
 <h3 className="font-semibold text-base text-neutral-900 dark:text-white">
 {isRtl ? "تأكيد حذف الحساب" : "Confirm Account Deletion"}
 </h3>
 <button
 aria-label={isRtl ? "إلغاء" : "Cancel"}
 type="button"
 onClick={cancelDelete}
  className="min-h-11 min-w-11 p-2 -mr-2 -mt-2 flex items-center justify-center text-neutral-500 dark:text-[#EBEBF599] hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
 >
 <X className="w-icon-md h-icon-md" />
 </button>
 </div>

 {deleteSuccess ? (
 <div className="flex flex-col items-center justify-center py-4 space-y-3">
 <CheckCircle className="w-icon-xl h-icon-xl text-emerald-500" />
 <p className="text-sm text-emerald-600 dark:text-emerald-400 text-center font-medium">
 {isRtl ? "تم حذف بياناتك بنجاح." : "Account expunged successfully."}
 </p>
 </div>
 ) : (
 <form onSubmit={handleDeleteAccount} className="space-y-4">
 <p className="text-sm text-neutral-600 dark:text-[#EBEBF599]">
 {isRtl
  ? "هذا الإجراء لا يمكن التراجع عنه. سيتم محو جميع بياناتك الأكاديمية وسجلاتك بشكل دائم. اكتب DELETE بأحرف إنجليزية كبيرة لتأكيد الحذف."
  : "This action is irreversible. All your academic data, streaks, and calendar events will be permanently erased. Type DELETE in uppercase English letters to confirm."}
 </p>
 
 <div>
 <input aria-label="Input field"
  type="text"
  value={deleteInput}
  onChange={handleDeleteInputChange}
  placeholder="DELETE"
  autoComplete="off"
  autoCapitalize="characters"
  spellCheck={false}
 disabled={isDeleting}
 className="w-full px-3 py-3 rounded-lg border border-neutral-300 dark:border-white/[0.15] bg-white dark:bg-[#1C1C1E] text-sm text-neutral-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-red-500 disabled:opacity-50 transition-shadow"
 />
 {deleteError && (
 <p className="text-xs text-med-error font-medium leading-none mt-2">
 {deleteError}
 </p>
 )}
 </div>

 <div className="flex items-center gap-3 pt-4">
 <button
 type="button"
 disabled={isDeleting}
 onClick={cancelDelete}
 className="flex-1 px-4 py-3 bg-transparent border border-neutral-200 dark:border-white/[0.15] text-neutral-700 dark:text-[#EBEBF599] font-medium text-base rounded-lg hover:bg-neutral-50 dark:hover:bg-white/[0.12] transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-elevation-1  disabled:opacity-50 disabled:pointer-events-none"
 >
 {isRtl ? "إلغاء" : "Cancel"}
 </button>
 <button
 type="submit"
  disabled={isDeleting || deleteInput !== "DELETE"}
 className="flex-1 px-4 py-3 bg-red-50 dark:bg-med-error/10 hover:bg-red-100 dark:hover:bg-med-error/20 text-med-error dark:text-red-400 font-medium text-base rounded-lg transition duration-[180ms] ease-out hover:-translate-y-[1px] shadow-elevation-1 flex items-center justify-center gap-2  disabled:opacity-50 disabled:pointer-events-none"
 >
 {isDeleting && (
 <span className="w-icon-sm h-icon-sm border-2 border-red-500/30 border-t-red-600 rounded-full animate-spin shrink-0" />
 )}
 {isRtl ? "حذف نهائياً" : "Permanently Delete"}
 </button>
 </div>
 </form>
 )}
 </motion.div>
 </div>
 )}
 </AnimatePresence>

 <AnimatePresence>
 {privacyModalInfo && (
 <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
 <motion.div
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 onClick={closePrivacyModal}
 className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-pointer"
 />
 <motion.div
 initial={{ opacity: 0, scale: 0.95, y: 10 }}
 animate={{ opacity: 1, scale: 1, y: 0 }}
 exit={{ opacity: 0, scale: 0.95, y: 10 }}
 transition={{ type: "spring", stiffness: 500, damping: 35, mass: 1 }} className="relative w-full max-w-sm bg-white dark:bg-[#2C2C2E] rounded-2xl p-6 shadow-elevation-3 border border-neutral-200/50 dark:border-white/[0.10]"
 >
 <div className="flex justify-between items-start mb-4">
 <h3 className="font-display font-semibold text-body text-neutral-900 dark:text-white">
 {privacyModalInfo.title}
 </h3>
 <button
 aria-label={isRtl ? "إغلاق" : "Close"}
 type="button"
 onClick={closePrivacyModal}
 className="p-1 -mr-2 -mt-2 text-neutral-500 dark:text-[#EBEBF599] hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
 >
 <X className="w-icon-md h-icon-md" />
 </button>
 </div>
 <p className="text-caption text-neutral-600 dark:text-[#EBEBF599] max-h-[60vh] overflow-y-auto overscroll-y-contain">
 {privacyModalInfo.desc}
 </p>
 <button
 type="button"
 onClick={closePrivacyModal}
 className="w-full mt-6 py-3 bg-neutral-900 dark:bg-white !text-white dark:!text-neutral-900 font-semibold text-base rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-100 transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-elevation-1 dark:hover:shadow-elevation-1 shadow-elevation-1"
 >
 {isRtl ? "إغلاق" : "Close"}
 </button>
 </motion.div>
 </div>
 )}
 </AnimatePresence>
 </div>
 );
};

export default memo(SettingsView);
