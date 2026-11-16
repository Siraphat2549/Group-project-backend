import type { OpenAPIObject } from '@nestjs/swagger';
import { createTestApp, http, TestApp } from '../utils/test-app';

describe('Swagger / OpenAPI (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('E2E-DOC-01 GET /docs serves Swagger UI', async () => {
    const res = await http(app).get('/docs').redirects(1).expect(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('E2E-DOC-02 GET /docs-json serves OpenAPI 3 with JWT bearer auth', async () => {
    const res = await http(app).get('/docs-json').expect(200);
    const doc = res.body as OpenAPIObject;

    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('Hotel Booking API');
    expect(doc.components?.securitySchemes?.['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/health', '/health/live']),
    );
  });
});
