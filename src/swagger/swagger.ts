import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerCustomOptions,
  SwaggerModule,
} from '@nestjs/swagger';

/** Swagger UI is served at `/docs`, the raw OpenAPI JSON at `/docs-json`. */
export const SWAGGER_PATH = 'docs';
export const SWAGGER_JSON_PATH = 'docs-json';

/** Security scheme name. Apply with `@ApiAuth()` / `@ApiAdminOnly()`. */
export const BEARER_AUTH = 'access-token';

/** Use with `@ApiTags(ApiTag.Rooms)` so tag names never drift. */
export enum ApiTag {
  Auth = 'Auth',
  Users = 'Users',
  Rooms = 'Rooms',
  Bookings = 'Bookings',
  Search = 'Search',
  Notifications = 'Notifications',
  Health = 'Health',
}

const TAG_DESCRIPTIONS: Record<ApiTag, string> = {
  [ApiTag.Auth]: 'Sign up, log in, log out (FR-1, FR-2)',
  [ApiTag.Users]: 'View and update your own profile (FR-3, FR-4)',
  [ApiTag.Rooms]:
    'List / view rooms with images; create, edit, deactivate and image upload are Admin-only (FR-8–16)',
  [ApiTag.Bookings]:
    'Create and view your own bookings; Admin sees all and changes status (FR-17–26)',
  [ApiTag.Search]:
    'Rooms actually available for a date range and capacity (FR-27–29)',
  [ApiTag.Notifications]:
    'Booking created / cancelled events for the frontend (FR-30, FR-31)',
  [ApiTag.Health]: 'Health check for monitoring and deployment (FR-36)',
};

const DESCRIPTION = `
REST API for the ITCS258 Hotel Booking system (Group 13).

### How to authenticate
1. Create an account with \`POST /auth/register\`, or use a test account from the README.
2. Call \`POST /auth/login\` and copy the JWT access token from the response.
3. Click **Authorize** (top right), paste the token **without** the \`Bearer\` prefix, then **Authorize**.
4. Endpoints with a lock icon now send \`Authorization: Bearer <token>\`. The token survives page reloads.

### Roles
- **Guest** (no token): list/view/search rooms, health check.
- **Regular User**: everything a guest can do + own profile and own bookings.
- **Admin**: manage rooms and all bookings.

### Status codes
\`400\` invalid or incomplete data · \`401\` missing/invalid/expired token ·
\`403\` logged in but not allowed (not Admin / not your booking) · \`404\` not found ·
\`409\` conflict (e.g. room already booked) · \`429\` rate limit exceeded.
Errors use the \`ErrorResponseDto\` schema.
`.trim();

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Hotel Booking API')
    .setDescription(DESCRIPTION)
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token from POST /auth/login',
      },
      BEARER_AUTH,
    );

  for (const tag of Object.values(ApiTag)) {
    builder.addTag(tag, TAG_DESCRIPTIONS[tag]);
  }

  return SwaggerModule.createDocument(app, builder.build());
}

export const SWAGGER_UI_OPTIONS: SwaggerCustomOptions = {
  jsonDocumentUrl: SWAGGER_JSON_PATH,
  customSiteTitle: 'Hotel Booking API — Swagger UI',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: 'list',
    filter: true,
  },
};

/**
 * Mounts Swagger UI at `/docs` and the OpenAPI JSON at `/docs-json`.
 * Call once in `main.ts` after the app is created, before `listen()`:
 *
 *   setupSwagger(app);
 */
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(SWAGGER_PATH, app, document, SWAGGER_UI_OPTIONS);
  return document;
}
