import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GeminiService');

let genAI;
let model;

function getModel() {
  if (!model) {
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    model = genAI.getGenerativeModel({
      model: config.gemini.model,
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            summary: {
              type: SchemaType.STRING,
              description: 'A concise summary of the changes being made',
            },
            changes: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  path: {
                    type: SchemaType.STRING,
                    description: 'File path relative to the project root',
                  },
                  action: {
                    type: SchemaType.STRING,
                    description: 'One of: create, update, delete',
                    enum: ['create', 'update', 'delete'],
                  },
                  content: {
                    type: SchemaType.STRING,
                    description: 'Full file content (for create/update actions)',
                  },
                  reason: {
                    type: SchemaType.STRING,
                    description: 'Why this file is being changed',
                  },
                },
                required: ['path', 'action', 'reason'],
              },
            },
            commitMessage: {
              type: SchemaType.STRING,
              description: 'A conventional commit message for these changes',
            },
            prTitle: {
              type: SchemaType.STRING,
              description: 'A clear PR title',
            },
          },
          required: ['summary', 'changes', 'commitMessage', 'prTitle'],
        },
      },
    });
  }
  return model;
}

/**
 * Generate code changes based on a Linear ticket and the current repo state.
 *
 * @param {Object} ticket - Linear ticket details
 * @param {Object} repoContext - Current repo state (tree + key file contents)
 * @returns {Object} Structured code changes
 */
export async function generateCodeChanges(ticket, repoContext) {
  log.info(`Generating code changes for: ${ticket.identifier} — "${ticket.title}"`);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(ticket, repoContext);

  const aiModel = getModel();

  const chat = aiModel.startChat({
    systemInstruction: systemPrompt,
  });

  log.info('Sending request to Gemini...');
  const result = await chat.sendMessage(userPrompt);
  const response = result.response;
  const text = response.text();

  log.debug('Raw Gemini response length:', { length: text.length });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.error('Failed to parse Gemini response as JSON', { error: err.message });
    throw new Error('Gemini returned invalid JSON');
  }

  // Validate the response
  if (!parsed.changes || !Array.isArray(parsed.changes)) {
    throw new Error('Gemini response missing "changes" array');
  }

  log.info(`Gemini generated ${parsed.changes.length} file change(s): ${parsed.summary}`);

  return parsed;
}

function buildSystemPrompt() {
  return `You are an expert senior full-stack developer specializing in Next.js 15+, React 19, and TypeScript.

Your job is to implement features and fix bugs in a Next.js web application based on Linear ticket descriptions.

## Rules
1. Generate COMPLETE file contents — never use placeholders like "// ... rest of the code" or "/* existing code */".
2. For "update" actions, provide the ENTIRE updated file content, not just the diff.
3. Follow Next.js App Router conventions (app/ directory, page.tsx, layout.tsx, etc.).
4. Use TypeScript (.tsx/.ts) for all new files.
5. Write clean, production-quality code with proper error handling.
6. Include necessary imports and type definitions.
7. If adding a new page, also update navigation if applicable.
8. Use modern React patterns (Server Components by default, "use client" only when needed).
9. Ensure all code is properly formatted and follows best practices.
10. If the ticket is ambiguous, make reasonable assumptions and document them in the PR title/summary.
11. Do NOT modify package.json unless absolutely necessary (e.g., new dependencies are needed).
12. If you need to add a dependency, create an "update" action for package.json with the full updated content.
13. Generate semantic, conventional commit messages (e.g., "feat: add user profile page").
14. Use Tailwind CSS if it's already configured in the project, otherwise use CSS modules.

## File Structure Conventions
- Pages go in src/app/ or app/
- Components go in src/components/
- Utilities go in src/lib/ or src/utils/
- Types go in src/types/
- API routes go in src/app/api/`;
}

function buildUserPrompt(ticket, repoContext) {
  const { tree, fileContents } = repoContext;

  let prompt = `## Linear Ticket

**ID**: ${ticket.identifier}
**Title**: ${ticket.title}
**Priority**: ${ticket.priorityLabel || 'None'}

**Description**:
${ticket.description || 'No description provided.'}
`;

  if (ticket.comments && ticket.comments.length > 0) {
    prompt += `\n**Additional context from comments**:\n`;
    ticket.comments.forEach((comment, i) => {
      prompt += `- Comment ${i + 1}: ${comment}\n`;
    });
  }

  prompt += `\n## Current Repository State\n\n`;
  prompt += `### File Tree\n\`\`\`\n${tree.join('\n')}\n\`\`\`\n\n`;

  if (Object.keys(fileContents).length > 0) {
    prompt += `### Key File Contents\n\n`;
    for (const [filePath, content] of Object.entries(fileContents)) {
      prompt += `#### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    }
  }

  prompt += `\n## Task
Implement the changes described in the Linear ticket above. Analyze the current codebase structure and generate the necessary file changes.

Return a JSON object with:
- "summary": Brief summary of what you changed
- "changes": Array of file changes (each with path, action, content, reason)
- "commitMessage": A conventional commit message
- "prTitle": A clear PR title`;

  return prompt;
}
