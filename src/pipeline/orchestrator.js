import { createLogger } from '../utils/logger.js';
import { getIssueDetails, commentOnIssue } from '../services/linear.js';
import {
  ensureRepoExists,
  getRepoContext,
  createBranch,
  commitChanges,
  createPullRequest,
  commentOnPR,
  addLabelsToPR,
} from '../services/github.js';
import { generateCodeChanges } from '../services/gemini.js';
import { deployPreview } from '../services/cloudrun.js';
import {
  buildPRDescription,
  buildLinearComment,
  buildPreviewComment,
} from '../utils/templates.js';
import {
  isGStackAvailable,
  reviewCodeChanges,
  investigateIssue,
  generateQualityReport,
  formatReviewForPR,
} from '../services/gstack.js';

const log = createLogger('Orchestrator');

// Track in-progress pipelines to prevent duplicates
const activePipelines = new Set();

/**
 * Main pipeline orchestrator.
 * Takes a Linear issue ID and runs the full automation pipeline:
 * 1. Fetch ticket → 2. Get repo context → 3. AI generate → 4. Create PR → 5. Deploy preview
 */
export async function runPipeline(issueId) {
  // Prevent duplicate runs for the same issue
  if (activePipelines.has(issueId)) {
    log.warn(`Pipeline already running for issue ${issueId} — skipping`);
    return;
  }

  activePipelines.add(issueId);
  const startTime = Date.now();

  try {
    log.info(`═══ Pipeline started for issue: ${issueId} ═══`);
    
    // Check if gstack is available
    const gstackEnabled = isGStackAvailable();
    if (gstackEnabled) {
      log.info('✨ gstack skills enabled - enhanced quality checks active');
    }

    // ── Step 1: Fetch ticket details ──────────────────────────
    log.info('Step 1/6: Fetching ticket details from Linear...');
    const ticket = await getIssueDetails(issueId);
    log.info(`Ticket: ${ticket.identifier} — "${ticket.title}"`);

    // ── Step 2: Ensure repo exists & get context ──────────────
    log.info('Step 2/6: Preparing repository context...');
    const isNewRepo = await ensureRepoExists();
    if (isNewRepo) {
      log.info('New repo created — waiting for GitHub to initialize...');
      await sleep(3000);
      await scaffoldNextJsRepo(ticket);
    }
    const repoContext = await getRepoContext();
    log.info(`Repo has ${repoContext.tree.length} files`);

    // ── Step 2.5: Investigate issue (gstack methodology) ──────
    let investigation = null;
    if (gstackEnabled) {
      log.info('🔍 Step 2.5/6: Investigating issue systematically (gstack)...');
      investigation = await investigateIssue(ticket, repoContext);
      log.info(`Investigation: ${investigation.hypothesis.length} hypotheses identified`);
    }

    // ── Step 3: Generate code changes with AI ─────────────────
    log.info('Step 3/6: Generating code changes with Gemini AI...');
    const aiResult = await generateCodeChanges(ticket, repoContext);
    log.info(`AI generated: ${aiResult.changes.length} changes — "${aiResult.summary}"`);

    // Validate changes
    const validChanges = aiResult.changes.filter((change) => {
      if ((change.action === 'create' || change.action === 'update') && !change.content) {
        log.warn(`Skipping ${change.path} — no content provided`);
        return false;
      }
      return true;
    });

    if (validChanges.length === 0) {
      throw new Error('AI generated no valid file changes');
    }

    // ── Step 3.5: Code Review (gstack methodology) ────────────
    let reviewResult = null;
    let qualityReport = null;
    if (gstackEnabled) {
      log.info('📋 Step 3.5/6: Running code review (gstack)...');
      reviewResult = await reviewCodeChanges(validChanges);
      qualityReport = generateQualityReport(reviewResult, investigation);
      log.info(`Review score: ${qualityReport.score.toFixed(1)}/10 — ${reviewResult.passed ? 'PASSED' : 'NEEDS WORK'}`);
      
      if (reviewResult.findings.length > 0) {
        log.info(`Found ${reviewResult.findings.length} issues during review`);
      }
    }

    // ── Step 4: Create branch, commit, and open PR ────────────
    log.info('Step 4/6: Creating GitHub PR...');
    const branchName = `ai/${ticket.identifier.toLowerCase().replace(/\s+/g, '-')}`;

    await createBranch(branchName);
    await commitChanges(branchName, validChanges, aiResult.commitMessage);

    // Build initial PR description (preview URL pending)
    const prBody = buildPRDescription({
      ticket,
      changedFiles: validChanges,
      previewUrl: null,
    });

    const pr = await createPullRequest({
      title: aiResult.prTitle || `🤖 ${ticket.identifier}: ${ticket.title}`,
      body: prBody,
      branchName,
    });

    // Add labels
    const labels = ['ai-generated', 'automated'];
    if (gstackEnabled && reviewResult) {
      if (reviewResult.passed) {
        labels.push('review-passed');
      } else {
        labels.push('needs-review');
      }
    }
    await addLabelsToPR(pr.number, labels);

    // Post gstack review results as PR comment
    if (gstackEnabled && reviewResult) {
      const reviewComment = formatReviewForPR(reviewResult, qualityReport);
      await commentOnPR(pr.number, reviewComment);
      log.info('Posted gstack review results to PR');
    }

    // Post comment on Linear ticket
    let linearComment = buildLinearComment({
      prUrl: pr.html_url,
      previewUrl: null,
      changedFiles: validChanges,
    });
    
    // Add quality score to Linear comment if available
    if (gstackEnabled && qualityReport) {
      linearComment += `\n\n**Code Quality:** ${qualityReport.score.toFixed(1)}/10 ${reviewResult.passed ? '✅' : '⚠️'}`;
      if (!reviewResult.passed) {
        linearComment += '\n*Review found issues that should be addressed.*';
      }
    }
    
    await commentOnIssue(issueId, linearComment);

    log.info(`PR #${pr.number} created: ${pr.html_url}`);

    // ── Step 5: Deploy preview ────────────────────────────────
    log.info('Step 5/6: Deploying preview to Cloud Run...');
    let previewUrl;
    try {
      previewUrl = await deployPreview({
        branchName,
        prNumber: pr.number,
      });

      // Update PR description with preview URL
      const updatedPRBody = buildPRDescription({
        ticket,
        changedFiles: validChanges,
        previewUrl,
      });

      // Can't update PR body directly, so add a comment
      await commentOnPR(pr.number, buildPreviewComment(previewUrl));

      // Update Linear ticket with preview URL
      await commentOnIssue(
        issueId,
        `🌐 Preview deployed: ${previewUrl}`
      );

      log.info(`Preview deployed: ${previewUrl}`);
    } catch (deployErr) {
      log.error('Preview deployment failed (PR still created)', {
        error: deployErr.message,
      });
      await commentOnPR(
        pr.number,
        `⚠️ Preview deployment failed: ${deployErr.message}\n\nYou can still review the code changes in this PR.`
      );
    }

    // ── Done ──────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.info(`═══ Pipeline completed in ${elapsed}s ═══`);
    log.info(`  PR: ${pr.html_url}`);
    log.info(`  Preview: ${previewUrl || 'N/A'}`);
    if (gstackEnabled && qualityReport) {
      log.info(`  Quality: ${qualityReport.score.toFixed(1)}/10 ${reviewResult.passed ? '✅' : '⚠️'}`);
    }

    return {
      pr: {
        number: pr.number,
        url: pr.html_url,
      },
      previewUrl,
      changesCount: validChanges.length,
      elapsed,
      quality: gstackEnabled ? {
        score: qualityReport.score,
        passed: reviewResult.passed,
        findings: reviewResult.findings.length,
        recommendations: reviewResult.recommendations.length,
      } : null,
    };
  } catch (err) {
    log.error(`Pipeline failed for issue ${issueId}`, { error: err.message, stack: err.stack });

    // Try to post failure comment on Linear
    try {
      await commentOnIssue(
        issueId,
        `❌ **AI PR Pipeline Failed**\n\nError: ${err.message}\n\nPlease check the pipeline logs for details.`
      );
    } catch {
      // Ignore comment failure
    }

    throw err;
  } finally {
    activePipelines.delete(issueId);
  }
}

