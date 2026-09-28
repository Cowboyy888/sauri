/** Errors that are safe to show to the person who triggered them. */
export class BusinessError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message);
    this.name = "BusinessError";
  }
}
export class InsufficientStockError extends BusinessError {
  constructor(message: string) { super(message, "INSUFFICIENT_STOCK", 409); }
}
export class NotFoundError extends BusinessError {
  constructor(message: string) { super(message, "NOT_FOUND", 404); }
}
export class ForbiddenError extends BusinessError {
  constructor(message = "You do not have permission to do that.") { super(message, "FORBIDDEN", 403); }
}
export class ValidationError extends BusinessError {
  constructor(message: string) { super(message, "VALIDATION", 422); }
}
