import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { createSaasRouter } from '../router';
import {
  InMemoryAuthProvider,
  InMemoryDatabaseProvider,
} from '../providers/inMemoryProvider';

function setupTestServer(initialDateIso = '2026-05-01T10:00:00.000Z') {
  let currentNow = new Date(initialDateIso);
  const auth = new InMemoryAuthProvider();
  const db = new InMemoryDatabaseProvider();

  const masterEmail = 'owner@smartschoolbd.com';
  db.masterAdminEmails.add(masterEmail);
  const masterToken = auth.seedMasterAdmin(masterEmail, 'master_uid_1');

  const app = express();
  app.use(express.json());
  app.use(
    '/api/saas',
    createSaasRouter({
      db,
      auth,
      nowProvider: () => currentNow,
      adminSdkReady: true,
    })
  );

  return {
    app,
    auth,
    db,
    masterToken,
    setNow: (iso: string) => {
      currentNow = new Date(iso);
    },
    advanceDays: (days: number) => {
      currentNow = new Date(currentNow.getTime() + days * 24 * 60 * 60 * 1000);
    },
  };
}

describe('SmartSchoolBD Multi-Tenant SaaS Platform API & Security Tests', () => {
  let ctx: ReturnType<typeof setupTestServer>;

  beforeEach(() => {
    ctx = setupTestServer('2026-05-01T10:00:00.000Z');
  });

  async function createTestSchool(overrides: Partial<Record<string, any>> = {}) {
    const payload = {
      schoolName: 'Dhaka Model High School',
      schoolCode: 'DMHS01',
      address: 'Mirpur-10, Dhaka',
      contactNumber: '01711000111',
      email: 'info@dmhs.edu.bd',
      principalName: 'Prof. Rafiqul Islam',
      adminName: 'Kamrul Hasan',
      adminEmail: 'admin@dmhs.edu.bd',
      adminPassword: 'Password@123',
      initialPlan: 'monthly',
      startDate: '2026-05-01T10:00:00.000Z',
      activateImmediately: true,
      ...overrides,
    };

    return request(ctx.app)
      .post('/api/saas/master/schools')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send(payload);
  }

  it('1. Master Admin can create multiple schools (SCH001, SCH002) and assigns claims', async () => {
    const res1 = await createTestSchool();
    expect(res1.status).toBe(201);
    expect(res1.body.school.schoolId).toBe('SCH001');
    expect(res1.body.school.status).toBe('active');

    const res2 = await createTestSchool({
      schoolName: 'Chattogram Ideal Academy',
      schoolCode: 'CIA02',
      email: 'info@cia.edu.bd',
      adminEmail: 'admin@cia.edu.bd',
      initialPlan: 'quarterly',
    });
    expect(res2.status).toBe(201);
    expect(res2.body.school.schoolId).toBe('SCH002');

    // Verify custom claims set on Firebase Auth mock
    const claims1 = ctx.auth.getUserClaims(res1.body.school.adminUid);
    expect(claims1).toEqual({ schoolId: 'SCH001', schoolRole: 'super_admin', isMasterAdmin: false });
  });

  it('2. Rejects duplicate school codes and duplicate admin emails', async () => {
    const first = await createTestSchool();
    expect(first.status).toBe(201);

    const dupCode = await createTestSchool({
      schoolCode: 'dmhs01', // case-insensitive duplicate
      adminEmail: 'other@dmhs.edu.bd',
    });
    expect(dupCode.status).toBe(409);
    expect(dupCode.body.code).toBe('DUPLICATE_SCHOOL_CODE');

    const dupEmail = await createTestSchool({
      schoolCode: 'DMHS99',
      adminEmail: 'ADMIN@DMHS.EDU.BD',
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe('DUPLICATE_ADMIN_EMAIL');
  });

  it('3 & 4. Strict multi-tenant isolation: School A cannot access School B data and vice versa', async () => {
    const s1 = await createTestSchool();
    const s2 = await createTestSchool({
      schoolName: 'Sylhet Scholars School',
      schoolCode: 'SSS02',
      adminEmail: 'admin@sss.edu.bd',
    });

    const tokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');
    const tokenB = ctx.auth.issueTestTokenForEmail('admin@sss.edu.bd');

    // School A saves student data
    const putA = await request(ctx.app)
      .put('/api/saas/tenant/slices/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ school_erp_students: [{ id: 'stu_a1', nameEn: 'Student A' }] });
    expect(putA.status).toBe(200);

    // School B saves student data
    const putB = await request(ctx.app)
      .put('/api/saas/tenant/slices/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ school_erp_students: [{ id: 'stu_b1', nameEn: 'Student B' }] });
    expect(putB.status).toBe(200);

    // School A attempts to read School B via query param -> 403 CROSS_TENANT_FORBIDDEN
    const crossReadA = await request(ctx.app)
      .get(`/api/saas/tenant/slices?schoolId=${s2.body.school.schoolId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(crossReadA.status).toBe(403);
    expect(crossReadA.body.code).toBe('CROSS_TENANT_FORBIDDEN');

    // School B attempts to overwrite School A via body payload -> 403 CROSS_TENANT_FORBIDDEN
    const crossWriteB = await request(ctx.app)
      .put('/api/saas/tenant/slices/students')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        schoolId: s1.body.school.schoolId,
        school_erp_students: [{ id: 'hacked', nameEn: 'Hacked' }],
      });
    expect(crossWriteB.status).toBe(403);
    expect(crossWriteB.body.code).toBe('CROSS_TENANT_FORBIDDEN');

    // Verify School A & School B still have only their own isolated records
    const readA = await request(ctx.app)
      .get('/api/saas/tenant/slices')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(readA.status).toBe(200);
    expect(readA.body.slices.students.school_erp_students[0].nameEn).toBe('Student A');

    const readB = await request(ctx.app)
      .get('/api/saas/tenant/slices')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(readB.status).toBe(200);
    expect(readB.body.slices.students.school_erp_students[0].nameEn).toBe('Student B');
  });

  it('5, 6 & 16. Active subscription allows access; expired subscription blocks access using server time without deleting data', async () => {
    await createTestSchool({ initialPlan: 'monthly' });
    const tokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Active state allows writing and reading
    await request(ctx.app)
      .put('/api/saas/tenant/slices/students')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ school_erp_students: [{ id: 'stu_1', nameEn: 'Preserved Student' }] })
      .expect(200);

    const meActive = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(meActive.status).toBe(200);
    expect(meActive.body.accessAllowed).toBe(true);
    expect(meActive.body.subscription.remainingDays).toBe(30);

    // Advance server clock 31 days past 30-day Monthly expiry
    ctx.advanceDays(31);

    const meExpired = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(meExpired.status).toBe(200);
    expect(meExpired.body.accessAllowed).toBe(false);
    expect(meExpired.body.blockReason).toBe('SUBSCRIPTION_EXPIRED');
    expect(meExpired.body.subscription.effectiveStatus).toBe('Expired');

    // Protected school endpoints must return 403 SUBSCRIPTION_EXPIRED
    const blockedSliceRead = await request(ctx.app)
      .get('/api/saas/tenant/slices')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(blockedSliceRead.status).toBe(403);
    expect(blockedSliceRead.body.code).toBe('SUBSCRIPTION_EXPIRED');

    // Data MUST NOT be deleted after expiry -> confirm via Master Admin extension + re-read
    const extendRes = await request(ctx.app)
      .patch('/api/saas/master/schools/SCH001')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({ extendDays: 30 });
    expect(extendRes.status).toBe(200);

    const restoredRead = await request(ctx.app)
      .get('/api/saas/tenant/slices')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(restoredRead.status).toBe(200);
    expect(restoredRead.body.slices.students.school_erp_students[0].nameEn).toBe('Preserved Student');
  });

  it('7. Suspended schools cannot access protected resources', async () => {
    await createTestSchool();
    const tokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    await request(ctx.app)
      .patch('/api/saas/master/schools/SCH001')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({ status: 'suspended' })
      .expect(200);

    const me = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(me.body.accessAllowed).toBe(false);
    expect(me.body.blockReason).toBe('SCHOOL_SUSPENDED');

    const slices = await request(ctx.app)
      .get('/api/saas/tenant/slices')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(slices.status).toBe(403);
    expect(slices.body.code).toBe('SCHOOL_SUSPENDED');
  });

  it('8 & 9. Payment submission creates pending request without activating subscription & rejects duplicate TrxIDs', async () => {
    await createTestSchool({ activateImmediately: false });
    const tokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Pending school is initially blocked
    const meBefore = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(meBefore.body.accessAllowed).toBe(false);
    expect(meBefore.body.blockReason).toBe('SUBSCRIPTION_PENDING');

    // Submit manual bKash payment
    const payRes = await request(ctx.app)
      .post('/api/saas/payment-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        planId: 'quarterly',
        amount: 4200,
        paymentMethod: 'bKash',
        senderNumber: '01711223344',
        transactionId: 'BKASH-998877',
        paymentDate: '2026-05-01',
      });
    expect(payRes.status).toBe(201);
    expect(payRes.body.paymentRequest.status).toBe('pending');

    // Submission MUST NOT auto-activate subscription
    const meAfterSubmit = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(meAfterSubmit.body.accessAllowed).toBe(false);

    // Duplicate TrxID (even with lowercase/spaces) MUST be rejected
    const dupPay = await request(ctx.app)
      .post('/api/saas/payment-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        planId: 'quarterly',
        amount: 4200,
        paymentMethod: 'bKash',
        senderNumber: '01711223344',
        transactionId: '  bkash-998877 ',
        paymentDate: '2026-05-01',
      });
    expect(dupPay.status).toBe(409);
    expect(dupPay.body.code).toBe('DUPLICATE_TRANSACTION_ID');
  });

  it('10 & 11. Approved payment activates subscription and renewal before expiration adds duration to existing expiry date', async () => {
    // Starts 2026-05-01, monthly (30d) => expires 2026-05-31T10:00:00.000Z
    await createTestSchool({ initialPlan: 'monthly', activateImmediately: true });
    const tokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Advance 10 days -> now is 2026-05-11 (20 days remaining before expiry)
    ctx.advanceDays(10);

    // Submit Quarterly (90 days) renewal before expiration
    const submitRes = await request(ctx.app)
      .post('/api/saas/payment-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        planId: 'quarterly',
        amount: 4200,
        paymentMethod: 'Nagad',
        senderNumber: '01911223344',
        transactionId: 'NAGAD-RENEW-01',
        paymentDate: '2026-05-11',
      });
    expect(submitRes.status).toBe(201);

    // School admin CANNOT approve their own payment
    const unauthorizedApprove = await request(ctx.app)
      .post(`/api/saas/master/payment-requests/${submitRes.body.paymentRequest.id}/approve`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({});
    expect(unauthorizedApprove.status).toBe(403);

    // Master Admin approves -> 90 days added to existing expiry (2026-05-31 + 90d = 2026-08-29)
    const approveRes = await request(ctx.app)
      .post(`/api/saas/master/payment-requests/${submitRes.body.paymentRequest.id}/approve`)
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.paymentRequest.status).toBe('approved');
    expect(approveRes.body.school.subscription.expiryDate).toBe('2026-08-29T10:00:00.000Z');
  });

  it('12. Renewal after expiration starts new duration from approval time', async () => {
    // Starts 2026-05-01, monthly => expires 2026-05-31T10:00:00.000Z
    await createTestSchool({ initialPlan: 'monthly', activateImmediately: true });
    const tokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Advance 45 days -> now is 2026-06-15T10:00:00.000Z (15 days AFTER expiry)
    ctx.advanceDays(45);

    const submitRes = await request(ctx.app)
      .post('/api/saas/payment-requests')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        planId: 'yearly',
        amount: 15000,
        paymentMethod: 'Bank Transfer',
        senderNumber: 'DBBL-9988',
        transactionId: 'BANK-EXPIRED-02',
        paymentDate: '2026-06-15',
      });
    expect(submitRes.status).toBe(201);

    const approveRes = await request(ctx.app)
      .post(`/api/saas/master/payment-requests/${submitRes.body.paymentRequest.id}/approve`)
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({});
    expect(approveRes.status).toBe(200);
    // 2026-06-15 + 365 days = 2027-06-15T10:00:00.000Z
    expect(approveRes.body.school.subscription.expiryDate).toBe('2027-06-15T10:00:00.000Z');
    expect(approveRes.body.school.computedSubscription.accessAllowed).toBe(true);
  });

  it('13 & 14. Staff provisioning assigns claims cleanly (no plaintext password) and enforces role RBAC', async () => {
    await createTestSchool();
    const adminTokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Super Admin creates a teacher account
    const staffRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        email: 'teacher1@dmhs.edu.bd',
        password: 'Teacher@Password1',
        displayName: 'Selina Parvin',
        schoolRole: 'teacher',
        linkedStaffId: 'st_001',
      });
    expect(staffRes.status).toBe(201);
    expect(staffRes.body.user.schoolId).toBe('SCH001');
    expect(staffRes.body.user.schoolRole).toBe('teacher');
    expect((staffRes.body.user as any).password).toBeUndefined();

    // School Admin CANNOT escalate privilege to master_admin
    const escalateRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        email: 'rogue@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Rogue',
        schoolRole: 'master_admin',
      });
    expect(escalateRes.status).toBe(403);

    // Teacher CANNOT access Master Admin routes or create other staff accounts
    const teacherToken = ctx.auth.issueTestTokenForEmail('teacher1@dmhs.edu.bd');
    const teacherCreateStaff = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        email: 'another@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Another',
        schoolRole: 'teacher',
      });
    expect(teacherCreateStaff.status).toBe(403);

    const teacherListSchools = await request(ctx.app)
      .get('/api/saas/master/schools')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(teacherListSchools.status).toBe(403);
  });

  it('17. Master Admin retains full platform management access even when all schools are expired or suspended', async () => {
    await createTestSchool({ initialPlan: 'monthly' });
    ctx.advanceDays(60); // school expired
    await request(ctx.app)
      .patch('/api/saas/master/schools/SCH001')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({ status: 'suspended' })
      .expect(200);

    const masterMe = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${ctx.masterToken}`);
    expect(masterMe.status).toBe(200);
    expect(masterMe.body.accessAllowed).toBe(true);
    expect(masterMe.body.principal.isMasterAdmin).toBe(true);

    const listRes = await request(ctx.app)
      .get('/api/saas/master/schools')
      .set('Authorization', `Bearer ${ctx.masterToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.schools).toHaveLength(1);
    expect(listRes.body.analytics.suspendedSchools).toBe(1);
  });

  it('18. Self-service credentials update works for Master Admin, School Admin, Teacher, Staff, and Student while protecting master email', async () => {
    await createTestSchool();
    const adminTokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Provision Teacher, Staff (Accountant), and Student
    const teacherRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        email: 'teacher1@dmhs.edu.bd',
        password: 'Password@1',
        displayName: 'Teacher One',
        schoolRole: 'teacher',
        linkedStaffId: 'st_t1',
      });
    expect(teacherRes.status).toBe(201);

    const staffRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        email: 'acc1@dmhs.edu.bd',
        password: 'Password@1',
        displayName: 'Accountant One',
        schoolRole: 'accountant',
        linkedStaffId: 'st_a1',
      });
    expect(staffRes.status).toBe(201);

    const studentRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        email: 'stu1@dmhs.edu.bd',
        password: 'Password@1',
        displayName: 'Student One',
        schoolRole: 'student',
        linkedStudentId: 'stu_s1',
      });
    expect(studentRes.status).toBe(201);

    // Master Admin can update displayName and password, but cannot change immutable platform email
    const masterEmailAttempt = await request(ctx.app)
      .patch('/api/saas/me/credentials')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({ email: 'other@smartschoolbd.com' });
    expect(masterEmailAttempt.status).toBe(400);
    expect(masterEmailAttempt.body.code).toBe('MASTER_EMAIL_IMMUTABLE');

    const masterUpdate = await request(ctx.app)
      .patch('/api/saas/me/credentials')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({ displayName: 'Platform Owner', password: 'MasterNew@Password9' });
    expect(masterUpdate.status).toBe(200);
    expect(masterUpdate.body.user.displayName).toBe('Platform Owner');

    // Teacher, Staff, and Student can each update their own email & password
    const rolesToTest = [
      { oldEmail: 'teacher1@dmhs.edu.bd', newEmail: 'teacher1.updated@dmhs.edu.bd', name: 'Teacher Updated' },
      { oldEmail: 'acc1@dmhs.edu.bd', newEmail: 'acc1.updated@dmhs.edu.bd', name: 'Accountant Updated' },
      { oldEmail: 'stu1@dmhs.edu.bd', newEmail: 'stu1.updated@dmhs.edu.bd', name: 'Student Updated' },
    ];

    for (const item of rolesToTest) {
      const tok = ctx.auth.issueTestTokenForEmail(item.oldEmail);
      const res = await request(ctx.app)
        .patch('/api/saas/me/credentials')
        .set('Authorization', `Bearer ${tok}`)
        .send({
          displayName: item.name,
          email: item.newEmail,
          phone: '01700112233',
          password: 'NewSecure@Password7',
        });
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(item.newEmail);
      expect(res.body.user.displayName).toBe(item.name);
      expect(res.body.user.phone).toBe('01700112233');
    }

    // Weak password rejected
    const schoolAdminUpdateWeak = await request(ctx.app)
      .patch('/api/saas/me/credentials')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ password: '123' });
    expect(schoolAdminUpdateWeak.status).toBe(400);
    expect(schoolAdminUpdateWeak.body.code).toBe('WEAK_PASSWORD');

    // Duplicate email rejected
    const dupAttempt = await request(ctx.app)
      .patch('/api/saas/me/credentials')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ email: 'teacher1.updated@dmhs.edu.bd' });
    expect(dupAttempt.status).toBe(409);
    expect(dupAttempt.body.code).toBe('DUPLICATE_EMAIL');
  });

  it('19. School Admin & Master Admin can update tenant user credentials with strict tenant isolation & RBAC', async () => {
    await createTestSchool(); // SCH001
    await createTestSchool({
      schoolName: 'Second Model School',
      schoolCode: 'SMS02',
      adminEmail: 'admin@sms02.edu.bd',
    }); // SCH002

    const adminTokenA = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');
    const adminTokenB = ctx.auth.issueTestTokenForEmail('admin@sms02.edu.bd');

    const teacherA = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        email: 't_a@dmhs.edu.bd',
        password: 'Password@1',
        displayName: 'Teacher A',
        schoolRole: 'teacher',
      });
    expect(teacherA.status).toBe(201);
    const teacherAUid = teacherA.body.user.uid;

    const studentB = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${adminTokenB}`)
      .send({
        email: 's_b@sms02.edu.bd',
        password: 'Password@1',
        displayName: 'Student B',
        schoolRole: 'student',
      });
    expect(studentB.status).toBe(201);
    const studentBUid = studentB.body.user.uid;

    // School Admin A can update Teacher A in SCH001
    const okUpdate = await request(ctx.app)
      .patch(`/api/saas/users/${teacherAUid}/credentials`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        displayName: 'Teacher A Promoted',
        schoolRole: 'accountant',
        password: 'ResetPass@2026',
      });
    expect(okUpdate.status).toBe(200);
    expect(okUpdate.body.user.schoolRole).toBe('accountant');
    expect(ctx.auth.getUserClaims(teacherAUid)?.schoolRole).toBe('accountant');

    // Non-admin (promoted accountant / teacher) CANNOT update other users
    const nonAdminToken = ctx.auth.issueTestTokenForEmail('t_a@dmhs.edu.bd');
    const forbiddenNonAdmin = await request(ctx.app)
      .patch(`/api/saas/users/${teacherAUid}/credentials`)
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .send({ displayName: 'Self Escalate' });
    expect(forbiddenNonAdmin.status).toBe(403);

    // School Admin A CANNOT update Student B in SCH002 -> 403 CROSS_TENANT_FORBIDDEN
    const crossTenantRes = await request(ctx.app)
      .patch(`/api/saas/users/${studentBUid}/credentials`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ password: 'HackPass@123' });
    expect(crossTenantRes.status).toBe(403);
    expect(crossTenantRes.body.code).toBe('CROSS_TENANT_FORBIDDEN');

    // Master Admin CAN update Student B across any school
    const masterCrossRes = await request(ctx.app)
      .patch(`/api/saas/users/${studentBUid}/credentials`)
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({
        displayName: 'Student B Verified',
        email: 'student.b.verified@sms02.edu.bd',
        password: 'MasterReset@123',
      });
    expect(masterCrossRes.status).toBe(200);
    expect(masterCrossRes.body.user.email).toBe('student.b.verified@sms02.edu.bd');
  });

  it('20. Master Admin can configure live bKash/Nagad/Rocket/Bank channels and non-master admins are blocked', async () => {
    await createTestSchool(); // SCH001
    const schoolAdminToken = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // School Admin CANNOT read or modify Master Admin payment channel settings
    const forbiddenGet = await request(ctx.app)
      .get('/api/saas/master/payment-channels')
      .set('Authorization', `Bearer ${schoolAdminToken}`);
    expect(forbiddenGet.status).toBe(403);

    const forbiddenPut = await request(ctx.app)
      .put('/api/saas/master/payment-channels')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({ bkash: '01799999999' });
    expect(forbiddenPut.status).toBe(403);

    // Master Admin saves custom bKash, Nagad, Rocket, Bank & support contact
    const putRes = await request(ctx.app)
      .put('/api/saas/master/payment-channels')
      .set('Authorization', `Bearer ${ctx.masterToken}`)
      .send({
        bkash: '01755-889900 (Personal - Send Money)',
        nagad: '01955-889900 (Merchant)',
        rocket: '01855-889900-2',
        bank: 'Islami Bank • A/C: 2050-001122',
        paymentInstruction: 'Mention your School ID in Reference.',
        supportPhone: '+880 1800-112233',
        supportEmail: 'billing@smartschoolbd.com',
      });
    expect(putRes.status).toBe(200);
    expect(putRes.body.channels.bkash).toBe('01755-889900 (Personal - Send Money)');
    expect(putRes.body.channels.nagad).toBe('01955-889900 (Merchant)');
    expect(putRes.body.channels.rocket).toBe('01855-889900-2');
    expect(putRes.body.channels.updatedBy).toBe('owner@smartschoolbd.com');

    // Verify GET /api/saas/plans & GET /api/saas/me immediately return the saved channels
    const plansRes = await request(ctx.app).get('/api/saas/plans');
    expect(plansRes.status).toBe(200);
    expect(plansRes.body.platformPaymentChannels.bkash).toBe('01755-889900 (Personal - Send Money)');
    expect(plansRes.body.platformPaymentChannels.nagad).toBe('01955-889900 (Merchant)');
    expect(plansRes.body.platformPaymentChannels.rocket).toBe('01855-889900-2');
    expect(plansRes.body.platformPaymentChannels.paymentInstruction).toBe(
      'Mention your School ID in Reference.'
    );

    const meRes = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${schoolAdminToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.platformSupportContact).toEqual({
      phone: '+880 1800-112233',
      email: 'billing@smartschoolbd.com',
    });

    // Verify school can submit a Rocket payment request using newly enabled method
    const rocketPay = await request(ctx.app)
      .post('/api/saas/payment-requests')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({
        planId: 'monthly',
        amount: 1500,
        paymentMethod: 'Rocket',
        senderNumber: '01811223344',
        transactionId: 'ROCKET-TRX-7788',
        paymentDate: '2026-05-02',
      });
    expect(rocketPay.status).toBe(201);
    expect(rocketPay.body.paymentRequest.paymentMethod).toBe('Rocket');
  });

  it('21. Student provisioning omits undefined optional fields and recovers same-school orphaned Auth accounts', async () => {
    await createTestSchool(); // SCH001
    const schoolAdminToken = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Provision student without linkedStaffId or phone
    const res1 = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({
        email: 'student.clean@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Mahid Yafee',
        schoolRole: 'student',
        linkedStudentId: 'stu_1002',
      });
    expect(res1.status).toBe(201);
    expect('linkedStaffId' in res1.body.user).toBe(false);
    expect('phone' in res1.body.user).toBe(false);
    expect(res1.body.user.linkedStudentId).toBe('stu_1002');

    // Simulate orphaned Firebase Auth user (created in Auth with SCH001 claim, missing in saas_users)
    const orphanAuth = await ctx.auth.createUser({
      email: 'orphan.student@dmhs.edu.bd',
      password: 'OldPassword@1',
      displayName: 'Orphan Student',
    });
    await ctx.auth.setCustomClaims(orphanAuth.uid, {
      schoolId: 'SCH001',
      schoolRole: 'student',
      isMasterAdmin: false,
    });

    const recoverRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({
        email: 'orphan.student@dmhs.edu.bd',
        password: 'RecoveredPassword@123',
        displayName: 'Recovered Student',
        schoolRole: 'student',
        linkedStudentId: 'stu_1003',
      });
    expect(recoverRes.status).toBe(201);
    expect(recoverRes.body.user.uid).toBe(orphanAuth.uid);
    expect(recoverRes.body.user.displayName).toBe('Recovered Student');
  });

  it('22. Guardian can submit online school fee payments via bKash, Nagad, and Rocket with duplicate TrxID protection & tenant isolation', async () => {
    await createTestSchool(); // SCH001
    await createTestSchool({
      schoolName: 'Sylhet Public School',
      schoolCode: 'SPS02',
      adminEmail: 'admin@sps.edu.bd',
    }); // SCH002

    const schoolAdminToken = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Provision a guardian account in SCH001
    const guardRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({
        email: 'guardian1@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Guardian One',
        schoolRole: 'guardian',
        linkedStudentId: 'stu_1001',
      });
    expect(guardRes.status).toBe(201);
    const guardianToken = ctx.auth.issueTestTokenForEmail('guardian1@dmhs.edu.bd');

    // Submit via bKash, Nagad, and Rocket
    for (const [method, trx] of [
      ['bKash', 'BK112233'],
      ['Nagad', 'NG445566'],
      ['Rocket', 'RK778899'],
    ] as const) {
      const submitRes = await request(ctx.app)
        .post('/api/saas/tenant/online-payments')
        .set('Authorization', `Bearer ${guardianToken}`)
        .send({
          studentId: 'stu_1001',
          studentName: 'Ariful Islam',
          studentRoll: '01',
          className: 'Class 10',
          section: 'A',
          feeTitle: `Monthly Tuition (${method})`,
          amount: 1200,
          paymentMethod: method,
          senderPhone: '01711000222',
          transactionId: trx.toLowerCase(),
        });
      expect(submitRes.status).toBe(201);
      expect(submitRes.body.request.paymentMethod).toBe(method);
      expect(submitRes.body.request.transactionId).toBe(trx);
      expect(submitRes.body.request.status).toBe('pending');
    }

    // Reject duplicate TrxID
    const dupRes = await request(ctx.app)
      .post('/api/saas/tenant/online-payments')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        studentId: 'stu_1001',
        studentName: 'Ariful Islam',
        feeTitle: 'Duplicate Attempt',
        amount: 1200,
        paymentMethod: 'Rocket',
        senderPhone: '01711000222',
        transactionId: '  rk778899 ',
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.code).toBe('DUPLICATE_TRANSACTION_ID');

    // Reject invalid payment method (e.g. Cash)
    const invalidMethodRes = await request(ctx.app)
      .post('/api/saas/tenant/online-payments')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        studentId: 'stu_1001',
        studentName: 'Ariful Islam',
        feeTitle: 'Cash Attempt',
        amount: 500,
        paymentMethod: 'Cash',
        senderPhone: '01711000222',
        transactionId: 'CASH123',
      });
    expect(invalidMethodRes.status).toBe(400);
    expect(invalidMethodRes.body.code).toBe('INVALID_PAYMENT_METHOD');

    // Reject cross-tenant write to SCH002
    const crossWriteRes = await request(ctx.app)
      .post('/api/saas/tenant/online-payments')
      .set('Authorization', `Bearer ${guardianToken}`)
      .send({
        schoolId: 'SCH002',
        studentId: 'stu_1001',
        studentName: 'Ariful Islam',
        feeTitle: 'Cross Tenant',
        amount: 500,
        paymentMethod: 'bKash',
        senderPhone: '01711000222',
        transactionId: 'BK999000',
      });
    expect(crossWriteRes.status).toBe(403);
    expect(crossWriteRes.body.code).toBe('CROSS_TENANT_FORBIDDEN');

    // Admin in SCH001 reads all 3 pending online payments via GET /tenant/online-payments
    const adminReadRes = await request(ctx.app)
      .get('/api/saas/tenant/online-payments')
      .set('Authorization', `Bearer ${schoolAdminToken}`);
    expect(adminReadRes.status).toBe(200);
    expect(adminReadRes.body.requests).toHaveLength(3);
    expect(adminReadRes.body.requests.map((r: any) => r.paymentMethod)).toEqual([
      'Rocket',
      'Nagad',
      'bKash',
    ]);
  });

  it('21. Verified student can submit & update AI-evaluated homework via POST /tenant/homework-submissions with strict tenant isolation', async () => {
    await createTestSchool(); // SCH001
    await createTestSchool({
      schoolName: 'Rajshahi High School',
      schoolCode: 'RHS02',
      adminEmail: 'admin@rhs.edu.bd',
    }); // SCH002

    const schoolAdminToken = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');

    // Provision a student account in SCH001
    const stuRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${schoolAdminToken}`)
      .send({
        email: 'hiya@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Hiya Akhter',
        schoolRole: 'student',
        linkedStudentId: 'std_hiya_1',
      });
    expect(stuRes.status).toBe(201);
    const studentToken = ctx.auth.issueTestTokenForEmail('hiya@dmhs.edu.bd');

    // Initial submission by student
    const submitRes = await request(ctx.app)
      .post('/api/saas/tenant/homework-submissions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        homeworkId: 'hw_math_1',
        studentId: 'std_hiya_1',
        studentCode: 'SCH001-S-2026-1002',
        studentName: 'Hiya Akhter',
        studentRoll: '02',
        className: 'Class 10',
        section: 'A',
        textAnswer: '1, 2, 3, 4, 5, 6, 77, 88, 99, 10',
        status: 'submitted',
      });
    expect(submitRes.status).toBe(201);
    expect(submitRes.body.submission.status).toBe('submitted');
    expect(submitRes.body.submission.teacherMarks).toBeUndefined();

    // Update same submission with accurate AI evaluation (7/10)
    const evalRes = await request(ctx.app)
      .post('/api/saas/tenant/homework-submissions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        id: submitRes.body.submission.id,
        homeworkId: 'hw_math_1',
        studentId: 'std_hiya_1',
        studentCode: 'SCH001-S-2026-1002',
        studentName: 'Hiya Akhter',
        studentRoll: '02',
        className: 'Class 10',
        section: 'A',
        textAnswer: '1, 2, 3, 4, 5, 6, 77, 88, 99, 10',
        status: 'approved',
        teacherMarks: 7,
        aiEvaluation: {
          status: 'evaluated',
          suggestedMarks: 7,
          fullMarks: 10,
          confidence: 0.96,
          correctAnswers: 7,
          partialAnswers: 0,
          incorrectAnswers: 3,
          feedback: '৭, ৮, ৯-এর পরিবর্তে ৭৭, ৮৮, ৯৯ লেখা হয়েছে।',
          requiresTeacherReview: false,
          evaluatedAt: '2026-05-01T10:05:00.000Z',
        },
      });
    expect(evalRes.status).toBe(201);
    expect(evalRes.body.submissions).toHaveLength(1);
    expect(evalRes.body.submission.teacherMarks).toBe(7);

    // Reject cross-tenant submission into SCH002
    const crossRes = await request(ctx.app)
      .post('/api/saas/tenant/homework-submissions')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({
        schoolId: 'SCH002',
        homeworkId: 'hw_math_1',
        studentId: 'std_hiya_1',
        studentName: 'Hiya Akhter',
        className: 'Class 10',
        textAnswer: 'Cross tenant attack',
      });
    expect(crossRes.status).toBe(403);
    expect(crossRes.body.code).toBe('CROSS_TENANT_FORBIDDEN');

    // Admin in SCH001 reads homework submissions and sees Hiya's 7/10 score
    const adminRead = await request(ctx.app)
      .get('/api/saas/tenant/homework-submissions')
      .set('Authorization', `Bearer ${schoolAdminToken}`);
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.submissions).toHaveLength(1);
    expect(adminRead.body.submissions[0].teacherMarks).toBe(7);
  });

  it('23. Super Admin & Master Admin can permanently delete user logins so deleted users cannot log in or use existing tokens, with RBAC & tenant guards', async () => {
    await createTestSchool(); // SCH001
    await createTestSchool({
      schoolName: 'Sylhet Public School',
      schoolCode: 'SPS02',
      adminEmail: 'admin@sps.edu.bd',
    }); // SCH002

    const superAdminToken = ctx.auth.issueTestTokenForEmail('admin@dmhs.edu.bd');
    const schoolBAdminToken = ctx.auth.issueTestTokenForEmail('admin@sps.edu.bd');

    // Provision admin, teacher, student, and guardian in SCH001
    const regularAdminRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'head@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Head Teacher Admin',
        schoolRole: 'admin',
      });
    expect(regularAdminRes.status).toBe(201);
    const regularAdminToken = ctx.auth.issueTestTokenForEmail('head@dmhs.edu.bd');

    const teacherRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'jahid@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Jahid Teacher',
        schoolRole: 'teacher',
        linkedStaffId: 'st_jahid',
      });
    expect(teacherRes.status).toBe(201);
    const teacherUid = teacherRes.body.user.uid;
    const teacherToken = ctx.auth.issueTestTokenForEmail('jahid@dmhs.edu.bd');

    const studentRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'hiya@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Hiya Akhter',
        schoolRole: 'student',
        linkedStudentId: 'stu_hiya',
      });
    expect(studentRes.status).toBe(201);
    const studentUid = studentRes.body.user.uid;
    const studentToken = ctx.auth.issueTestTokenForEmail('hiya@dmhs.edu.bd');

    const guardianRes = await request(ctx.app)
      .post('/api/saas/users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        email: 'habib@dmhs.edu.bd',
        password: 'Password@123',
        displayName: 'Habib Guardian',
        schoolRole: 'guardian',
        linkedStudentId: 'stu_hiya',
      });
    expect(guardianRes.status).toBe(201);
    const guardianUid = guardianRes.body.user.uid;

    // Non-admin (teacher) CANNOT delete any user
    const teacherDeleteAttempt = await request(ctx.app)
      .delete(`/api/saas/users/${studentUid}`)
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(teacherDeleteAttempt.status).toBe(403);

    // Self-deletion MUST fail
    const superAdminRecord = await ctx.db.getSaaSUserByEmail('admin@dmhs.edu.bd');
    const selfDeleteAttempt = await request(ctx.app)
      .delete(`/api/saas/users/${superAdminRecord!.uid}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(selfDeleteAttempt.status).toBe(400);
    expect(selfDeleteAttempt.body.code).toBe('CANNOT_DELETE_SELF');

    // Regular 'admin' CANNOT delete 'super_admin'
    const adminDeletesSuperAttempt = await request(ctx.app)
      .delete(`/api/saas/users/${superAdminRecord!.uid}`)
      .set('Authorization', `Bearer ${regularAdminToken}`);
    expect(adminDeletesSuperAttempt.status).toBe(403);

    // Cross-tenant School B admin CANNOT delete SCH001 users
    const crossTenantDelete = await request(ctx.app)
      .delete(`/api/saas/users/${teacherUid}`)
      .set('Authorization', `Bearer ${schoolBAdminToken}`);
    expect(crossTenantDelete.status).toBe(403);
    expect(crossTenantDelete.body.code).toBe('CROSS_TENANT_FORBIDDEN');

    // Super Admin deletes student, teacher, and guardian accounts
    const delStudent = await request(ctx.app)
      .delete(`/api/saas/users/${studentUid}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(delStudent.status).toBe(200);
    expect(delStudent.body.deletedUid).toBe(studentUid);

    const delTeacher = await request(ctx.app)
      .delete(`/api/saas/users/${teacherUid}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(delTeacher.status).toBe(200);

    const delGuardian = await request(ctx.app)
      .delete(`/api/saas/users/${guardianUid}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(delGuardian.status).toBe(200);

    // Deleted users' existing tokens immediately fail & Auth/DB records are completely removed
    const deletedStudentMe = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(deletedStudentMe.status).toBe(401);

    const deletedTeacherMe = await request(ctx.app)
      .get('/api/saas/me')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(deletedTeacherMe.status).toBe(401);

    expect(await ctx.auth.getUserByEmail('hiya@dmhs.edu.bd')).toBeNull();
    expect(await ctx.auth.getUserByEmail('jahid@dmhs.edu.bd')).toBeNull();
    expect(await ctx.db.getSaaSUserByUid(studentUid)).toBeNull();
    expect(await ctx.db.getSaaSUserByUid(guardianUid)).toBeNull();

    // User list no longer contains the deleted accounts
    const listAfter = await request(ctx.app)
      .get('/api/saas/users')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(listAfter.status).toBe(200);
    const remainingEmails = listAfter.body.users.map((u: any) => u.email);
    expect(remainingEmails).not.toContain('hiya@dmhs.edu.bd');
    expect(remainingEmails).not.toContain('jahid@dmhs.edu.bd');
    expect(remainingEmails).not.toContain('habib@dmhs.edu.bd');

    // Master Admin cannot be deleted
    const masterSelfDelete = await request(ctx.app)
      .delete('/api/saas/users/master_uid_1')
      .set('Authorization', `Bearer ${ctx.masterToken}`);
    expect(masterSelfDelete.status).toBe(400);
  });
});
