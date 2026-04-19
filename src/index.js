import express from 'express';
import { config } from './config.js';
import { logger, createLogger } from './utils/logger.js';
import { handleLinearWebhook } from './webhooks/linear.js';
import { runPipeline } from './pipeline/orchestrator.js';

const log = createLogger('Server');
const app = express();

// ═══════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════

// Parse JSON body and preserve raw body for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// Request logging
app.use((req, _res, next) => {
  log.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// ═══════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════

// Health check
app.get('/', (_req, res) => {
  res.json({
    name: 'AI PR Pipeline',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Linear webhook endpoint
app.post('/webhooks/linear', handleLinearWebhook);

// Manual trigger endpoint (for testing / debugging)
app.post('/api/trigger', async (req, res) => {
  const { issueId } = req.body;

  if (!issueId) {
    return res.status(400).json({ error: 'Missing issueId in request body' });
  }

  log.info(`Manual trigger for issue: ${issueId}`);

  res.json({
    status: 'accepted',
    issueId,
    message: 'Pipeline started manually',
  });

  // Run async
  runPipeline(issueId).catch((err) => {
    log.error(`Manual pipeline failed: ${err.message}`);
  });
});

// Pipeline status endpoint
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    config: {
      repo: `${config.github.owner}/${config.github.repo}`,
      triggerLabel: config.linear.triggerLabel,
      geminiModel: config.gemini.model,
      gcpProject: config.gcp.projectId,
      gcpRegion: config.gcp.region,
    },
  });
});

// ═══════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════

app.use((err, _req, res, _next) => {
  log.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ═══════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════

app.listen(config.port, () => {
  log.info(`
╔═══════════════════════════════════════════════════════════╗
║                  AI PR Pipeline Server                    ║
╠═══════════════════════════════════════════════════════════╣
║  🌐 Server:    http://localhost:${String(config.port).padEnd(27)}║
║  📡 Webhook:   http://localhost:${config.port}/webhooks/linear${' '.repeat(Math.max(0, 14 - String(config.port).length))}║
║  🔧 Trigger:   POST /api/trigger                         ║
║  📊 Status:    GET /api/status                            ║
╠═══════════════════════════════════════════════════════════╣
║  GitHub:  ${(config.github.owner + '/' + config.github.repo).padEnd(46)}║
║  Label:   ${config.linear.triggerLabel.padEnd(46)}║
║  Model:   ${config.gemini.model.padEnd(46)}║
║  GCP:     ${config.gcp.projectId.padEnd(46)}║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received — shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received — shutting down...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});
