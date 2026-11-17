import { describe, it, expect, beforeEach } from 'vitest';
import { canEditOrDeleteInvoice, canEditOrDeleteFinanceRecord } from '../permissions';
import { Expense, FeeInvoice, FeePayment } from '../../types';

const mockLocalMap: Record<string, string> = {};
const mockSessionMap: Record<string, string> = {};

const createMockStorage = (map: Record<string, string>) => ({
  getItem: (k: string) => (k in map ? map[k] : null),
  setItem: (k: string, v: string) => {
    map[k] = String(v);
  },
  removeItem: (k: string) => {
    delete map[k];
  },
  clear: () => {
    Object.keys(map).forEach((k) => delete map[k]);
  },
  key: (i: number) => Object.keys(map)[i] ?? null,
  get length() {
    return Object.keys(map).length;
  },
});

Object.defineProperty(globalThis, 'localStorage', {
  value: createMockStorage(mockLocalMap),
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: createMockStorage(mockSessionMap),
  configurable: true,
});

import { StorageService } from '../../services/storage';

const makeInvoice = (overrides: Partial<FeeInvoice> = {}): FeeInvoice => ({
  id: 'inv_test_1',
  invoiceNo: 'INV-2026-10001',
  studentId: 'std_1',
  studentNameEn: 'Test Student',
  studentNameBn: 'টেস্ট শিক্ষার্থী',
  className: 'Class 10',
  section: 'A',
  roll: '1',
  session: '2026',
  feeType: 'Monthly Tuition Fee',
  month: 'November 2026',
  amount: 1500,
  discount: 0,
  netAmount: 1500,
  paidAmount: 0,
  dueAmount: 1500,
  dueDate: '2026-11-17',
  status: 'Unpaid',
  ...overrides,
});

const makePayment = (overrides: Partial<FeePayment> = {}): FeePayment => ({
  id: 'pay_test_1',
  receiptNo: 'REC-2026-20001',
  invoiceId: 'inv_test_1',
  studentId: 'std_1',
  studentName: 'Test Student',
  className: 'Class 10 (A)',
  roll: '1',
  amount: 1000,
  paidDate: '2026-11-17',
  paymentMethod: 'Cash',
  collectedBy: 'Accountant',
  ...overrides,
});

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'exp_test_1',
  voucherNo: 'VOUCH-2026-586',
  category: 'Electricity & Utilities',
  title: 'Electricity Bill',
  amount: 555,
  date: '2026-11-17',
  paidTo: 'DESCO',
  paymentMethod: 'Cash',
  approvedBy: 'Accountant',
  ...overrides,
});

