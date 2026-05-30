export class AbnError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AbnError";
    this.code = code;
  }
}

export class AbnAuthenticationError extends AbnError {
  constructor(message = "ABN authentication failed", options?: ErrorOptions) {
    super("abn_authentication_failed", message, options);
    this.name = "AbnAuthenticationError";
  }
}

export class AbnPayloadError extends AbnError {
  constructor(message: string, options?: ErrorOptions) {
    super("abn_payload_invalid", message, options);
    this.name = "AbnPayloadError";
  }
}

export class AbnTransportError extends AbnError {
  constructor(message: string, options?: ErrorOptions) {
    super("abn_transport_failed", message, options);
    this.name = "AbnTransportError";
  }
}
