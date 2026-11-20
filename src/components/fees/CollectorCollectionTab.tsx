import React, { useMemo, useState } from 'react';
import {
  UserCheck,
  Users,
  Wallet,
  Smartphone,
  Receipt,
  Printer,
  Search,
  Lock,
  CheckCircle2,
  Eye,
  TrendingUp,
} from 'lucide-react';
import { FeePayment, IncomeVoucher, SchoolProfile, Staff, UserProfile, UserRole } from '../../types';
import {
  DateFilterPeriod,
  getPeriodDisplayLabel,
  summarizeByPaymentMethod,
  toLocalIsoDate,
} from '../../utils/financeFilters';
import {
  CollectorSummary,
  CollectorTransactionSource,
  canViewAllCollectorReports,
  filterCollectorTransactions,
  normalizeCollectorTransactions,
  summarizeByCollector,
} from '../../utils/collectorReports';
import { PeriodFilterBar } from './PeriodFilterBar';
import { CollectorReportPrintModal } from './FinancePrintModals';

interface CollectorCollectionTabProps {
  payments: FeePayment[];
  incomeVouchers: IncomeVoucher[];
  staffList: Staff[];
  currentUser: UserProfile;
  activeRole: UserRole;
  school: SchoolProfile;
  language: 'bn' | 'en';
  formatTaka: (amount: number) => string;
  toBnNumber: (num: number | string) => string;
  formatDate: (dateStr: string) => string;
  amountInWords: (num: number) => string;
  onInspectFeeReceipt?: (receiptNo: string, paymentId: string) => void;
}

