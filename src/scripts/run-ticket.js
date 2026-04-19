/**
 * Direct pipeline execution script.
 * Fetches ticket ABH-5 from Linear and creates a GitHub PR.
 * 
 * Usage: node src/scripts/run-ticket.js
 */
import dotenv from 'dotenv';
dotenv.config();

import { LinearClient } from '@linear/sdk';
import { Octokit } from '@octokit/rest';
// OpenRouter API (OpenAI-compatible) — no SDK needed, using fetch

// ═══════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║        AI PR Pipeline — Direct Execution          ║');
console.log('╠═══════════════════════════════════════════════════╣');
console.log(`║  Repo: ${GITHUB_OWNER}/${GITHUB_REPO}`);
console.log(`║  Target: ABH-6 (Create a new page for document implementation)`);
console.log('╚═══════════════════════════════════════════════════╝');
console.log('');

// ═══════════════════════════════════════════
// Step 1: Fetch Linear Ticket
// ═══════════════════════════════════════════
console.log('━━━ Step 1/4: Fetching Linear ticket... ━━━');

const linear = new LinearClient({ apiKey: LINEAR_API_KEY });

// Search for issue ABH-6
const issues = await linear.issues({
  filter: {
    number: { eq: 6 },
    team: { key: { eq: 'ABH' } },
  },
});

const issue = issues.nodes[0];
if (!issue) {
  console.error('❌ Could not find issue ABH-5');
  process.exit(1);
}

const labels = await issue.labels();
const comments = await issue.comments();

const ticket = {
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  description: issue.description || '',
  priority: issue.priorityLabel,
  url: issue.url,
  labels: labels.nodes.map(l => l.name),
  comments: comments.nodes.map(c => c.body).filter(Boolean),
};

console.log(`✅ Ticket: ${ticket.identifier} — "${ticket.title}"`);
console.log(`   Description: ${ticket.description || '(no description)'}`);
console.log(`   Labels: ${ticket.labels.join(', ') || 'none'}`);
console.log(`   Priority: ${ticket.priority || 'none'}`);
console.log('');

// ═══════════════════════════════════════════
// Step 2: Get GitHub Repo Context
// ═══════════════════════════════════════════
console.log('━━━ Step 2/4: Fetching repo context... ━━━');

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Check if repo has any content
let repoTree = [];
let repoFiles = {};
let defaultBranchSha;

try {
  const { data: branch } = await octokit.repos.getBranch({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: 'main',
  });
  defaultBranchSha = branch.commit.sha;

  const { data: tree } = await octokit.git.getTree({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    tree_sha: defaultBranchSha,
    recursive: 'true',
  });
  repoTree = tree.tree.filter(i => i.type === 'blob').map(i => i.path);

  // Get key file contents
  for (const filePath of repoTree.filter(f =>
    ['package.json', 'next.config.ts', 'next.config.mjs', 'tsconfig.json',
      'src/app/layout.tsx', 'src/app/page.tsx', 'src/app/globals.css',
      'app/layout.tsx', 'app/page.tsx'].includes(f)
  )) {
    try {
      const { data } = await octokit.repos.getContent({
        owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filePath,
      });
      if (data.type === 'file') {
        repoFiles[filePath] = Buffer.from(data.content, 'base64').toString('utf-8');
      }
    } catch { }
  }

  console.log(`✅ Repo has ${repoTree.length} files`);
} catch (err) {
  console.log('ℹ️  Repo appears to be empty — will scaffold from scratch');

  // Create initial commit with README so we have a branch to work from
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: 'README.md',
    message: 'Initial commit',
    content: Buffer.from('# AI Powered Code Automator\n\nNext.js app managed by AI PR Pipeline.\n').toString('base64'),
  });

  // Wait a moment for GitHub to process
  await new Promise(r => setTimeout(r, 2000));

  const { data: branch } = await octokit.repos.getBranch({
    owner: GITHUB_OWNER, repo: GITHUB_REPO, branch: 'main',
  });
  defaultBranchSha = branch.commit.sha;
  repoTree = ['README.md'];
  console.log('✅ Initialized repo with README');
}
console.log('');

// ═══════════════════════════════════════════
// Step 3: Generate Code with AI (OpenRouter)
// ═══════════════════════════════════════════
console.log('━━━ Step 3/4: Generating code with AI (OpenRouter)... ━━━');

const OPENROUTER_API_KEY = GEMINI_API_KEY; // User's OpenRouter key is stored in GEMINI_API_KEY env var

