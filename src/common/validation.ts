import { UnprocessableEntityException, ValidationError, ValidationPipe } from '@nestjs/common';

/**
 * A ValidationPipe configured to emit Laravel-style 422 responses:
 * { message, errors: { field: ["message", ...] } }
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidUnknownValues: false,
    exceptionFactory: (errors: ValidationError[]) => {
      const formatted: Record<string, string[]> = {};
      const walk = (errs: ValidationError[], prefix = '') => {
        for (const err of errs) {
          const field = prefix ? `${prefix}.${err.property}` : err.property;
          if (err.constraints) {
            formatted[field] = Object.values(err.constraints);
          }
          if (err.children?.length) {
            walk(err.children, field);
          }
        }
      };
      walk(errors);
      return new UnprocessableEntityException({
        message: 'The given data was invalid.',
        errors: formatted,
      });
    },
  });
}
