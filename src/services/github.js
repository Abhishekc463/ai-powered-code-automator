import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GitHubService');

let octokit;

function getClient() {
  if (!octokit) {
    octokit = new Octokit({ auth: config.github.token });
  }
  return octokit;
}

const owner = () => config.github.owner;
const repo = () => config.github.repo;

// ═══════════════════════════════════════════
// Repository Operations
// ═══════════════════════════════════════════

/**
 * Check if the target repository exists. If not, create it with a
 * basic Next.js scaffold so the AI has something to work with.
 */
export async function ensureRepoExists() {
  const gh = getClient();
  try {
    await gh.repos.get({ owner: owner(), repo: repo() });
    log.info(`Repository ${owner()}/${repo()} already exists`);
    return false; // already existed
  } catch (err) {
    if (err.status === 404) {
      log.info(`Creating repository ${owner()}/${repo()}...`);
      await gh.repos.createForAuthenticatedUser({
        name: repo(),
        description: 'Next.js app managed by AI PR Pipeline',
        private: false,
        auto_init: true,
      });
      log.info('Repository created — scaffolding Next.js project...');
      return true; // newly created
    }
    throw err;
  }
}

// ═══════════════════════════════════════════
// Branch Operations
// ═══════════════════════════════════════════

/**
 * Get the SHA of the latest commit on the default branch.
 */
export async function getDefaultBranchSHA() {
  const gh = getClient();
  const { data } = await gh.repos.getBranch({
    owner: owner(),
    repo: repo(),
    branch: config.github.defaultBranch,
  });
  return data.commit.sha;
}

/**
 * Create a new branch from the default branch.
 */
export async function createBranch(branchName) {
  const gh = getClient();
  const baseSha = await getDefaultBranchSHA();

  log.info(`Creating branch: ${branchName} from ${config.github.defaultBranch} (${baseSha.slice(0, 7)})`);

  try {
    await gh.git.createRef({
      owner: owner(),
      repo: repo(),
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });
    log.info(`Branch ${branchName} created`);
  } catch (err) {
    if (err.status === 422) {
      log.warn(`Branch ${branchName} already exists — will use it`);
    } else {
      throw err;
    }
  }

  return baseSha;
}

// ═══════════════════════════════════════════
// File Operations
// ═══════════════════════════════════════════

/**
 * Get the full file tree of the repository.
 */
export async function getRepoTree() {
  const gh = getClient();
  const sha = await getDefaultBranchSHA();

  const { data } = await gh.git.getTree({
    owner: owner(),
    repo: repo(),
    tree_sha: sha,
    recursive: 'true',
  });

  return data.tree
    .filter((item) => item.type === 'blob')
    .map((item) => item.path);
}

/**
 * Get the content of a specific file in the repo.
 */
