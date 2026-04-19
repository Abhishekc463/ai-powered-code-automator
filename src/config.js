import dotenv from 'dotenv';
dotenv.config();

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional = (key, defaultValue) => process.env[key] || defaultValue;

export const config = {
  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  logLevel: optional('LOG_LEVEL', 'info'),

  // Linear
  linear: {
    apiKey: required('LINEAR_API_KEY'),
    webhookSecret: optional('LINEAR_WEBHOOK_SECRET', ''),
    triggerLabel: optional('LINEAR_TRIGGER_LABEL', 'ai'),
  },

  // GitHub
  github: {
    token: required('GITHUB_TOKEN'),
    owner: required('GITHUB_OWNER'),
    repo: required('GITHUB_REPO'),
    defaultBranch: optional('GITHUB_DEFAULT_BRANCH', 'main'),
  },

  // Gemini
  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    model: optional('GEMINI_MODEL', 'gemini-2.5-pro-preview-05-06'),
  },

  // GCP (optional — preview deployments will be skipped if not configured)
  gcp: {
    projectId: optional('GCP_PROJECT_ID', ''),
    region: optional('GCP_REGION', 'us-central1'),
  },
};