export const CollectorCollectionTab: React.FC<CollectorCollectionTabProps> = ({
  payments,
  incomeVouchers,
  staffList,
  currentUser,
  activeRole,
  school,
  language,
  formatTaka,
  toBnNumber,
  formatDate,
  amountInWords,
  onInspectFeeReceipt,
}) => {
  const canViewAll = canViewAllCollectorReports(activeRole);
  const todayIso = toLocalIsoDate();

  const [period, setPeriod] = useState<DateFilterPeriod>('today');
  const [customStart, setCustomStart] = useState<string>(todayIso);
  const [customEnd, setCustomEnd] = useState<string>(todayIso);
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | CollectorTransactionSource>('all');
  const [selectedCollectorKey, setSelectedCollectorKey] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);

  const { transactions: allNormalized, directory } = useMemo(
    () => normalizeCollectorTransactions(payments, incomeVouchers, staffList, currentUser),
    [payments, incomeVouchers, staffList, currentUser]
  );

  const currentUserKey = useMemo(
    () => directory.resolveUserKey(currentUser),
    [directory, currentUser]
  );

  const effectiveCollectorKey = canViewAll ? selectedCollectorKey : currentUserKey;

  // Transactions matching period + source + method + search across authorized collector scope
  const periodScopedAllCollectors = useMemo(
    () =>
      filterCollectorTransactions(allNormalized, {
        period,
        customStart,
        customEnd,
        methodFilter,
        sourceFilter,
        collectorKey: canViewAll ? 'all' : currentUserKey,
        search,
      }),
    [
      allNormalized,
      period,
      customStart,
      customEnd,
      methodFilter,
      sourceFilter,
      canViewAll,
      currentUserKey,
      search,
    ]
  );

  const collectorSummaries: CollectorSummary[] = useMemo(
    () =>
      summarizeByCollector(
        periodScopedAllCollectors,
        directory.identities,
        currentUserKey,
        canViewAll
      ),
    [periodScopedAllCollectors, directory.identities, currentUserKey, canViewAll]
  );

  const visibleTransactions = useMemo(() => {
    if (!canViewAll || effectiveCollectorKey === 'all') {
      return periodScopedAllCollectors;
    }
    return periodScopedAllCollectors.filter((tx) => tx.collectorKey === effectiveCollectorKey);
  }, [canViewAll, effectiveCollectorKey, periodScopedAllCollectors]);

  const methodSummary = useMemo(
    () => summarizeByPaymentMethod(visibleTransactions),
    [visibleTransactions]
  );

  const feeTotal = useMemo(
    () =>
      visibleTransactions
        .filter((t) => t.source === 'fee_receipt')
        .reduce((s, t) => s + t.amount, 0),
    [visibleTransactions]
  );

  const voucherTotal = useMemo(
    () =>
      visibleTransactions
        .filter((t) => t.source === 'income_voucher')
        .reduce((s, t) => s + t.amount, 0),
    [visibleTransactions]
  );

  const myTodaySummary = useMemo(() => {
    const myTodayTxs = filterCollectorTransactions(allNormalized, {
      period: 'today',
      collectorKey: currentUserKey,
    });
    const m = summarizeByPaymentMethod(myTodayTxs);
    return {
      total: m.total,
      cash: m.Cash,
      digital: m.bKash + m.Nagad + m.Rocket + m.Bank + m.Other,
      count: myTodayTxs.length,
    };
  }, [allNormalized, currentUserKey]);

  const periodLabel = getPeriodDisplayLabel(period, language, customStart, customEnd);
  const selectedSummaryObj = collectorSummaries.find((c) => c.collectorKey === effectiveCollectorKey);
  const selectedCollectorLabel = canViewAll
    ? effectiveCollectorKey === 'all'
      ? language === 'bn'
        ? 'সকল হিসাবরক্ষক / কালেক্টর'
        : 'All Accountants / Collectors'
      : selectedSummaryObj?.displayNameBn || selectedSummaryObj?.displayName || 'Collector'
    : currentUser.nameBn || currentUser.name;

  return (
    <div className="space-y-4">
      {/* Role Scope Banner */}
      {!canViewAll ? (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50 via-blue-50 to-emerald-50 border border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-xl shrink-0 shadow-xs">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-extrabold text-slate-900">
                  {language === 'bn'
                    ? `আমার ব্যক্তিগত কালেকশন হিসাব (${currentUser.nameBn || currentUser.name})`
                    : `My Personal Collection Ledger (${currentUser.name})`}
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white border border-indigo-200 text-indigo-700">
                  <Lock className="w-3 h-3" />
                  {language === 'bn' ? 'শুধুমাত্র আপনার নিজের কালেকশন' : 'Personal Scope Only'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {language === 'bn'
                  ? `আজকের মোট: ${formatTaka(myTodaySummary.total)} (${toBnNumber(myTodaySummary.count)}টি রসিদ/ভাউচার) • হাতে নগদ Cash: ${formatTaka(myTodaySummary.cash)} • ডিজিটাল/ব্যাংক: ${formatTaka(myTodaySummary.digital)}`
                  : `Today's Total: ${formatTaka(myTodaySummary.total)} (${myTodaySummary.count} items) • Cash: ${formatTaka(myTodaySummary.cash)} • Digital/Bank: ${formatTaka(myTodaySummary.digital)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{language === 'bn' ? 'আমার হিসাব প্রিন্ট' : 'Print My Sheet'}</span>
          </button>
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-300 rounded-xl shrink-0 border border-emerald-400/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold">
                {language === 'bn'
                  ? 'সুপার অ্যাডমিন কালেক্টর অডিট — কে কত কালেকশন করলো'
                  : 'Super Admin Collector Audit — All Accountants Collection'}
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {language === 'bn'
                  ? 'একাধিক হিসাবরক্ষকের আজকের, সাপ্তাহিক, মাসিক, বাৎসরিক বা কাস্টম তারিখের ফি রসিদ ও আয় ভাউচার একসাথে তুলনা ও যাচাই করুন।'
                  : 'Compare Today, Weekly, Monthly, Yearly, or Custom Date fee receipts & income vouchers across all accountants.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPrintModal(true)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-xs shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{language === 'bn' ? 'অডিট রিপোর্ট প্রিন্ট' : 'Print Audit Report'}</span>
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 bg-emerald-50/70 rounded-2xl border border-emerald-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900">
              {language === 'bn' ? 'নির্বাচিত সময়ে মোট কালেকশন' : 'Selected Period Collection'}
            </span>
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-1.5 text-xl font-black text-emerald-700 tabular-nums">
            {formatTaka(methodSummary.total)}
          </div>
          <div className="text-[11px] text-emerald-800 mt-0.5 tabular-nums">
            {language === 'bn'
              ? `ফি: ${formatTaka(feeTotal)} • আয় ভাউচার: ${formatTaka(voucherTotal)}`
              : `Fees: ${formatTaka(feeTotal)} • Vouchers: ${formatTaka(voucherTotal)}`}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              {language === 'bn' ? 'হাতে নগদ (Cash Handover)' : 'Cash in Hand'}
            </span>
            <Wallet className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-blue-700 tabular-nums">
            {formatTaka(methodSummary.Cash)}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {language === 'bn' ? 'কাউন্টারে নগদ জমা দেওয়ার হিসাব' : 'Physical cash collected'}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              {language === 'bn' ? 'বিকাশ / নগদ / রকেট / ব্যাংক' : 'MFS & Bank'}
            </span>
            <Smartphone className="w-4 h-4 text-purple-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-purple-700 tabular-nums">
            {formatTaka(
              methodSummary.bKash +
                methodSummary.Nagad +
                methodSummary.Rocket +
                methodSummary.Bank +
                methodSummary.Other
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            bKash: {formatTaka(methodSummary.bKash)} • Nagad: {formatTaka(methodSummary.Nagad)}
          </div>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">
              {canViewAll
                ? language === 'bn'
                  ? 'হিসাবরক্ষক ও লেনদেন সংখ্যা'
                  : 'Collectors & Transactions'
                : language === 'bn'
                ? 'আমার রসিদ ও ভাউচার'
                : 'My Receipts & Vouchers'}
            </span>
            <Receipt className="w-4 h-4 text-amber-600" />
          </div>
          <div className="mt-1.5 text-xl font-extrabold text-slate-900 tabular-nums">
            {language === 'bn'
              ? `${toBnNumber(visibleTransactions.length)} টি`
              : `${visibleTransactions.length} Txns`}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {canViewAll
              ? language === 'bn'
                ? `${toBnNumber(collectorSummaries.filter((c) => c.totalCount > 0).length)} / ${toBnNumber(collectorSummaries.length)} জন সক্রিয় কালেক্টর`
                : `${collectorSummaries.filter((c) => c.totalCount > 0).length} / ${collectorSummaries.length} active collectors`
              : periodLabel}
          </div>
        </div>
      </div>

      {/* Period Filter + Collector / Source / Method / Search Controls */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <PeriodFilterBar
          period={period}
          onPeriodChange={setPeriod}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={setCustomStart}
          onCustomEndChange={setCustomEnd}
          language={language}
          compact
        />

        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                language === 'bn'
                  ? 'রসিদ নং, শিক্ষার্থী, ক্রেতা বা কালেক্টরের নাম...'
                  : 'Search receipt, student, payer, collector...'
              }
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {canViewAll && (
            <select
              aria-label="Filter by collector"
              value={selectedCollectorKey}
              onChange={(e) => setSelectedCollectorKey(e.target.value)}
              className="px-3 py-1.5 text-xs border border-indigo-200 rounded-xl bg-indigo-50/70 font-bold text-indigo-950"
            >
              <option value="all">
                {language === 'bn' ? 'সকল হিসাবরক্ষক (সবাই)' : 'All Accountants / Collectors'}
              </option>
              {collectorSummaries.map((c) => (
                <option key={c.collectorKey} value={c.collectorKey}>
                  {c.displayNameBn || c.displayName} ({c.roleLabelBn}) — {formatTaka(c.totalAmount)}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Filter by source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as any)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700"
          >
            <option value="all">{language === 'bn' ? 'সব ধরন (ফি + ভাউচার)' : 'All Types'}</option>
            <option value="fee_receipt">{language === 'bn' ? 'শুধু ফি রসিদ' : 'Fee Receipts Only'}</option>
            <option value="income_voucher">{language === 'bn' ? 'শুধু আয় ভাউচার' : 'Income Vouchers Only'}</option>
          </select>

          <select
            aria-label="Filter by payment method"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 font-semibold text-slate-700"
          >
            <option value="all">{language === 'bn' ? 'সকল মাধ্যম' : 'All Methods'}</option>
            <option value="Cash">Cash (নগদ)</option>
            <option value="bKash">bKash (বিকাশ)</option>
            <option value="Nagad">Nagad (নগদ)</option>
            <option value="Rocket">Rocket (রকেট)</option>
            <option value="Bank">Bank (ব্যাংক)</option>
          </select>
        </div>
      </div>

      {/* Super Admin: Collector-Wise Breakdown Comparison Table */}
      {canViewAll && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <h4 className="font-bold text-slate-900">
                {language === 'bn'
                  ? 'হিসাবরক্ষক ও কালেক্টর ভিত্তিক কালেকশন তালিকা (কে কত টাকা তুলেছে)'
                  : 'Accountant & Collector-Wise Collection Breakdown'}
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {periodLabel} •{' '}
                {language === 'bn'
                  ? 'যেকোনো হিসাবরক্ষকের ওপর ক্লিক করলে নিচে শুধুমাত্র তাঁর বিস্তারিত রসিদগুলো দেখাবে'
                  : 'Click any collector row to inspect their individual transactions below'}
              </p>
            </div>
            {selectedCollectorKey !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedCollectorKey('all')}
                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] cursor-pointer"
              >
                {language === 'bn' ? '× ফিল্টার সরান (সবাই দেখুন)' : '× Show All Collectors'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">#</th>
                  <th className="py-2.5 px-4">{language === 'bn' ? 'হিসাবরক্ষক / কালেক্টর' : 'Collector'}</th>
                  <th className="py-2.5 px-4 text-center">{language === 'bn' ? 'ফি রসিদ' : 'Fee Receipts'}</th>
                  <th className="py-2.5 px-4 text-center">{language === 'bn' ? 'আয় ভাউচার' : 'Vouchers'}</th>
                  <th className="py-2.5 px-4 text-right">{language === 'bn' ? 'নগদ (Cash)' : 'Cash'}</th>
                  <th className="py-2.5 px-4 text-right">{language === 'bn' ? 'বিকাশ / ব্যাংক' : 'MFS / Bank'}</th>
                  <th className="py-2.5 px-4 text-right">{language === 'bn' ? 'মোট কালেকশন' : 'Total'}</th>
                  <th className="py-2.5 px-4 text-right">{language === 'bn' ? 'বিস্তারিত' : 'Inspect'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {collectorSummaries.map((c, idx) => {
                  const isSelected = selectedCollectorKey === c.collectorKey;
                  return (
                    <tr
                      key={c.collectorKey}
                      onClick={() =>
                        setSelectedCollectorKey((prev) =>
                          prev === c.collectorKey ? 'all' : c.collectorKey
                        )
                      }
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-indigo-50/90' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {language === 'bn' ? toBnNumber(idx + 1) : idx + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] shrink-0 ${
                              c.totalAmount > 0
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {(c.displayName || 'A').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{c.displayNameBn || c.displayName}</span>
                              {c.isCurrentUser && (
                                <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[9px] font-bold">
                                  {language === 'bn' ? 'আপনি' : 'You'}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {c.roleLabelBn}
                              {c.email ? ` • ${c.email}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-bold text-slate-800 tabular-nums">{formatTaka(c.feeAmount)}</div>
                        <div className="text-[10px] text-slate-500">
                          {language === 'bn' ? `${toBnNumber(c.feeCount)}টি` : `${c.feeCount}`}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-bold text-slate-800 tabular-nums">{formatTaka(c.voucherAmount)}</div>
                        <div className="text-[10px] text-slate-500">
                          {language === 'bn' ? `${toBnNumber(c.voucherCount)}টি` : `${c.voucherCount}`}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-blue-700 tabular-nums">
                        {formatTaka(c.cashAmount)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-purple-700 tabular-nums">
                        {formatTaka(c.mfsAndBankAmount)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="font-extrabold text-emerald-700 text-sm tabular-nums">
                          {formatTaka(c.totalAmount)}
                        </div>
                        {c.totalAmount > 0 && (
                          <div className="mt-1 flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${Math.min(100, c.sharePercent)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-slate-500 font-semibold">
                              {language === 'bn' ? `${toBnNumber(c.sharePercent)}%` : `${c.sharePercent}%`}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-700'
                          }`}
                        >
                          {isSelected ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          <span>{isSelected ? (language === 'bn' ? 'নির্বাচিত' : 'Selected') : (language === 'bn' ? 'দেখুন' : 'View')}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {collectorSummaries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      {language === 'bn' ? 'কোনো কালেক্টর পাওয়া যায়নি।' : 'No collectors found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detailed Ledger of Receipts & Income Vouchers */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span className="font-bold text-slate-900">
              {language === 'bn' ? 'কালেকশন লেনদেনের বিস্তারিত তালিকা' : 'Collection Transactions Ledger'}
            </span>
            <span className="ml-2 text-[11px] text-indigo-700 font-semibold">
              ({selectedCollectorLabel} • {periodLabel})
            </span>
          </div>
          <span className="font-extrabold text-emerald-700 tabular-nums">
            {language === 'bn'
              ? `${toBnNumber(visibleTransactions.length)}টি লেনদেন • মোট: ${formatTaka(methodSummary.total)}`
              : `${visibleTransactions.length} Transactions • Total: ${formatTaka(methodSummary.total)}`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">{language === 'bn' ? 'তারিখ' : 'Date'}</th>
                <th className="py-2.5 px-4">{language === 'bn' ? 'রসিদ / ভাউচার নং' : 'Ref No'}</th>
                <th className="py-2.5 px-4">{language === 'bn' ? 'ধরন' : 'Type'}</th>
                <th className="py-2.5 px-4">{language === 'bn' ? 'শিক্ষার্থী / ক্রেতা' : 'Payer'}</th>
                <th className="py-2.5 px-4">{language === 'bn' ? 'সংগ্রহকারী' : 'Collected By'}</th>
                <th className="py-2.5 px-4">{language === 'bn' ? 'মাধ্যম' : 'Method'}</th>
                <th className="py-2.5 px-4 text-right">{language === 'bn' ? 'পরিমাণ' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleTransactions.map((tx) => (
                <tr key={`${tx.source}_${tx.id}`} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">{formatDate(tx.date)}</td>
                  <td className="py-2.5 px-4">
                    {tx.source === 'fee_receipt' && onInspectFeeReceipt ? (
                      <button
                        type="button"
                        onClick={() => onInspectFeeReceipt(tx.refNo, tx.id)}
                        className="font-mono font-bold text-blue-700 hover:underline cursor-pointer"
                      >
                        {tx.refNo}
                      </button>
                    ) : (
                      <span className="font-mono font-bold text-emerald-700">{tx.refNo}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        tx.source === 'fee_receipt'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {tx.source === 'fee_receipt'
                        ? language === 'bn'
                          ? 'ফি রসিদ'
                          : 'Fee Receipt'
                        : language === 'bn'
                        ? 'আয় ভাউচার'
                        : 'Income Voucher'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-900">{tx.partyName}</div>
                    <div className="text-[11px] text-slate-500">{tx.subtitle}</div>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-semibold text-slate-800">
                      {tx.collectorNameBn || tx.collectorName}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {tx.paymentMethod}
                    </span>
                    {tx.transactionId && (
                      <div className="text-[10px] font-mono text-blue-600 mt-0.5">{tx.transactionId}</div>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right font-extrabold text-emerald-700 tabular-nums">
                    {formatTaka(tx.amount)}
                  </td>
                </tr>
              ))}
              {visibleTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {language === 'bn'
                      ? 'নির্বাচিত সময়কাল বা ফিল্টারে কোনো কালেকশন পাওয়া যায়নি।'
                      : 'No collection records found for the selected filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showPrintModal && (
        <CollectorReportPrintModal
          transactions={visibleTransactions}
          collectorSummaries={collectorSummaries}
          periodLabel={periodLabel}
          selectedCollectorLabel={selectedCollectorLabel}
          canViewAllCollectors={canViewAll}
          school={school}
          language={language}
          formatTaka={formatTaka}
          toBnNumber={toBnNumber}
          formatDate={formatDate}
          amountInWords={amountInWords}
          onClose={() => setShowPrintModal(false)}
        />
      )}
    </div>
  );
};
