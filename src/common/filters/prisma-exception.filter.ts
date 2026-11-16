import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/** Codes meaning "database unreachable / overloaded", not "bad request". */
const UNAVAILABLE_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
]);

/**
 * Turns Prisma errors into clear HTTP responses instead of opaque 500s
 * (FR-32/33, NFR-9). Never echoes Prisma's message: it can contain query
 * arguments, i.e. user data (NFR-4).
 */
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientRustPanicError,
  Prisma.PrismaClientUnknownRequestError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Prisma');

  catch(exception: Error, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, message, code } = this.map(exception);

    if (status >= 500) {
      this.logger.error(`${exception.name} code=${code ?? 'n/a'} -> ${status}`);
    }
    res.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status],
    });
  }

  private map(e: Error): { status: number; message: string; code?: string } {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (UNAVAILABLE_CODES.has(e.code)) {
        return this.unavailable(e.code);
      }
      switch (e.code) {
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            message: 'Resource not found',
            code: e.code,
          };
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            message: 'A record with the same unique value already exists',
            code: e.code,
          };
        case 'P2034': // write conflict / deadlock between concurrent transactions
          return {
            status: HttpStatus.CONFLICT,
            message:
              'Request conflicted with a concurrent update, please try again',
            code: e.code,
          };
        case 'P2003':
          return {
            status: HttpStatus.CONFLICT,
            message: 'Operation conflicts with related records',
            code: e.code,
          };
      }
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        code: e.code,
      };
    }
    if (e instanceof Prisma.PrismaClientInitializationError) {
      return this.unavailable(e.errorCode);
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }

  private unavailable(code?: string) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      message: 'Database is temporarily unavailable, please try again later',
      code,
    };
  }
}
