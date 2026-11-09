import type { ValidationIssue } from '@resellpilot/shared';
import type { ZodError } from 'zod';

/** Error de validación de datos del usuario → 400 con la lista de problemas. */
export class ValidationError extends Error {
  constructor(public readonly issues: ValidationIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} no existe`);
    this.name = 'NotFoundError';
  }
}

export function zodIssues(error: ZodError, prefix = ''): ValidationIssue[] {
  return error.issues.map((issue) => {
    const missing = issue.code === 'invalid_type' && issue.received === 'undefined';
    return {
      path: prefix + (issue.path.join('.') || 'body'),
      message: missing ? 'obligatorio' : issue.message,
    };
  });
}
