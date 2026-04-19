import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GeminiService');

/**
 * Generate code changes based on a Linear ticket and the current repo state.
 * Uses OpenRouter (OpenAI-compatible) API with automatic model fallback.
 *
 * @param {Object} ticket - Linear ticket details
 * @param {Object} repoContext - Current repo state (tree + key file contents)
 * @returns {Object} Structured code changes
 */
export async function generateCodeChanges(ticket, repoContext) {
  log.info(`Generating code changes for: ${ticket.identifier} — "${ticket.title}"`);

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(ticket, repoContext);

  const modelsToTry = [
    'google/gemini-flash-1.5',
    'google/gemini-pro-1.5',
    'google/gemini-2.0-flash-001',
    'meta-llama/llama-3.1-70b-instruct'
  ];

  let aiResponse;

  for (const modelId of modelsToTry) {
    try {
      log.info(`Trying model: ${modelId}...`);
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.gemini.apiKey}`,
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
        log.warn(`Model ${modelId} failed (${response.status}): ${errText.substring(0, 100)}...`);
        continue;
      }

      const data = await response.json();
      const aiText = data.choices[0].message.content;

      // Robust JSON cleaning
      let cleanText = aiText.trim();
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }

      try {
        aiResponse = JSON.parse(cleanText);
        log.info(`✅ Success with ${modelId}`);
        break;
      } catch (err) {
        log.warn(`JSON parse failed for ${modelId}, trying repair...`);
        try {
          const repaired = cleanText.replace(/\n/g, '\\n').replace(/\r/g, '\\r');
          aiResponse = JSON.parse(repaired);
          log.info(`✅ Success with ${modelId} (repaired)`);
          break;
        } catch (e) {
          log.warn(`Repair failed for ${modelId}`);
        }
      }
    } catch (err) {
      log.error(`Error with ${modelId}: ${err.message}`);
    }
  }

  if (!aiResponse) {
    throw new Error('All AI models failed. Please check your OpenRouter account.');
  }

  // Validate the response
  if (!aiResponse.changes || !Array.isArray(aiResponse.changes)) {
    throw new Error('AI response missing "changes" array');
  }

  return aiResponse;
}

function buildSystemPrompt() {
  return `You are an expert senior full-stack developer specializing in Next.js 15+, React 19, and TypeScript.
Your job is to implement features and fix bugs in a Next.js web application based on Linear ticket descriptions.

Rules:
1. Generate COMPLETE file contents — never use placeholders.
2. For "update" actions, provide the ENTIRE updated file content.
3. Follow Next.js App Router conventions (app/ directory).
4. Use TypeScript (.tsx/.ts) for all new files.
5. Write production-quality code with proper styling.
6. Use modern React patterns (Server Components by default, "use client" only when needed).
7. Generate conventional commit messages.
8. If the repo is empty/new, scaffold a complete Next.js project structure.
9. Include package.json, next.config.ts, tsconfig.json, src/app/layout.tsx, src/app/globals.css, and the requested page.
10. Use the Next.js standalone output mode in next.config for Docker compatibility.
11. Include a Dockerfile for the Next.js app.

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
}

function buildUserPrompt(ticket, repoContext) {
  const { tree, fileContents } = repoContext;

  let prompt = `## Linear Ticket
**ID**: ${ticket.identifier}
**Title**: ${ticket.title}

**Description**:
${ticket.description || 'No description provided.'}
`;

  prompt += `\n## Current Repository State\n\n`;
  prompt += `### File Tree\n\`\`\`\n${tree.length > 0 ? tree.join('\n') : '(empty repo)'}\n\`\`\`\n\n`;

  if (Object.keys(fileContents).length > 0) {
    prompt += `### Key File Contents\n\n`;
    for (const [filePath, content] of Object.entries(fileContents)) {
      prompt += `#### ${filePath}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    }
  }

  prompt += `\n## Task
Implement the changes described in the Linear ticket. 
Respond ONLY with the JSON object.`;

  return prompt;
}
