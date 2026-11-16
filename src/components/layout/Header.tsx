import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useSchool } from '../../context/SchoolContext';
import { UserRole } from '../../types';
import {
  GraduationCap,
  Globe,
  UserCheck,
  Cloud,
  CloudCheck,
  RefreshCw,
  Bell,
  Menu,
  ChevronDown,
  ShieldAlert,
  LogOut,
  Building2,
  KeyRound,
  Smartphone,
  ArrowRight,
  X,
} from 'lucide-react';
import { AccountCredentialsModal } from '../auth/AccountCredentialsModal';
import { StorageService } from '../../services/storage';
import { OnlinePaymentRequest } from '../../types';
import { isTabAuthorized } from '../../utils/permissions';
import { SaturdayOffToggle } from '../common/SaturdayOffToggle';
import { CloudSyncService, subscribeToSyncStatus, SyncStatus } from '../../services/cloudSync';
import { resolveSchoolDisplayName } from '../../utils/schoolNameResolver';

interface HeaderProps {
  onToggleSidebar: () => void;
  activeTab: string;
  onNavigate?: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, activeTab, onNavigate }) => {
  const { currentUser, activeRole, saasSession, isFirebaseConnected, syncStatus, syncNow, logout } = useAuth();
  const { language, toggleLanguage, t, toBnNumber, formatTaka } = useLanguage();
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNoticeMenu, setShowNoticeMenu] = useState(false);
  const [showCredsModal, setShowCredsModal] = useState(false);
  const [pendingOnlinePayments, setPendingOnlinePayments] = useState<OnlinePaymentRequest[]>(() =>
    StorageService.getOnlinePaymentRequests().filter((r) => r.status === 'pending')
  );
  const noticeMenuRef = React.useRef<HTMLDivElement>(null);
  const [syncInfo, setSyncInfo] = useState<SyncStatus>({
    isOnline: true,
    isSyncing: false,
    lastSyncedAt: null,
    hasCloudData: true,
    tenantId: 'domain_default',
    domain: 'localhost',
    error: null,
  });

  React.useEffect(() => {
    return subscribeToSyncStatus((st) => setSyncInfo(st));
  }, []);

  React.useEffect(() => {
    const refreshPending = () => {
      const list = StorageService.getOnlinePaymentRequests().filter((r) => r.status === 'pending');
      setPendingOnlinePayments(list);
    };
    refreshPending();
    window.addEventListener('online_payments_updated', refreshPending);
    window.addEventListener('school_cloud_data_synced', refreshPending);
    window.addEventListener('storage', refreshPending);
    return () => {
      window.removeEventListener('online_payments_updated', refreshPending);
      window.removeEventListener('school_cloud_data_synced', refreshPending);
      window.removeEventListener('storage', refreshPending);
    };
  }, []);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (noticeMenuRef.current && !noticeMenuRef.current.contains(e.target as Node)) {
        setShowNoticeMenu(false);
      }
    };
    if (showNoticeMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNoticeMenu]);

  const allRoles: { role: UserRole; labelEn: string; labelBn: string; badgeColor: string }[] = [
    { role: 'super_admin', labelEn: 'Super Admin', labelBn: 'সুপার অ্যাডমিন', badgeColor: 'bg-purple-600 text-white' },
    { role: 'admin', labelEn: 'Head Teacher / Admin', labelBn: 'প্রধান শিক্ষক', badgeColor: 'bg-blue-700 text-white' },
    { role: 'teacher', labelEn: 'Teacher', labelBn: 'সহকারী শিক্ষক', badgeColor: 'bg-emerald-600 text-white' },
    { role: 'accountant', labelEn: 'Accountant', labelBn: 'হিসাবরক্ষক', badgeColor: 'bg-amber-600 text-white' },
    { role: 'student', labelEn: 'Student', labelBn: 'শিক্ষার্থী', badgeColor: 'bg-cyan-600 text-white' },
    { role: 'guardian', labelEn: 'Parent / Guardian', labelBn: 'অভিভাবক', badgeColor: 'bg-teal-600 text-white' },
    { role: 'librarian', labelEn: 'Librarian', labelBn: 'গ্রন্থাগারিক', badgeColor: 'bg-indigo-600 text-white' },
    { role: 'receptionist', labelEn: 'Admission Officer', labelBn: 'ভর্তি কর্মকর্তা', badgeColor: 'bg-rose-600 text-white' },
    { role: 'gatekeeper', labelEn: 'Gate QR Kiosk', labelBn: 'স্কুল গেট কিওস্ক', badgeColor: 'bg-slate-900 text-amber-300 ring-2 ring-amber-400 font-bold' },
  ];

  const currentRoleObj =
    activeRole === 'master_admin'
      ? {
          role: 'master_admin' as UserRole,
          labelEn: 'Master Admin (Platform Owner)',
          labelBn: 'মাস্টার অ্যাডমিন (প্ল্যাটফর্ম)',
          badgeColor: 'bg-gradient-to-r from-red-600 to-amber-600 text-white font-bold',
        }
      : allRoles.find((r) => r.role === activeRole) || allRoles[0];

  const switchableRoles = allRoles;

  const { schoolProfile } = useSchool();
  const isMasterAdmin = activeRole === 'master_admin' || Boolean(saasSession?.principal?.isMasterAdmin);
  const isMasterConsoleMode = isMasterAdmin && !saasSession?.school;

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-6 bg-white border-b border-slate-200 shadow-xs select-none print:hidden">
      {/* Left: Mobile Toggle & School Branding */}
      <div className="flex items-center space-x-3">
        {activeRole !== 'student' && activeRole !== 'guardian' && activeRole !== 'gatekeeper' && !currentUser?.permissions?.onlyQrAttendanceKiosk && (
          <button
            onClick={onToggleSidebar}
            aria-label="Toggle navigation menu"
            className="p-2 -ml-2 text-slate-600 rounded-lg lg:hidden hover:bg-slate-100 focus:outline-none"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-xs overflow-hidden shrink-0">
            {schoolProfile.logoUrl ? (
              <img src={schoolProfile.logoUrl} alt="Logo" className="w-full h-full object-contain p-1" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-blue-700 text-white">
                <GraduationCap className="w-6 h-6" />
              </div>
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-2">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight truncate max-w-[150px] xs:max-w-[200px] sm:max-w-none">
                {isMasterConsoleMode
                  ? 'Smart School BD ERP'
                  : resolveSchoolDisplayName(schoolProfile, saasSession?.school, language)}
              </h1>
              {isMasterConsoleMode ? (
                <span className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-900 text-white rounded">
                  MASTER PLATFORM
                </span>
              ) : (
                <>
                  {saasSession?.school?.schoolId && (
                    <span className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-bold bg-slate-900 text-white rounded">
                      {saasSession.school.schoolId}
                    </span>
                  )}
                </>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 font-medium truncate max-w-[150px] xs:max-w-[200px] sm:max-w-none">
              {isMasterConsoleMode
                ? language === 'bn'
                  ? 'মাল্টি-টেন্যান্ট স্কুল ম্যানেজমেন্ট প্ল্যাটফর্ম'
                  : 'Multi-Tenant School Management Platform'
                : language === 'bn'
                ? `শিক্ষাবর্ষ: ${schoolProfile.currentSession}`
                : `Session: ${schoolProfile.currentSession}`}
            </p>
          </div>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2 md:space-x-3">
        {/* If Gatekeeper, only show live status and logout */}
        {activeRole === 'gatekeeper' || currentUser?.permissions?.onlyQrAttendanceKiosk ? (
          <>
            <div className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="hidden sm:inline">লাইভ গেট কিওস্ক সক্রিয়</span>
            </div>

            <button
              onClick={() => setShowCredsModal(true)}
              title={language === 'bn' ? 'ইউজারনেম ও পাসওয়ার্ড পরিবর্তন করুন' : 'Change Login Credentials & Password'}
              className="flex items-center space-x-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors shadow-2xs"
            >
              <KeyRound className="w-3.5 h-3.5 text-purple-600" />
              <span className="hidden sm:inline">{language === 'bn' ? 'ইউজার/পাসওয়ার্ড' : 'Credentials'}</span>
            </button>

            <button
              onClick={logout}
              title="Sign out of ERP / লগআউট করুন"
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors shadow-xs"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{language === 'bn' ? 'লগআউট' : 'Logout'}</span>
            </button>
          </>
        ) : (
          <>
            {/* Real-time Cloud Sync Status & Manual Push/Pull Button */}
            <button
              onClick={async () => {
                await CloudSyncService.syncBidirectional();
              }}
              disabled={syncInfo.isSyncing}
              title={
                syncInfo.isSyncing
                  ? (language === 'bn' ? 'ক্লাউড ডেটাবেজের সাথে সিঙ্ক হচ্ছে...' : 'Syncing to cloud...')
                  : `${language === 'bn' ? 'ক্লাউড ডেটাবেজ সক্রিয় (Live)' : 'Cloud Database Live'} • ${syncInfo.tenantId || ''} • ${
                      syncInfo.lastSyncedAt
                        ? new Date(syncInfo.lastSyncedAt).toLocaleTimeString()
                        : (language === 'bn' ? 'এইমাত্র' : 'Just now')
                    }`
              }
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                syncInfo.isSyncing
                  ? 'bg-amber-50 border-amber-300 text-amber-800'
                  : syncInfo.error
                  ? 'bg-rose-50 border-rose-300 text-rose-800'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-emerald-600 ${
                  syncInfo.isSyncing ? 'animate-spin text-amber-600' : ''
                }`}
              />
              <span className="hidden sm:inline">
                {syncInfo.isSyncing ? 'সিঙ্ক হচ্ছে...' : 'ক্লাউড সিঙ্ক'}
              </span>
            </button>

            {/* Bilingual Language Switcher */}
            <button
              onClick={toggleLanguage}
              title="Toggle Language / ভাষা পরিবর্তন"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-teal-50 border border-teal-200 text-teal-800 hover:bg-teal-100 transition-colors"
            >
              <Globe className="w-3.5 h-3.5 text-teal-700" />
              <span>{language === 'bn' ? 'English' : 'বাংলা'}</span>
            </button>

            {/* Authenticated Role Badge (Role switching strictly disabled - users only see their authorized dashboard) */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold select-none shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <div className={`px-2 py-0.5 text-xs font-bold rounded-md ${currentRoleObj.badgeColor}`}>
                {language === 'bn' ? currentRoleObj.labelBn : currentRoleObj.labelEn}
              </div>
            </div>

            {/* Online Fee Approval Notification Bell (Super Admin / Admin / Accountant) */}
            {(activeRole === 'super_admin' ||
              activeRole === 'admin' ||
              activeRole === 'accountant' ||
              activeRole === 'master_admin') &&
              isTabAuthorized('fees', activeRole, currentUser) && (
                <div className="relative" ref={noticeMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowNoticeMenu((prev) => !prev)}
                    title={
                      language === 'bn'
                        ? 'অনলাইন ফি অনুমোদন নোটিফিকেশন (বিকাশ/নগদ/রকেট)'
                        : 'Online Fee Approval Notifications'
                    }
                    className={`relative flex items-center space-x-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors shadow-2xs ${
                      pendingOnlinePayments.length > 0
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Bell
                      className={`w-3.5 h-3.5 ${
                        pendingOnlinePayments.length > 0 ? 'text-amber-600 animate-bounce' : 'text-slate-500'
                      }`}
                    />
                    <span className="hidden xl:inline">
                      {language === 'bn' ? 'অনলাইন ফি' : 'Online Fee'}
                    </span>
                    {pendingOnlinePayments.length > 0 && (
                      <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-black bg-rose-600 text-white rounded-full animate-pulse shadow-xs">
                        {language === 'bn'
                          ? toBnNumber(pendingOnlinePayments.length)
                          : pendingOnlinePayments.length}
                      </span>
                    )}
                  </button>

                  {showNoticeMenu && (
                    <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 z-50 overflow-hidden text-xs">
                      <div className="px-4 py-3 bg-gradient-to-r from-indigo-700 via-blue-700 to-indigo-800 text-white flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Smartphone className="w-4 h-4 text-amber-300" />
                          <div>
                            <div className="font-black text-xs">অনলাইন ফি অনুমোদন নোটিফিকেশন</div>
                            <div className="text-[10px] text-indigo-100">
                              অভিভাবকদের বিকাশ, নগদ ও রকেট পেমেন্ট
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowNoticeMenu(false)}
                          className="p-1 rounded-lg hover:bg-white/20 text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                        {pendingOnlinePayments.length === 0 ? (
                          <div className="p-5 text-center text-slate-500">
                            এই মুহূর্তে অনুমোদনের জন্য কোনো অপেক্ষমাণ অনলাইন ফি পেমেন্ট নেই।
                          </div>
                        ) : (
                          pendingOnlinePayments.slice(0, 6).map((req) => (
                            <button
                              key={req.id}
                              type="button"
                              onClick={() => {
                                setShowNoticeMenu(false);
                                onNavigate?.('fees:online_approvals');
                              }}
                              className="w-full text-left px-4 py-3 hover:bg-amber-50/70 transition-colors flex items-start justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center space-x-1.5">
                                  <span className="font-bold text-slate-900 truncate">
                                    {req.studentName}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-black shrink-0 ${
                                      req.paymentMethod === 'bKash'
                                        ? 'bg-pink-100 text-pink-700'
                                        : req.paymentMethod === 'Rocket'
                                        ? 'bg-purple-100 text-purple-700'
                                        : 'bg-orange-100 text-orange-700'
                                    }`}
                                  >
                                    {req.paymentMethod === 'bKash'
                                      ? 'বিকাশ'
                                      : req.paymentMethod === 'Rocket'
                                      ? 'রকেট'
                                      : 'নগদ'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                  {req.className} (রোল {req.studentRoll}) • TrxID:{' '}
                                  <span className="font-mono font-bold text-indigo-700">
                                    {req.transactionId}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                                  {req.feeTitle}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-black text-emerald-700">
                                  {formatTaka(req.amount)}
                                </div>
                                <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                                  অপেক্ষমাণ
                                </span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>

                      <div className="p-2.5 bg-slate-50 border-t border-slate-200">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNoticeMenu(false);
                            onNavigate?.('fees:online_approvals');
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-xs"
                        >
                          <span>অনলাইন পেমেন্ট অনুমোদন পাতায় যান</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

            {/* Universal User / Password Security Center (Visible for ALL Roles on PC + Mobile) */}
            <button
              onClick={() => setShowCredsModal(true)}
              title={
                language === 'bn'
                  ? 'আপনার ইউজারনেম ও পাসওয়ার্ড পরিবর্তন করুন'
                  : 'View or Change Your Login Credentials & Password'
              }
              className="flex items-center space-x-1 px-2 sm:px-2.5 py-1.5 text-xs font-bold rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors shadow-2xs shrink-0 whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5 text-purple-600 shrink-0" />
              <span className="sm:hidden">{language === 'bn' ? 'পাসওয়ার্ড' : 'Pass'}</span>
              <span className="hidden sm:inline">{language === 'bn' ? 'ইউজার/পাসওয়ার্ড' : 'Credentials'}</span>
            </button>

            {/* Current User Pill */}
            <div className="hidden lg:flex items-center space-x-2 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-blue-700">
                {currentUser.name.charAt(0)}
              </div>
              <div className="text-left text-xs leading-none">
                <div className="font-semibold text-slate-800 truncate max-w-[120px]">
                  {language === 'bn' ? currentUser.nameBn || currentUser.name : currentUser.name}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[120px]">
                  {currentUser.email}
                </div>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={logout}
              title="Sign out of ERP / লগআউট করুন"
              className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors shrink-0 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{language === 'bn' ? 'লগআউট' : 'Logout'}</span>
            </button>
          </>
        )}
      </div>

      {/* Universal Account Credentials & User Security Modal */}
      <AccountCredentialsModal
        isOpen={showCredsModal}
        onClose={() => setShowCredsModal(false)}
      />
    </header>
  );
};
