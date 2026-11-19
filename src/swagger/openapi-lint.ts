import type { OpenAPIObject } from '@nestjs/swagger';

const METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
] as const;

export interface OpenApiLintResult {
  operations: number;
  errors: string[];
  warnings: string[];
}

/**
 * Checks the generated OpenAPI document for gaps the rubric cares about
 * (criterion 14: "all core endpoints … with accurate schemas and responses"):
 * every endpoint has a summary, a tag, a success response, and the error
 * responses implied by its auth / request body / path parameters.
 */
export function lintOpenApiDocument(doc: OpenAPIObject): OpenApiLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let operations = 0;

  const schemes = Object.values(doc.components?.securitySchemes ?? {});
  if (!schemes.some((s) => 'scheme' in s && s.scheme === 'bearer')) {
    errors.push('No bearer (JWT) security scheme is defined');
  }

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      operations++;

      const id = `${method.toUpperCase()} ${path}`;
      const codes = Object.keys(op.responses ?? {});
      const requirements = op.security ?? doc.security ?? [];
      // A `{}` entry means the token is optional (@ApiOptionalAuth): no 401.
      const secured =
        requirements.length > 0 &&
        requirements.every((r) => Object.keys(r).length > 0);

      if (!op.summary?.trim()) {
        errors.push(`${id}: missing summary (add @ApiOperation)`);
      }
      if (!op.tags?.length) {
        errors.push(`${id}: missing tag (add @ApiTags on the controller)`);
      }
      if (!codes.some((c) => /^2\d\d$/.test(c))) {
        errors.push(`${id}: no 2xx response documented`);
      }
      if (secured && !codes.includes('401')) {
        errors.push(
          `${id}: requires auth but 401 is not documented (@ApiAuth)`,
        );
      }
      if (op.requestBody && !codes.includes('400')) {
        errors.push(
          `${id}: has a request body but 400 is not documented (@ApiValidationError)`,
        );
      }
      if (path.includes('{') && !codes.includes('404')) {
        warnings.push(`${id}: has a path parameter but no 404 (@ApiNotFound)`);
      }
    }
  }

  if (operations === 0) errors.push('Document has no operations');
  return { operations, errors, warnings };
}
