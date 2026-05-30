import { z } from "zod";

const defaultTestingProfile = {
  email: "dev-user@example.test",
  groups: ["finance-app"],
  nickname: "dev-user",
  sub: "dev-user",
};

const testingProfileSchema = z
  .object({
    email: z.email(),
    groups: z.array(z.string()).default([]),
    nickname: z.string().optional(),
    sub: z.string().min(1),
  })
  .passthrough();

const rawEnvSchema = z.object({
  ALLOWED_EMAILS: z.string().default(defaultTestingProfile.email),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  HTTP_HOST: z.string().min(1).default("127.0.0.1"),
  HTTP_PORT: positiveIntegerString("HTTP_PORT").default("5174"),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_ENABLED: booleanString().default(false),
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_SCOPES: z.string().default("openid email profile"),
  OIDC_TESTING_PROFILE_JSON: z.string().default(JSON.stringify(defaultTestingProfile)),
  SECRET_KEY: z.string().min(12).default("dev-secret-change-me"),
});

export type TestingProfile = z.infer<typeof testingProfileSchema>;

export type AppConfig = {
  allowedEmails: ReadonlySet<string>;
  appEnv: "development" | "test" | "production";
  http: {
    host: string;
    port: number;
  };
  oidc: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    enabled: boolean;
    issuerUrl: string | undefined;
    redirectUri: string | undefined;
    scopes: string;
    testingProfile: TestingProfile;
  };
  secretKey: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawEnvSchema.parse(env);
  const testingProfile = parseTestingProfile(parsed.OIDC_TESTING_PROFILE_JSON);
  const allowedEmails = parseAllowedEmails(parsed.ALLOWED_EMAILS);

  if (parsed.APP_ENV === "production" && parsed.SECRET_KEY === "dev-secret-change-me") {
    throw new Error("SECRET_KEY must be changed outside development");
  }

  if (parsed.OIDC_ENABLED) {
    requireOidcValue(parsed.OIDC_ISSUER_URL, "OIDC_ISSUER_URL");
    requireOidcValue(parsed.OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
    requireOidcValue(parsed.OIDC_CLIENT_SECRET, "OIDC_CLIENT_SECRET");
    requireOidcValue(parsed.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI");
  }

  return {
    allowedEmails,
    appEnv: parsed.APP_ENV,
    http: {
      host: parsed.HTTP_HOST,
      port: Number(parsed.HTTP_PORT),
    },
    oidc: {
      clientId: parsed.OIDC_CLIENT_ID,
      clientSecret: parsed.OIDC_CLIENT_SECRET,
      enabled: parsed.OIDC_ENABLED,
      issuerUrl: parsed.OIDC_ISSUER_URL,
      redirectUri: parsed.OIDC_REDIRECT_URI,
      scopes: parsed.OIDC_SCOPES,
      testingProfile,
    },
    secretKey: parsed.SECRET_KEY,
  };
}

export function isAllowedEmail(config: AppConfig, email: string): boolean {
  return config.allowedEmails.has(email.toLowerCase());
}

function parseAllowedEmails(value: string): ReadonlySet<string> {
  const emails = value
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    throw new Error("ALLOWED_EMAILS must contain at least one email");
  }

  return new Set(emails);
}

function parseTestingProfile(value: string): TestingProfile {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("OIDC_TESTING_PROFILE_JSON must be valid JSON", { cause: error });
  }

  return testingProfileSchema.parse(parsed);
}

function requireOidcValue(value: string | undefined, name: string): asserts value is string {
  if (!value) {
    throw new Error(`${name} is required when OIDC_ENABLED=true`);
  }
}

function booleanString() {
  return z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => {
      if (value === "true") {
        return true;
      }
      if (value === "false") {
        return false;
      }
      throw new Error("Expected true or false");
    });
}

function positiveIntegerString(name: string) {
  return z.string().refine((value) => Number.isInteger(Number(value)) && Number(value) > 0, {
    message: `${name} must be a positive integer`,
  });
}
