# AI Powered Code Automator - Claude Instructions

## Project Overview
This is an AI-powered code automation system that integrates with Linear for issue management, GitHub for repository operations, and Google Cloud Run for deployment. It uses Gemini AI for intelligent code generation and automation.

## gstack Integration

Use gstack tools for development workflow automation. gstack provides a complete sprint workflow: Think → Plan → Build → Review → Test → Ship.

### Core gstack Skills

**Planning & Design:**
- `/office-hours` - Product interrogation with forcing questions (start here for new features)
- `/plan-ceo-review` - Strategic review of feature scope
- `/plan-eng-review` - Architecture, data flow, edge cases review
- `/autoplan` - Run full review pipeline automatically

**Development & Review:**
- `/review` - Code review to find production bugs before they ship
- `/investigate` - Systematic root-cause debugging
- `/codex` - Second opinion from OpenAI Codex

**Testing & QA:**
- `/qa` - Test app in real browser, find bugs, fix them, verify
- `/qa-only` - Test and report bugs without fixing
- `/browse` - Control real Chromium browser for testing

**Security & Quality:**
- `/cso` - OWASP Top 10 + STRIDE security audit

**Deployment:**
- `/ship` - Run tests, audit coverage, push, open PR
- `/land-and-deploy` - Merge PR, wait for CI/deploy, verify production
- `/setup-deploy` - One-time deployment configuration

**Documentation:**
- `/document-release` - Update all docs to match shipped changes
- `/retro` - Weekly engineering retrospective

**Utilities:**
- `/learn` - Manage learned patterns across sessions
- `/gstack-upgrade` - Upgrade gstack to latest version

### Browser Commands

Always use gstack's `/browse` for web testing. Never use mcp__claude-in-chrome__* tools.

### Skill Routing

When the user asks to:
- Start planning a feature → invoke /office-hours
- Review architecture or code → invoke /review
- Test a website or staging URL → invoke /qa
- Run security audit → invoke /cso
- Ship code and open PR → invoke /ship
- Deploy to production → invoke /land-and-deploy
- Update documentation → invoke /document-release
- Debug an issue systematically → invoke /investigate
- Get independent code review → invoke /codex
- Upgrade gstack → invoke /gstack-upgrade

## Project-Specific Context

### Architecture
- **Backend**: Node.js with Express-like routing
- **AI Integration**: Google Gemini API
- **Version Control**: GitHub API integration
- **Issue Tracking**: Linear API integration
- **Deployment**: Google Cloud Run
- **Webhooks**: Linear webhook handling

### Key Files
- `src/index.js` - Main application entry point
- `src/pipeline/orchestrator.js` - Pipeline orchestration logic
- `src/services/` - External service integrations (GitHub, Linear, Gemini, Cloud Run)
- `src/webhooks/linear.js` - Linear webhook handler
- `src/scripts/` - Utility scripts

### Development Workflow
1. Issues come from Linear via webhook or polling
2. Orchestrator processes issues through AI pipeline
3. Gemini generates code solutions
4. GitHub integration manages repositories and PRs
5. Cloud Run handles deployment

### Testing
- Use `/qa` for end-to-end testing with real browser
- Use `/review` before committing changes
- Use `/cso` for security audits

### Deployment
- Configure with `/setup-deploy` first time
- Use `/land-and-deploy` for production deployments