describe('Finance Edit/Delete Role Permissions (Invoices, Receipts, Expenses, Cashbook)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('allows only super_admin and master_admin to edit or delete financial records', () => {
    expect(canEditOrDeleteInvoice('super_admin')).toBe(true);
    expect(canEditOrDeleteInvoice('master_admin')).toBe(true);
    expect(canEditOrDeleteFinanceRecord('super_admin')).toBe(true);
    expect(canEditOrDeleteFinanceRecord('master_admin')).toBe(true);

    for (const restricted of [
      'accountant',
      'admin',
      'teacher',
      'student',
      'guardian',
      'receptionist',
      'librarian',
      'gatekeeper',
      null,
      undefined,
    ] as const) {
      expect(canEditOrDeleteInvoice(restricted)).toBe(false);
      expect(canEditOrDeleteFinanceRecord(restricted)).toBe(false);
    }
  });

  it('prevents accountant from updating or deleting an existing invoice in StorageService', () => {
    const inv = makeInvoice();
    StorageService.addInvoice(inv);

    const editedByAccountant: FeeInvoice = {
      ...inv,
      netAmount: 500,
      dueAmount: 500,
      discount: 1000,
    };

    expect(StorageService.updateInvoice(editedByAccountant, 'accountant')).toBe(false);
    expect(StorageService.deleteInvoice(inv.id, 'accountant')).toBe(false);
    expect(StorageService.updateInvoice(editedByAccountant)).toBe(false);
    expect(StorageService.deleteInvoice(inv.id)).toBe(false);

    const stored = StorageService.getInvoices().find((i) => i.id === inv.id);
    expect(stored).toBeDefined();
    expect(stored?.netAmount).toBe(1500);
    expect(stored?.discount).toBe(0);
  });

  it('allows super_admin to update and delete an existing invoice in StorageService', () => {
    const inv = makeInvoice();
    StorageService.addInvoice(inv);

    const editedBySuperAdmin: FeeInvoice = {
      ...inv,
      netAmount: 1200,
      dueAmount: 1200,
      discount: 300,
    };

    expect(StorageService.updateInvoice(editedBySuperAdmin, 'super_admin')).toBe(true);
    const updated = StorageService.getInvoices().find((i) => i.id === inv.id);
    expect(updated?.netAmount).toBe(1200);
    expect(updated?.discount).toBe(300);

    expect(StorageService.deleteInvoice(inv.id, 'super_admin')).toBe(true);
    const afterDelete = StorageService.getInvoices().find((i) => i.id === inv.id);
    expect(afterDelete).toBeUndefined();
  });

  it('prevents accountant from editing or deleting receipts (FeePayment), while allowing super_admin and normal collection', () => {
    const inv = makeInvoice({ id: 'inv_collect_1', invoiceNo: 'INV-2026-20001' });
    StorageService.addInvoice(inv);

    const payment = makePayment({ invoiceId: inv.id, amount: 1000 });
    StorageService.addPayment(payment);

    const afterPay = StorageService.getInvoices().find((i) => i.id === inv.id);
    expect(afterPay?.paidAmount).toBe(1000);
    expect(afterPay?.dueAmount).toBe(500);
    expect(afterPay?.status).toBe('Partial');

    // Accountant cannot edit or delete receipt
    expect(StorageService.updatePayment({ ...payment, amount: 200 }, 'accountant')).toBe(false);
    expect(StorageService.deletePayment(payment.id, 'accountant')).toBe(false);
    expect(StorageService.getPayments().find((p) => p.id === payment.id)?.amount).toBe(1000);

    // Super Admin can edit and delete receipt
    expect(StorageService.updatePayment({ ...payment, amount: 1200 }, 'super_admin')).toBe(true);
    expect(StorageService.getPayments().find((p) => p.id === payment.id)?.amount).toBe(1200);
    expect(StorageService.getInvoices().find((i) => i.id === inv.id)?.paidAmount).toBe(1200);

    expect(StorageService.deletePayment(payment.id, 'super_admin')).toBe(true);
    const afterDeletePay = StorageService.getInvoices().find((i) => i.id === inv.id);
    expect(afterDeletePay?.paidAmount).toBe(0);
    expect(afterDeletePay?.dueAmount).toBe(1500);
    expect(afterDeletePay?.status).toBe('Unpaid');
  });

  it('prevents accountant from editing or deleting expense vouchers, while allowing creation and super_admin edit/delete', () => {
    const exp = makeExpense();
    StorageService.addExpense(exp);

    expect(StorageService.updateExpense({ ...exp, amount: 100 }, 'accountant')).toBe(false);
    expect(StorageService.deleteExpense(exp.id, 'accountant')).toBe(false);
    expect(StorageService.getExpenses().find((e) => e.id === exp.id)?.amount).toBe(555);

    expect(StorageService.updateExpense({ ...exp, amount: 750 }, 'super_admin')).toBe(true);
    expect(StorageService.getExpenses().find((e) => e.id === exp.id)?.amount).toBe(750);

    expect(StorageService.deleteExpense(exp.id, 'super_admin')).toBe(true);
    expect(StorageService.getExpenses().find((e) => e.id === exp.id)).toBeUndefined();
  });
});
