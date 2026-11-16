import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApiApp } from '../../apiApp';
import { handler } from '../../../netlify/functions/api';

describe('Netlify Functions & Shared API App', () => {
  it('serves /api/saas/health via createApiApp', async () => {
    const app = createApiApp();
    const res = await request(app).get('/api/saas/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dbProvider).toBeDefined();
    expect(typeof res.body.adminSdkReady).toBe('boolean');
  });

  it('rewrites /.netlify/functions/api/saas/health to /api/saas/health', async () => {
    const app = createApiApp();
    const res = await request(app).get('/.netlify/functions/api/saas/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dbProvider).toBeDefined();
  });

  it('invokes Netlify Function handler directly for /api/saas/health', async () => {
    const result = (await handler(
      {
        httpMethod: 'GET',
        path: '/.netlify/functions/api/saas/health',
        rawUrl: 'https://shafiq900.netlify.app/.netlify/functions/api/saas/health',
        headers: { host: 'shafiq900.netlify.app' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
      } as any,
      {} as any
    )) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(body.dbProvider).toBeDefined();
  });

  it('serves /api/ai/status cleanly via Netlify Function handler', async () => {
    const result = (await handler(
      {
        httpMethod: 'GET',
        path: '/.netlify/functions/api/ai/status',
        rawUrl: 'https://shafiq900.netlify.app/.netlify/functions/api/ai/status',
        headers: { host: 'shafiq900.netlify.app' },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        body: null,
        isBase64Encoded: false,
      } as any,
      {} as any
    )) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('ok');
  });
});
