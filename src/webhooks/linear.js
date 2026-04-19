import crypto from 'crypto';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { runPipeline } from '../pipeline/orchestrator.js';

const log = createLogger('LinearWebhook');

/**
 * Express handler for Linear webhook events.
 */
export async function handleLinearWebhook(req, res) {
  const startTime = Date.now();

  try {
    // Validate webhook signature if secret is configured
    if (config.linear.webhookSecret) {
      const signature = req.headers['linear-signature'];
      const rawBody = req.rawBody || JSON.stringify(req.body);

      if (!verifySignature(rawBody, signature)) {
        log.warn('Invalid webhook signature — rejecting');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;

    log.info(`Webhook received: action=${payload.action}, type=${payload.type}`, {
      action: payload.action,
      type: payload.type,
    });

    // We're interested in Issue updates where the "ai" label is added
    if (!shouldProcess(payload)) {
      log.debug('Event not relevant — skipping');
      return res.status(200).json({ status: 'skipped', reason: 'not a relevant event' });
    }

    const issueId = payload.data?.id;
    if (!issueId) {
      log.warn('No issue ID in payload');
      return res.status(400).json({ error: 'Missing issue ID' });
    }

    log.info(`Processing issue: ${issueId} (${payload.data?.identifier || 'unknown'})`);

    // Respond immediately so Linear doesn't timeout
    res.status(200).json({
      status: 'accepted',
      issueId,
      message: 'Pipeline started',
    });

    // Run the pipeline asynchronously
    runPipeline(issueId)
      .then((result) => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log.info(`Pipeline completed for ${issueId} in ${elapsed}s`, result);
      })
      .catch((err) => {
        log.error(`Pipeline failed for ${issueId}`, { error: err.message });
      });
  } catch (err) {
    log.error('Webhook handler error', { error: err.message, stack: err.stack });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

/**
 * Determine if the webhook payload should trigger the pipeline.
 *
 * We trigger when:
 * - An Issue is updated
 * - The "ai" label was added (present in labelIds or in updated labels)
 */
function shouldProcess(payload) {
  const { action, type, data, updatedFrom } = payload;

  // Must be an Issue event
  if (type !== 'Issue') {
    return false;
  }

  // Handle "update" actions where a label was added
  if (action === 'update') {
    // Check if labels were changed
    const currentLabels = data?.labels || [];
    const previousLabelIds = updatedFrom?.labelIds;

    // If labelIds were updated, check if the trigger label was just added
    if (previousLabelIds) {
      const triggerLabel = config.linear.triggerLabel.toLowerCase();

      // Check if any of the current labels match the trigger
      const hasLabel = currentLabels.some(
        (label) => label.name?.toLowerCase() === triggerLabel
      );

      if (hasLabel) {
        // Verify it was actually added (not already there)
        const wasAdded = !previousLabelIds.some((prevId) =>
          currentLabels.some(
            (cl) => cl.id === prevId && cl.name?.toLowerCase() === triggerLabel
          )
        );

        if (wasAdded || hasLabel) {
          log.info(`Trigger label "${triggerLabel}" detected on issue`);
          return true;
        }
      }
    }

    // Alternative: Check if the update data directly has the label
    if (data?.labelIds) {
      // Labels were modified — check current labels from data
      const labelNames = (data.labels || []).map((l) =>
        l.name?.toLowerCase()
      );
      if (labelNames.includes(config.linear.triggerLabel.toLowerCase())) {
        log.info('Trigger label found in current labels');
        return true;
      }
    }
  }

  // Also handle "create" action if the issue is created with the label
  if (action === 'create') {
    const labelNames = (data?.labels || []).map((l) => l.name?.toLowerCase());
    if (labelNames.includes(config.linear.triggerLabel.toLowerCase())) {
      log.info('Issue created with trigger label');
      return true;
    }
  }

  return false;
}

/**
 * Verify the Linear webhook signature.
 */
function verifySignature(body, signature) {
  if (!signature || !config.linear.webhookSecret) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.linear.webhookSecret);
  hmac.update(typeof body === 'string' ? body : JSON.stringify(body));
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
