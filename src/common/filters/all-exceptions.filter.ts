import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Normalizes all errors into Laravel-compatible JSON so the React frontend
 * behaves identically:
 *   - 401  -> { message: "Unauthenticated." }
 *   - 422  -> { message, errors: { field: [..] } }
 *   - 404/others -> { message }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Server Error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (status === HttpStatus.UNAUTHORIZED) {
        body = { message: 'Unauthenticated.' };
      } else if (typeof res === 'string') {
        body = { message: res };
      } else if (res && typeof res === 'object') {
        const obj = res as Record<string, unknown>;
        if (obj.errors) {
          body = { message: obj.message ?? 'The given data was invalid.', errors: obj.errors };
        } else {
          const message = obj.message;
          body = { message: Array.isArray(message) ? message[0] : (message ?? 'Error') };
        }
      }
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }
}
