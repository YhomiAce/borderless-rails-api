import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { DomainError } from '../errors/domain-error';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

const STATUS_CODES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const mapped = this.map(exception);
    if (mapped.status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const body: ErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined && { details: mapped.details }),
        ...(typeof req.id === 'string' && { requestId: req.id }),
      },
    };
    res.status(mapped.status).json(body);
  }

  private map(exception: unknown): MappedError {
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details:
          zodError instanceof ZodError
            ? zodError.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
            : undefined,
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'HTTP_ERROR'),
        message: status >= 500 ? 'Internal server error' : exception.message,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    };
  }
}