/**
 * Scaffold a basic Next.js project in a newly created repo.
 */
async function scaffoldNextJsRepo(ticket) {
  log.info('Scaffolding Next.js project in new repo...');

  const scaffoldFiles = [
    {
      path: 'package.json',
      action: 'update',
      content: JSON.stringify(
        {
          name: 'my-nextjs-app',
          version: '0.1.0',
          private: true,
          scripts: {
            dev: 'next dev',
            build: 'next build',
            start: 'next start',
            lint: 'next lint',
          },
          dependencies: {
            next: '15.3.1',
            react: '^19.0.0',
            'react-dom': '^19.0.0',
          },
          devDependencies: {
            '@types/node': '^22',
            '@types/react': '^19',
            '@types/react-dom': '^19',
            typescript: '^5',
          },
        },
        null,
        2
      ),
    },
    {
      path: 'next.config.ts',
      action: 'create',
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
`,
    },
    {
      path: 'tsconfig.json',
      action: 'create',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2017',
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: 'preserve',
            incremental: true,
            plugins: [{ name: 'next' }],
            paths: { '@/*': ['./src/*'] },
          },
          include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
          exclude: ['node_modules'],
        },
        null,
        2
      ),
    },
    {
      path: 'src/app/layout.tsx',
      action: 'create',
      content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My App",
  description: "Built with Next.js and AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      path: 'src/app/page.tsx',
      action: 'create',
      content: `export default function Home() {
  return (
    <main style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <h1>Welcome to My App</h1>
    </main>
  );
}
`,
    },
    {
      path: 'src/app/globals.css',
      action: 'create',
      content: `*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --foreground: #171717;
  --background: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

body {
  color: var(--foreground);
  background: var(--background);
  -webkit-font-smoothing: antialiased;
}
`,
    },
    {
      path: 'Dockerfile',
      action: 'create',
      content: `FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
`,
    },
    {
      path: '.gitignore',
      action: 'update',
      content: `node_modules/
.next/
out/
.env*
*.log
dist/
.DS_Store
`,
    },
  ];

  await commitChanges('main', scaffoldFiles, 'chore: scaffold Next.js 15 project');
  log.info('Next.js project scaffolded successfully');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