export async function getFileContent(filePath, ref) {
  const gh = getClient();
  try {
    const { data } = await gh.repos.getContent({
      owner: owner(),
      repo: repo(),
      path: filePath,
      ref: ref || config.github.defaultBranch,
    });

    if (data.type === 'file') {
      return {
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        sha: data.sha,
      };
    }
    return null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Get contents of key files to provide context to the AI.
 */
export async function getRepoContext() {
  log.info('Fetching repository context...');
  const tree = await getRepoTree();

  // Key files to include for context
  const contextFiles = [
    'package.json',
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'tsconfig.json',
    'src/app/layout.tsx',
    'src/app/layout.jsx',
    'src/app/page.tsx',
    'src/app/page.jsx',
    'app/layout.tsx',
    'app/page.tsx',
    'src/app/globals.css',
    'app/globals.css',
    'tailwind.config.js',
    'tailwind.config.ts',
    'Dockerfile',
  ];

  const existingContextFiles = contextFiles.filter((f) => tree.includes(f));
  const fileContents = {};

  for (const filePath of existingContextFiles) {
    const result = await getFileContent(filePath);
    if (result) {
      fileContents[filePath] = result.content;
    }
  }

  log.info(`Fetched context: ${Object.keys(fileContents).length} files, ${tree.length} total in tree`);

  return {
    tree,
    fileContents,
  };
}

// ═══════════════════════════════════════════
// Commit Operations (using Git Data API)
// ═══════════════════════════════════════════

/**
 * Apply a set of file changes as a single commit on a branch.
 *
 * @param {string} branchName - The branch to commit to
 * @param {Array<{path: string, action: string, content: string}>} changes - File changes
 * @param {string} commitMessage - Commit message
 */
export async function commitChanges(branchName, changes, commitMessage) {
  const gh = getClient();

  log.info(`Committing ${changes.length} file(s) to ${branchName}`);

  // 1. Get the current commit SHA of the branch
  const { data: refData } = await gh.git.getRef({
    owner: owner(),
    repo: repo(),
    ref: `heads/${branchName}`,
  });
  const currentCommitSha = refData.object.sha;

  // 2. Get the tree SHA of the current commit
  const { data: commitData } = await gh.git.getCommit({
    owner: owner(),
    repo: repo(),
    commit_sha: currentCommitSha,
  });
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for each file change
  const treeItems = [];

  for (const change of changes) {
    if (change.action === 'delete') {
      treeItems.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: null, // null SHA = delete
      });
    } else {
      // Create a blob for the file content
      const { data: blobData } = await gh.git.createBlob({
        owner: owner(),
        repo: repo(),
        content: Buffer.from(change.content).toString('base64'),
        encoding: 'base64',
      });

      treeItems.push({
        path: change.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      });
    }
  }

  // 4. Create a new tree
  const { data: newTree } = await gh.git.createTree({
    owner: owner(),
    repo: repo(),
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // 5. Create a new commit
  const { data: newCommit } = await gh.git.createCommit({
    owner: owner(),
    repo: repo(),
    message: commitMessage,
    tree: newTree.sha,
    parents: [currentCommitSha],
  });

  // 6. Update the branch reference
  await gh.git.updateRef({
    owner: owner(),
    repo: repo(),
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  });

  log.info(`Committed ${changes.length} file(s): ${newCommit.sha.slice(0, 7)}`);
  return newCommit.sha;
}

// ═══════════════════════════════════════════
// Pull Request Operations
// ═══════════════════════════════════════════

/**
 * Check if a PR already exists for the given branch.
 */
export async function findExistingPR(branchName) {
  const gh = getClient();
  const { data: prs } = await gh.pulls.list({
    owner: owner(),
    repo: repo(),
    head: `${owner()}:${branchName}`,
    state: 'open',
  });

  return prs.length > 0 ? prs[0] : null;
}

/**
 * Create a new pull request.
 */
export async function createPullRequest({ title, body, branchName }) {
  const gh = getClient();

  // Check if PR already exists
  const existingPR = await findExistingPR(branchName);
  if (existingPR) {
    log.warn(`PR already exists for branch ${branchName}: #${existingPR.number}`);
    // Update the existing PR body
    await gh.pulls.update({
      owner: owner(),
      repo: repo(),
      pull_number: existingPR.number,
      body,
    });
    return existingPR;
  }

  log.info(`Creating PR: "${title}" (${branchName} → ${config.github.defaultBranch})`);

  const { data: pr } = await gh.pulls.create({
    owner: owner(),
    repo: repo(),
    title,
    body,
    head: branchName,
    base: config.github.defaultBranch,
  });

  log.info(`PR created: #${pr.number} — ${pr.html_url}`);
  return pr;
}

/**
 * Add a comment to a pull request.
 */
export async function commentOnPR(prNumber, body) {
  const gh = getClient();
  await gh.issues.createComment({
    owner: owner(),
    repo: repo(),
    issue_number: prNumber,
    body,
  });
  log.info(`Comment added to PR #${prNumber}`);
}

/**
 * Add labels to a pull request.
 */
export async function addLabelsToPR(prNumber, labels) {
  const gh = getClient();
  try {
    await gh.issues.addLabels({
      owner: owner(),
      repo: repo(),
      issue_number: prNumber,
      labels,
    });
  } catch {
    log.warn('Could not add labels — they may not exist in the repo');
  }
}
