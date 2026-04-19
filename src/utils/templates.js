/**
 * Generate a well-structured GitHub PR description from ticket details and AI-generated changes.
 */
export function buildPRDescription({ ticket, changedFiles, previewUrl }) {
  const fileList = changedFiles
    .map((f) => {
      const icon = f.action === 'create' ? '🆕' : f.action === 'update' ? '✏️' : '🗑️';
      return `- ${icon} \`${f.path}\` — ${f.action}`;
    })
    .join('\n');

  return `## 🤖 AI-Generated PR

> This PR was automatically generated from a Linear ticket using AI.

### 📋 Linear Ticket
- **Title**: ${ticket.title}
- **ID**: ${ticket.identifier}
- **Priority**: ${ticket.priority || 'None'}
- **URL**: ${ticket.url}

### 📝 Description
${ticket.description || '_No description provided in the ticket._'}

### 📁 Changes
${fileList}

### 🔗 Preview
${previewUrl ? `🌐 **[Live Preview](${previewUrl})**` : '⏳ Preview deployment in progress...'}

---
<sub>🛠️ Powered by AI PR Pipeline • Gemini 2.5 Pro • Cloud Run</sub>`;
}

/**
 * Build a comment to post on the Linear ticket after PR creation.
 */
export function buildLinearComment({ prUrl, previewUrl, changedFiles }) {
  const fileCount = changedFiles.length;
  return `🤖 **AI PR Created**

A pull request with ${fileCount} file change(s) has been opened:
🔗 ${prUrl}

${previewUrl ? `🌐 Preview: ${previewUrl}` : '⏳ Preview deployment in progress...'}`;
}

/**
 * Build a comment to update the PR with the preview URL after deployment.
 */
export function buildPreviewComment(previewUrl) {
  return `## 🌐 Preview Deployed!

Your preview environment is live:
**${previewUrl}**

This preview will be automatically cleaned up when the PR is closed.`;
}
