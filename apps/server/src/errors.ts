import type { FastifyReply } from "fastify";

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorBody(error: unknown): {
  error: { code: string; message: string; context?: Record<string, unknown> };
} {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.context === undefined ? {} : { context: error.context }),
      },
    };
  }
  return { error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } };
}

export function sendError(reply: FastifyReply, error: unknown): void {
  const status = error instanceof AppError ? error.statusCode : 500;
  void reply.status(status).send(errorBody(error));
}
