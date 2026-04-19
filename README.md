# 🤖 AI PR Pipeline

> Automatically turn Linear tickets into GitHub PRs with GCP Cloud Run previews — powered entirely by AI.

## How It Works

```
Linear Ticket (tagged "ai") → Webhook → Gemini AI → GitHub PR → Cloud Run Preview
```

1. **Tag a ticket** with `ai` in Linear
2. The webhook server receives the event
3. **Gemini 2.5 Pro** reads the ticket and generates code changes
4. A **GitHub PR** is created with the changes and AI-generated description
5. A **Cloud Run preview** is deployed and linked in the PR

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Get API Keys

| Service | Where to Get |
|---------|-------------|
| **Linear API Key** | Linear → Settings → API → Personal API Keys |
| **GitHub Token** | GitHub → Settings → Developer Settings → Personal Access Tokens (needs `repo` scope) |
| **Gemini API Key** | [Google AI Studio](https://aistudio.google.com/apikey) |
| **GCP Service Account** | [GCP Console](https://console.cloud.google.com/iam-admin/serviceaccounts) |

### 4. Set Up Target Repo

```bash
npm run setup:repo
```

This creates the target GitHub repo with a Next.js 15 scaffold if it doesn't exist.

### 5. Start the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### 6. Configure Linear Webhook

1. Go to **Linear → Settings → API → Webhooks**
2. Add a new webhook:
   - **URL**: `https://your-server-url/webhooks/linear`
   - **Events**: Issues
3. Copy the webhook signing secret to your `.env`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check + info |
| `GET` | `/health` | Simple health check |
| `POST` | `/webhooks/linear` | Linear webhook receiver |
| `POST` | `/api/trigger` | Manual trigger (body: `{ "issueId": "..." }`) |
| `GET` | `/api/status` | Server status + config |

## Manual Trigger

For testing, you can manually trigger the pipeline:

```bash
curl -X POST http://localhost:3000/api/trigger \
  -H "Content-Type: application/json" \
  -d '{"issueId": "your-linear-issue-id"}'
```

## Deploy to Cloud Run

```bash
# Build and push
gcloud builds submit --tag gcr.io/YOUR_PROJECT/ai-pr-pipeline

# Deploy
gcloud run deploy ai-pr-pipeline \
  --image gcr.io/YOUR_PROJECT/ai-pr-pipeline \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "LINEAR_API_KEY=...,GITHUB_TOKEN=...,GEMINI_API_KEY=...,GCP_PROJECT_ID=..."
```

## GCP Setup

### Required APIs
Enable these in your GCP project:
- Cloud Run API
- Cloud Build API
- Artifact Registry API

### Required IAM Roles
The service account needs:
- `roles/run.admin`
- `roles/cloudbuild.builds.editor`
- `roles/artifactregistry.writer`
- `roles/iam.serviceAccountUser`

### Create Artifact Registry Repo
```bash
gcloud artifacts repositories create previews \
  --repository-format=docker \
  --location=us-central1
```

## Architecture

```
┌──────────┐    Webhook    ┌────────────────┐
│  Linear  │──────────────▶│ Express Server │
└──────────┘               └───────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │  Fetch Ticket   │
                          │  Details        │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │  Fetch Repo     │
                          │  Context        │
                          └────────┬────────┘
                                   │
                          ┌────────▼────────┐
                          │  Gemini 2.5 Pro │
                          │  Generate Code  │
                          └────────┬────────┘
                                   │
                     ┌─────────────┼─────────────┐
                     │             │              │
              ┌──────▼──────┐ ┌───▼───┐ ┌────────▼────────┐
              │ GitHub PR   │ │ Build │ │ Cloud Run       │
              │ Created     │ │ Image │ │ Preview Deploy  │
              └─────────────┘ └───────┘ └─────────────────┘
```

## License

MIT
