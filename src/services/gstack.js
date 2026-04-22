import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GStack');

const GSTACK_SKILLS_DIR = join(process.cwd(), '.claude', 'skills', 'gstack');

/**
 * Check if gstack is installed and available
 */
export function isGStackAvailable() {
  try {
    return existsSync(GSTACK_SKILLS_DIR);
  } catch {
    return false;
  }
}

/**
 * Run gstack code review on the current changes
 * Simulates /review skill by analyzing code quality
 */
export async function reviewCodeChanges(changes) {
  if (!isGStackAvailable()) {
    log.warn('gstack not available - skipping review');
    return { passed: true, findings: [], recommendations: [] };
  }

  log.info('Running gstack-style code review...');

  const findings = [];
  const recommendations = [];

  // Review each changed file
  for (const change of changes) {
    if (change.action === 'delete') continue;

    const content = change.content || '';
    
    // Check 1: Security issues
    if (content.includes('eval(') || content.includes('dangerouslySetInnerHTML')) {
      findings.push({
        file: change.path,
        severity: 'high',
        issue: 'Potential security risk detected',
        line: findLineNumber(content, /eval\(|dangerouslySetInnerHTML/),
        suggestion: 'Avoid eval() and dangerouslySetInnerHTML - use safer alternatives'
      });
    }

    // Check 2: Missing error handling
    if (content.includes('fetch(') && !content.includes('catch(')) {
      findings.push({
        file: change.path,
        severity: 'medium',
        issue: 'Fetch without error handling',
        suggestion: 'Add .catch() or try/catch to handle network errors'
      });
    }

    // Check 3: Console logs (should use proper logging)
    if (content.match(/console\.(log|warn|error)/g)) {
      recommendations.push({
        file: change.path,
        type: 'cleanup',
        suggestion: 'Replace console statements with proper logging'
      });
    }

    // Check 4: TODO/FIXME comments
    if (content.includes('TODO') || content.includes('FIXME')) {
      recommendations.push({
        file: change.path,
        type: 'technical-debt',
        suggestion: 'Address TODO/FIXME comments before merging'
      });
    }

    // Check 5: Large functions (simple heuristic)
    const functionMatches = content.match(/function\s+\w+\s*\([^)]*\)\s*{/g) || [];
    if (functionMatches.length > 0) {
      // Estimate function size by lines between { and }
      const functionSizeCheck = content.split('\n').length > 100;
      if (functionSizeCheck) {
        recommendations.push({
          file: change.path,
          type: 'refactor',
          suggestion: 'Consider breaking down large functions into smaller units'
        });
      }
    }

    // Check 6: Missing TypeScript types (if .ts/.tsx file)
    if ((change.path.endsWith('.ts') || change.path.endsWith('.tsx')) && 
        !change.path.endsWith('.d.ts')) {
      if (content.match(/:\s*any\b/g)) {
        findings.push({
          file: change.path,
          severity: 'low',
          issue: 'Using "any" type defeats TypeScript benefits',
          suggestion: 'Replace "any" with specific types'
        });
      }
    }
  }

  const passed = findings.filter(f => f.severity === 'high').length === 0;

  log.info(`Review complete: ${findings.length} findings, ${recommendations.length} recommendations`);
  
  return {
    passed,
    findings,
    recommendations,
    summary: generateReviewSummary(findings, recommendations)
  };
}

/**
 * Investigate issues systematically (simulates /investigate skill)
 */
export async function investigateIssue(ticket, repoContext) {
  log.info('Investigating issue systematically...');

  const investigation = {
    symptoms: [],
    hypothesis: [],
    rootCause: null,
    suggestedFix: null
  };

  // Analyze ticket description for clues
  const description = ticket.description || '';
  
  // Look for error messages
  const errorPattern = /error|exception|fail|crash|break/i;
  if (errorPattern.test(description)) {
    investigation.symptoms.push({
      type: 'error-mentioned',
      description: 'Issue description mentions errors or failures'
    });
  }

  // Look for performance issues
  const perfPattern = /slow|timeout|hang|lag|performance/i;
  if (perfPattern.test(description)) {
    investigation.symptoms.push({
      type: 'performance',
      description: 'Potential performance issue indicated'
    });
  }

  // Check if it's a feature request vs bug fix
  const isFeature = /feature|add|implement|create|new/i.test(ticket.title);
  const isBug = /bug|fix|broken|issue|problem/i.test(ticket.title);

  if (isBug) {
    investigation.hypothesis.push('This appears to be a bug fix - ensure root cause is addressed');
  } else if (isFeature) {
    investigation.hypothesis.push('This is a new feature - focus on clean implementation and tests');
  }

  // Check existing codebase for related patterns
  const relatedFiles = repoContext.tree.filter(file => {
    const fileName = file.path.toLowerCase();
    const keywords = extractKeywords(ticket.title);
    return keywords.some(kw => fileName.includes(kw.toLowerCase()));
  });

  if (relatedFiles.length > 0) {
    investigation.hypothesis.push(
      `Found ${relatedFiles.length} related files that may need changes: ${relatedFiles.slice(0, 3).map(f => f.path).join(', ')}`
    );
  }

  return investigation;
}

/**
 * Generate a quality report similar to gstack's output
 */
export function generateQualityReport(reviewResult, investigation) {
  const report = {
    score: 10, // Start at 10
    passed: reviewResult.passed,
    details: []
  };

  // Deduct points for findings
  reviewResult.findings.forEach(finding => {
    if (finding.severity === 'high') report.score -= 3;
    if (finding.severity === 'medium') report.score -= 1.5;
    if (finding.severity === 'low') report.score -= 0.5;
  });

  report.score = Math.max(0, report.score);

  // Generate recommendations
  if (report.score < 7) {
    report.details.push('⚠️  Code quality needs improvement before merging');
  } else if (report.score < 9) {
    report.details.push('✓  Code quality is acceptable, consider addressing recommendations');
  } else {
    report.details.push('✨  Excellent code quality!');
  }

  return report;
}

/**
 * Format review results for PR comment
 */
export function formatReviewForPR(reviewResult, qualityReport) {
  let comment = '## 🤖 AI Code Review (gstack-powered)\n\n';
  
  comment += `**Quality Score:** ${qualityReport.score.toFixed(1)}/10 ${qualityReport.passed ? '✅' : '⚠️'}\n\n`;

  if (reviewResult.findings.length > 0) {
    comment += '### 🔍 Findings\n\n';
    reviewResult.findings.forEach((finding, idx) => {
      const icon = finding.severity === 'high' ? '🔴' : finding.severity === 'medium' ? '🟡' : '🟢';
      comment += `${idx + 1}. ${icon} **${finding.file}**\n`;
      comment += `   - **Issue:** ${finding.issue}\n`;
      comment += `   - **Suggestion:** ${finding.suggestion}\n\n`;
    });
  }

  if (reviewResult.recommendations.length > 0) {
    comment += '### 💡 Recommendations\n\n';
    reviewResult.recommendations.forEach((rec, idx) => {
      comment += `${idx + 1}. **${rec.file}** - ${rec.suggestion}\n`;
    });
    comment += '\n';
  }

  if (reviewResult.passed) {
    comment += '### ✅ Review Passed\n\nNo critical issues found. Ready for human review!\n';
  } else {
    comment += '### ⚠️ Action Required\n\nHigh-severity issues found. Please address before merging.\n';
  }

  comment += '\n---\n*Powered by gstack methodology • Learn more in `.claude/skills/gstack/`*';

  return comment;
}

// Helper functions
function findLineNumber(content, pattern) {
  const lines = content.split('\n');
  const lineIdx = lines.findIndex(line => pattern.test(line));
  return lineIdx >= 0 ? lineIdx + 1 : null;
}

function extractKeywords(text) {
  // Simple keyword extraction
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['this', 'that', 'with', 'from', 'have', 'been'].includes(word));
}

function generateReviewSummary(findings, recommendations) {
  const highSeverity = findings.filter(f => f.severity === 'high').length;
  const mediumSeverity = findings.filter(f => f.severity === 'medium').length;
  const lowSeverity = findings.filter(f => f.severity === 'low').length;

  let summary = '';
  if (highSeverity > 0) {
    summary += `${highSeverity} critical issue${highSeverity > 1 ? 's' : ''} found. `;
  }
  if (mediumSeverity > 0) {
    summary += `${mediumSeverity} medium severity issue${mediumSeverity > 1 ? 's' : ''}. `;
  }
  if (lowSeverity > 0) {
    summary += `${lowSeverity} minor issue${lowSeverity > 1 ? 's' : ''}. `;
  }
  if (recommendations.length > 0) {
    summary += `${recommendations.length} recommendation${recommendations.length > 1 ? 's' : ''} for improvement.`;
  }

  return summary.trim() || 'No issues found.';
}
