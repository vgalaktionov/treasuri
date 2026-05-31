import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function ensureCsrfToken(request: Request): string {
  request.session.csrfToken ??= crypto.randomBytes(32).toString("base64url");
  return request.session.csrfToken;
}

export function requireCsrf(request: Request, response: Response, next: NextFunction) {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }

  const expected = ensureCsrfToken(request);
  const supplied = request.get("x-csrf-token");

  if (!supplied || !isEqualToken(supplied, expected)) {
    response.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  next();
}

function isEqualToken(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}
