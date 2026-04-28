# Security Policy

This project is currently a private coordination toolkit. Report suspected vulnerabilities privately to the repository maintainers instead of opening public issues.

## Supported Versions

Security fixes are handled on the default branch. Use the latest commit on `main` unless a separate release branch is explicitly documented.

## Reporting a Vulnerability

When reporting a vulnerability, include:

- A short description of the issue and impact.
- Reproduction steps or a minimal proof of concept.
- Affected files, commands, or configuration fields.
- Any known workarounds.

Do not include live credentials, private tokens, production data, or customer data in reports. Use redacted examples whenever possible.

## Local Security Checks

Before publishing or sharing changes, run:

```bash
npm run agents -- secrets-scan --staged --strict
npm run check
npm test
```

The `secrets-scan` command is a guardrail, not a complete security audit. Review command changes manually for file-system writes, shell execution, network access, and disclosure of coordination state.

## Disclosure

Maintainers should acknowledge reports as soon as practical, avoid public disclosure until a fix or mitigation is available, and document user-facing remediation steps when a vulnerability affects published usage.
