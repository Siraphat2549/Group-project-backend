import type { OpenAPIObject } from '@nestjs/swagger';
import { lintOpenApiDocument } from './openapi-lint';

function doc(paths: OpenAPIObject['paths']): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths,
    components: {
      securitySchemes: {
        'access-token': { type: 'http', scheme: 'bearer' },
      },
    },
  };
}

const ok = { '200': { description: 'ok' } };

describe('lintOpenApiDocument', () => {
  it('UT-DOC-01 passes a fully documented endpoint', () => {
    const result = lintOpenApiDocument(
      doc({
        '/bookings/{id}': {
          get: {
            summary: 'Get booking',
            tags: ['Bookings'],
            security: [{ 'access-token': [] }],
            responses: {
              ...ok,
              '401': { description: 'x' },
              '404': { description: 'x' },
            },
          },
        },
      }),
    );
    expect(result).toEqual({ operations: 1, errors: [], warnings: [] });
  });

  it('UT-DOC-02 reports missing summary, tag and success response', () => {
    const { errors } = lintOpenApiDocument(
      doc({ '/rooms': { get: { responses: {} } } }),
    );
    expect(errors).toEqual([
      expect.stringMatching(/GET \/rooms: missing summary/),
      expect.stringMatching(/GET \/rooms: missing tag/),
      expect.stringMatching(/GET \/rooms: no 2xx/),
    ]);
  });

  it('UT-DOC-03 requires 401 on secured endpoints and 400 on endpoints with a body', () => {
    const { errors } = lintOpenApiDocument(
      doc({
        '/bookings': {
          post: {
            summary: 'Create',
            tags: ['Bookings'],
            security: [{ 'access-token': [] }],
            requestBody: { content: {} },
            responses: { '201': { description: 'created' } },
          },
        },
      }),
    );
    expect(errors).toEqual([
      expect.stringMatching(/401 is not documented/),
      expect.stringMatching(/400 is not documented/),
    ]);
  });

  it('UT-DOC-04 warns (not errors) when a path-param endpoint lacks 404', () => {
    const result = lintOpenApiDocument(
      doc({
        '/rooms/{id}': {
          get: { summary: 'Get', tags: ['Rooms'], responses: ok },
        },
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([expect.stringMatching(/no 404/)]);
  });

  it('UT-DOC-05 errors when there is no bearer scheme or no operation', () => {
    const { errors } = lintOpenApiDocument({ ...doc({}), components: {} });
    expect(errors).toEqual([
      'No bearer (JWT) security scheme is defined',
      'Document has no operations',
    ]);
  });
});
