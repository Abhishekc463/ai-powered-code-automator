# gstack Integration

This project uses [gstack](https://github.com/garrytan/gstack) to enhance the AI code generation pipeline with professional-grade code review, testing, and quality assurance.

## What is gstack?

gstack is Garry Tan's open-source software factory that turns Claude Code into a virtual engineering team with 23+ specialized skills:

- **CEO** - Strategic product review
- **Eng Manager** - Architecture validation  
- **Designer** - Visual consistency checks
- **QA Lead** - Automated testing
- **Security Officer** - OWASP + STRIDE audits
- **Release Engineer** - Automated shipping

## How It Works in This Project

The orchestrator automatically integrates gstack skills into the pipeline:

### Pipeline Flow (with gstack)

```
1. Fetch Linear ticket
2. Prepare repo context
   └→ 2.5. 🔍 Investigate issue (gstack methodology)
3. Generate code with Gemini AI
   └→ 3.5. 📋 Code Review (gstack quality checks)
4. Create PR with quality labels
5. Deploy preview
6. Done ✅
```

### Automatic Code Reviews

When gstack is installed, every AI-generated PR gets:

**✅ Security Checks**
- Dangerous eval() usage
- XSS vulnerabilities
- SQL injection risks

**✅ Code Quality**
- Error handling validation
- TypeScript type safety
- Function complexity analysis

**✅ Best Practices**
- Console statement detection
- TODO/FIXME tracking
- Code smell identification

### Quality Scoring

Each PR receives a **0-10 quality score**:

- `9-10` ✨ Excellent - Ready to ship
- `7-8.9` ✓ Good - Minor improvements suggested
- `<7` ⚠️ Needs work - Address issues before merging

## Installation

gstack is already installed in this repository at:
```
.claude/skills/gstack/
```

## Usage

The integration is automatic! When you trigger the pipeline:

```bash
# Pipeline runs with gstack checks enabled
npm start
```

The orchestrator will:
1. Detect gstack installation
2. Run systematic investigation
3. Generate code with AI
4. Review code quality
5. Post findings to PR
6. Label PR based on quality

## Manual gstack Skills

You can also use gstack skills manually:

```bash
# Code review
/review

# Security audit  
/cso

# Test and fix bugs
/qa

# Ship with tests
/ship

# Weekly retro
/retro
```

See [.claude/skills/gstack/README.md](.claude/skills/gstack/README.md) for all 23 skills.

## PR Review Example

When gstack reviews code, it posts a comment like this:

```markdown
## 🤖 AI Code Review (gstack-powered)

**Quality Score:** 8.5/10 ✅

### 🔍 Findings

1. 🟡 **src/components/Button.tsx**
   - **Issue:** Fetch without error handling
   - **Suggestion:** Add .catch() or try/catch to handle network errors

### 💡 Recommendations

1. **src/utils/api.ts** - Replace console statements with proper logging

### ✅ Review Passed

No critical issues found. Ready for human review!

---
*Powered by gstack methodology*
```

## Configuration

gstack integration is enabled by default when the `.claude/skills/gstack/` directory exists.

To disable gstack checks, remove or rename the directory:
```bash
mv .claude/skills/gstack .claude/skills/gstack.disabled
```

## Benefits

**For AI Agents:**
- Systematic investigation methodology
- Code quality validation before commit
- Security vulnerability detection
- Best practices enforcement

**For Developers:**
- Higher quality AI-generated code
- Fewer bugs in production
- Clearer PR reviews
- Faster code review cycles

**For Teams:**
- Consistent code standards
- Automated security audits
- Technical debt tracking
- Quality metrics over time

## Learn More

- [gstack GitHub](https://github.com/garrytan/gstack)
- [gstack Skills Documentation](.claude/skills/gstack/docs/skills.md)
- [CLAUDE.md](../CLAUDE.md) - Project-specific AI instructions

## Contributing

To enhance the gstack integration:

1. Edit `src/services/gstack.js` - Core integration logic
2. Update `src/pipeline/orchestrator.js` - Pipeline integration
3. Test with a real Linear ticket
4. Submit PR with quality score!

---

**gstack Version:** v1.5.2.0  
**License:** MIT  
**Author:** Garry Tan (@garrytan)