const systemPrompt = `You are an expert senior full-stack developer specializing in Next.js 15+, React 19, and TypeScript.
Your job is to implement features in a Next.js web application based on ticket descriptions.

Rules:
1. Generate COMPLETE file contents — never use placeholders like "// ... rest of code".
2. For "update" actions, provide the ENTIRE updated file content.
3. Follow Next.js App Router conventions (app/ directory, page.tsx, layout.tsx).
4. Use TypeScript (.tsx/.ts) for all new files.
5. Write production-quality code with proper styling.
6. Use modern React patterns (Server Components by default, "use client" only when needed).
7. Generate conventional commit messages (e.g., "feat: add hello page").
8. If the repo is empty/new, scaffold a complete Next.js project structure.
9. Include package.json, next.config.ts, tsconfig.json, src/app/layout.tsx, src/app/globals.css, and the requested page.
10. Use the Next.js standalone output mode in next.config for Docker compatibility.
11. Include a Dockerfile for the Next.js app.
12. Make the page visually appealing with modern CSS — gradients, animations, clean typography.

You MUST respond with valid JSON in this exact format:
{
  "summary": "Brief summary of changes",
  "changes": [
    {
      "path": "relative/file/path",
      "action": "create",
      "content": "full file content here",
      "reason": "why this file is needed"
    }
  ],
  "commitMessage": "feat: description",
  "prTitle": "PR title here"
}`;

let userPrompt = `## Linear Ticket
**ID**: ${ticket.identifier}
**Title**: ${ticket.title}
**Description**: ${ticket.description || 'Create a hello page — a welcoming page that says hello to visitors.'}

## Current Repository State
### File Tree
\`\`\`
${repoTree.length > 0 ? repoTree.join('\n') : '(empty repo)'}
\`\`\`
`;

if (Object.keys(repoFiles).length > 0) {
  userPrompt += '\n### Key File Contents\n';
  for (const [fp, content] of Object.entries(repoFiles)) {
    userPrompt += `\n#### ${fp}\n\`\`\`\n${content}\n\`\`\`\n`;
  }
}

userPrompt += `\n## Task
Implement the changes described in the ticket. Since this is a new/empty repo, scaffold a complete Next.js 15 project with TypeScript and create the hello page.
The hello page should be beautiful and welcoming with modern design (gradients, animations, clean typography).
Include: package.json, next.config.ts, tsconfig.json, src/app/layout.tsx, src/app/globals.css, src/app/hello/page.tsx, and a Dockerfile.

Respond ONLY with the JSON object. No markdown fences, no extra text.`;

console.log('   Sending to OpenRouter...');

let aiResponse;
const modelsToTry = [
  'google/gemini-flash-1.5', 
  'google/gemini-pro-1.5',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.1-70b-instruct' // Fallback to a non-Google model if needed
];

for (const modelId of modelsToTry) {
  try {
    console.log(`   Trying model: ${modelId}...`);
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ai-pr-pipeline',
        'X-Title': 'AI PR Pipeline',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`   ⚠️ Model ${modelId} failed (${response.status}): ${errText.substring(0, 100)}...`);
      continue;
    }

    const data = await response.json();
    const aiText = data.choices[0].message.content;

    console.log('   Parsing AI response...');

    // Robust JSON cleaning
    let cleanText = aiText.trim();
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    }

    try {
      aiResponse = JSON.parse(cleanText);
      console.log(`   ✅ Success with ${modelId}`);
      break; 
    } catch (err) {
      console.warn(`   ⚠️ JSON parse failed for ${modelId}, trying next...`);
      try {
        const repaired = cleanText.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        aiResponse = JSON.parse(repaired);
        console.log(`   ✅ Success with ${modelId} (repaired JSON)`);
        break;
      } catch (e) {}
    }
  } catch (err) {
    console.warn(`   ⚠️ Error with ${modelId}: ${err.message}`);
  }
}

if (!aiResponse) {
  throw new Error('All OpenRouter models failed. Please check your account and credits.');
}

console.log(`✅ AI generated ${aiResponse.changes.length} file(s): "${aiResponse.summary}"`);
aiResponse.changes.forEach(c => console.log(`   ${c.action === 'create' ? '🆕' : '✏️'} ${c.path} — ${c.reason}`));
console.log('');

// ═══════════════════════════════════════════
// Step 4: Create GitHub Branch, Commit & PR
// ═══════════════════════════════════════════
console.log('━━━ Step 4/4: Creating GitHub PR... ━━━');

const branchName = `ai/abh-6-docs-final`;

