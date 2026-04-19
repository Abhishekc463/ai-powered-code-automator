import { LinearClient } from '@linear/sdk';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('LinearService');

let client;

function getClient() {
  if (!client) {
    client = new LinearClient({ apiKey: config.linear.apiKey });
  }
  return client;
}

/**
 * Fetch full issue details from Linear by issue ID.
 */
export async function getIssueDetails(issueId) {
  log.info(`Fetching issue details for: ${issueId}`);
  const linearClient = getClient();

  const issue = await linearClient.issue(issueId);
  if (!issue) {
    throw new Error(`Issue not found: ${issueId}`);
  }

  // Fetch labels
  const labels = await issue.labels();
  const labelNames = labels.nodes.map((l) => l.name);

  // Fetch comments for additional context
  const comments = await issue.comments();
  const commentTexts = comments.nodes
    .map((c) => c.body)
    .filter(Boolean);

  // Fetch assignee info
  const assignee = await issue.assignee;

  // Fetch team info
  const team = await issue.team;

  const details = {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description || '',
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    url: issue.url,
    labels: labelNames,
    comments: commentTexts,
    assignee: assignee ? assignee.name : null,
    team: team ? team.name : null,
    createdAt: issue.createdAt,
  };

  log.info(`Fetched issue: ${details.identifier} — "${details.title}"`);
  return details;
}

/**
 * Post a comment on a Linear issue.
 */
export async function commentOnIssue(issueId, body) {
  log.info(`Posting comment on issue: ${issueId}`);
  const linearClient = getClient();

  await linearClient.createComment({
    issueId,
    body,
  });

  log.info('Comment posted successfully');
}

/**
 * Update issue state (e.g., move to "In Progress").
 */
export async function updateIssueState(issueId, stateId) {
  log.info(`Updating issue ${issueId} state to: ${stateId}`);
  const linearClient = getClient();

  await linearClient.updateIssue(issueId, {
    stateId,
  });

  log.info('Issue state updated');
}

/**
 * Validate the webhook payload signature.
 * Note: This is also done in the webhook handler — this is a utility
 * export for use in other contexts if needed.
 */
export async function validateWebhookSignature(body, signature) {
  if (!config.linear.webhookSecret) {
    log.warn('No webhook secret configured — skipping signature validation');
    return true;
  }

  const crypto = await import('crypto');
  const hmac = crypto.createHmac('sha256', config.linear.webhookSecret);
  hmac.update(typeof body === 'string' ? body : JSON.stringify(body));
  const expectedSignature = hmac.digest('hex');

  return signature === expectedSignature;
}