// Create branch
console.log(`   Creating branch: ${branchName}`);
try {
  await octokit.git.createRef({
    owner: GITHUB_OWNER, repo: GITHUB_REPO,
    ref: `refs/heads/${branchName}`,
    sha: defaultBranchSha,
  });
} catch (err) {
  if (err.status === 422) {
    console.log('   Branch already exists — reusing');
  } else throw err;
}

// Get current branch state
const { data: refData } = await octokit.git.getRef({
  owner: GITHUB_OWNER, repo: GITHUB_REPO,
  ref: `heads/${branchName}`,
});
const currentSha = refData.object.sha;

const { data: commitData } = await octokit.git.getCommit({
  owner: GITHUB_OWNER, repo: GITHUB_REPO,
  commit_sha: currentSha,
});
const baseTreeSha = commitData.tree.sha;

// Create blobs and tree
console.log('   Creating file blobs...');
const treeItems = [];
for (const change of aiResponse.changes) {
  const content = typeof change.content === 'string' 
    ? change.content 
    : JSON.stringify(change.content, null, 2);
    
  const { data: blob } = await octokit.git.createBlob({
    owner: GITHUB_OWNER, repo: GITHUB_REPO,
    content: Buffer.from(content).toString('base64'),
    encoding: 'base64',
  });
  treeItems.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
}

const { data: newTree } = await octokit.git.createTree({
  owner: GITHUB_OWNER, repo: GITHUB_REPO,
  base_tree: baseTreeSha,
  tree: treeItems,
});

const { data: newCommit } = await octokit.git.createCommit({
  owner: GITHUB_OWNER, repo: GITHUB_REPO,
  message: aiResponse.commitMessage || 'feat: create hello page',
  tree: newTree.sha,
  parents: [currentSha],
});

await octokit.git.updateRef({
  owner: GITHUB_OWNER, repo: GITHUB_REPO,
  ref: `heads/${branchName}`,
  sha: newCommit.sha,
});

console.log(`   ✅ Committed ${treeItems.length} files: ${newCommit.sha.slice(0, 7)}`);

// Create PR
console.log('   Creating Pull Request...');
const prBody = `## 🤖 AI-Generated PR

> This PR was automatically generated from Linear ticket [${ticket.identifier}](${ticket.url}) using AI.

### 📋 Linear Ticket
- **Title**: ${ticket.title}
- **ID**: ${ticket.identifier}
- **Priority**: ${ticket.priority || 'None'}

### 📝 Description
${ticket.description || 'Create a hello page — a welcoming page that says hello to visitors.'}

### 📁 Changes
${aiResponse.changes.map(c => `- ${c.action === 'create' ? '🆕' : '✏️'} \`${c.path}\` — ${c.reason}`).join('\n')}

### 🤖 AI Summary
${aiResponse.summary}

---
<sub>🛠️ Powered by AI PR Pipeline • Gemini 2.5 Pro</sub>`;

let pr;
// Check for existing PR
const { data: existingPRs } = await octokit.pulls.list({
  owner: GITHUB_OWNER, repo: GITHUB_REPO,
  head: `${GITHUB_OWNER}:${branchName}`,
  state: 'open',
});

if (existingPRs.length > 0) {
  pr = existingPRs[0];
  await octokit.pulls.update({
    owner: GITHUB_OWNER, repo: GITHUB_REPO,
    pull_number: pr.number, body: prBody,
  });
  console.log(`   ✅ Updated existing PR #${pr.number}`);
} else {
  const { data: newPR } = await octokit.pulls.create({
    owner: GITHUB_OWNER, repo: GITHUB_REPO,
    title: aiResponse.prTitle || `🤖 ABH-5: Create a hello page`,
    body: prBody,
    head: branchName,
    base: 'main',
  });
  pr = newPR;
  console.log(`   ✅ PR #${pr.number} created`);
}

// Post comment on Linear ticket
try {
  await linear.createComment({
    issueId: ticket.id,
    body: `🤖 **AI PR Created**\n\nA pull request with ${aiResponse.changes.length} file change(s) has been opened:\n🔗 ${pr.html_url}`,
  });
  console.log('   ✅ Comment posted on Linear ticket');
} catch (err) {
  console.log(`   ⚠️ Could not comment on Linear: ${err.message}`);
}

// ═══════════════════════════════════════════
// Done!
// ═══════════════════════════════════════════
console.log('');
console.log('╔═══════════════════════════════════════════════════╗');
console.log('║              ✅ Pipeline Complete!                 ║');
console.log('╠═══════════════════════════════════════════════════╣');
console.log(`║  PR: ${pr.html_url}`);
console.log(`║  Files: ${aiResponse.changes.length} changed`);
console.log(`║  Branch: ${branchName}`);
console.log('╚═══════════════════════════════════════════════════╝');
