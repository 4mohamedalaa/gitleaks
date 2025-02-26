# GitLeaks Security Scanning and Remediation Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [GitLeaks Overview](#gitleaks-overview)
3. [Setup and Configuration](#setup-and-configuration)
4. [GitHub Actions Workflow](#github-actions-workflow)
5. [Secret Detection Rules](#secret-detection-rules)
6. [Remediation Process](#remediation-process)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)
9. [References](#references)

## Introduction

This documentation outlines our approach to detecting and remediating secrets in our codebase using GitLeaks, an open-source tool designed to scan repositories for secrets and sensitive information.

**Purpose**: To prevent the accidental exposure of credentials, API keys, and other sensitive information in our source code repositories.

## GitLeaks Overview

GitLeaks is a SAST (Static Application Security Testing) tool that uses pattern matching and entropy analysis to detect secrets in repositories. It can:

- Scan the current state of a repository
- Scan the entire commit history
- Detect a wide range of credentials, including API keys, passwords, tokens, etc.
- Generate reports in various formats (JSON, CSV, SARIF)
- Be integrated into CI/CD pipelines

## Setup and Configuration

### Prerequisites

- Git repository
- GitHub Actions (for CI/CD integration)
- Access to GitHub repository settings

### Installation

#### Local Installation

```bash
# Linux/macOS
wget https://github.com/zricethezav/gitleaks/releases/download/v8.16.1/gitleaks_8.16.1_linux_x64.tar.gz
tar -xzf gitleaks_8.16.1_linux_x64.tar.gz
sudo mv gitleaks /usr/local/bin/

# Windows
# Download from https://github.com/zricethezav/gitleaks/releases
# Extract and add to PATH
```

#### Pre-commit Hook Setup

```bash
# Install pre-commit
pip install pre-commit

# Create configuration file
cat > .pre-commit-config.yaml << 'EOL'
repos:
- repo: https://github.com/zricethezav/gitleaks
  rev: v8.16.1
  hooks:
  - id: gitleaks
EOL

# Install the hooks
pre-commit install
```

### Configuration

Create a `.gitleaks.toml` file in your repository root to customize detection rules:

```toml
# Example .gitleaks.toml configuration
[allowlist]
description = "Allowlisted files"
paths = [
    '''go\.sum$''',
    '''package-lock\.json$''',
    '''yarn\.lock$''',
]

# Add custom rules as needed
# See https://github.com/zricethezav/gitleaks#configuration for details
```

## GitHub Actions Workflow

We use GitHub Actions to automate the scanning process. Below is our workflow configuration:

```yaml
name: GitLeaks Secret Scanner

on:
  push:
    branches: [ main, master, develop ]
  pull_request:
    branches: [ main, master, develop ]
  schedule:
    - cron: '0 0 * * *'  # Run daily at midnight
  workflow_dispatch:     # Allow manual triggers

jobs:
  scan:
    name: GitLeaks Security Scan
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: write

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Install Gitleaks
        run: |
          wget https://github.com/zricethezav/gitleaks/releases/download/v8.16.1/gitleaks_8.16.1_linux_x64.tar.gz
          tar -xzf gitleaks_8.16.1_linux_x64.tar.gz
          sudo mv gitleaks /usr/local/bin/

      - name: Run Gitleaks
        id: gitleaks
        run: |
          # Run gitleaks and output to text file
          gitleaks detect -v --source . > scan_output.txt || true
          
          # Check if leaks were found
          if grep -q "Finding:" scan_output.txt; then
            echo "::set-output name=leaks_found::true"
            echo "Secrets detected in the repository!"
            cat scan_output.txt
            exit 1
          else
            echo "No secrets detected!"
          fi

      - name: Create Issue on Failure
        if: failure() && steps.gitleaks.outputs.leaks_found == 'true'
        uses: actions/github-script@v7
        with:
          github-token: ${{ secrets.GIT_ACTION_TOKEN }}
          script: |
            const fs = require('fs');
            
            let findings = '';
            if (fs.existsSync('scan_output.txt')) {
              findings = fs.readFileSync('scan_output.txt', 'utf8').substring(0, 2000) + 
                         (fs.readFileSync('scan_output.txt', 'utf8').length > 2000 ? 
                          '\n\n... output truncated, see workflow artifacts for complete results ...' : '');
            }
            
            const issueBody = `## 🚨 Security Issue: Secrets detected in repository
            
            GitLeaks has detected secrets in the codebase that need to be addressed immediately.
            
            **Details:**
            - Commit: ${context.sha}
            - Branch: ${context.ref}
            - Workflow: ${process.env.GITHUB_SERVER_URL}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}
            
            ### Detected Secrets (partial list):
            \`\`\`
            ${findings}
            \`\`\`
            
            ### Required Actions:
            
            1. **Remove the secrets from your code**
               - Replace hardcoded credentials with environment variables
               - Ensure all files with secrets are removed

            2. **Remove secrets from git history**
               \`\`\`bash
               # For specific files:
               git filter-branch --force --index-filter "git rm --cached --ignore-unmatch PATH_TO_FILE" --prune-empty --tag-name-filter cat -- --all
               git push origin --force --all
               \`\`\`
               
            3. **Rotate all compromised credentials**
               - Change all passwords that were exposed
               - Revoke and regenerate all API keys and tokens
               
            4. **Implement proper secret management**
               - Use GitHub Secrets for workflow credentials
               - Use environment variables in your applications
               - Consider using a secret management tool
            
            Please address this issue immediately to prevent unauthorized access to your systems.`;
            
            // Check if there's already an open issue for this
            const openIssues = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              labels: ['security', 'gitleaks']
            });
            
            if (openIssues.data.length === 0) {
              await github.rest.issues.create({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title: '🚨 Security Issue: Secrets Found in Repository',
                body: issueBody,
                labels: ['security', 'gitleaks']
              });
            } else {
              console.log("An open GitLeaks issue already exists, not creating a duplicate");
            }

      - name: Save Scan Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: gitleaks-scan-results
          path: scan_output.txt
          retention-days: 30
          
      - name: Notify on Success
        if: success()
        run: |
          echo "✅ GitLeaks scan completed successfully with no secrets detected!"
```

### Workflow Explanation

- **Triggers**: Runs on pushes to main branches, pull requests, daily at midnight, and can be manually triggered
- **Checkout**: Gets the full repository history for scanning
- **Installation**: Installs GitLeaks
- **Scanning**: Runs GitLeaks and captures the output
- **Issue Creation**: Creates a GitHub issue when secrets are found
- **Artifact Upload**: Saves scan results as an artifact for later analysis
- **Success Notification**: Confirms when no secrets are found

## Secret Detection Rules

GitLeaks detects various types of secrets, including:

| Type | Description | Example Pattern |
|------|-------------|----------------|
| AWS Keys | Amazon Web Services access keys | `AKIA[0-9A-Z]{16}` |
| GitHub Tokens | GitHub personal access tokens | `ghp_[a-zA-Z0-9]{36}` |
| Google API Keys | Google Cloud API keys | `AIza[0-9A-Za-z\\-_]{35}` |
| JWT Tokens | JSON Web Tokens | `eyJ[a-zA-Z0-9]{8,}\.eyJ[a-zA-Z0-9]{8,}` |
| Private Keys | SSH or RSA private keys | `-----BEGIN.*PRIVATE KEY-----` |
| Database URLs | Database connection strings | `postgres://.*:.*@.*:.*\/.*` |
| Password in Code | Hardcoded passwords | `password\s*=\s*['"][^'"]{3,}['"]` |

## Remediation Process

When secrets are detected, follow this remediation process:

### 1. Immediate Assessment

- Review the GitLeaks findings to understand what was exposed
- Determine the scope and potential impact
- Notify the security team if required

### 2. Remove Secrets from Current Codebase

```bash
# Remove or update the affected files
git rm secrets.txt
# OR
# Edit the file to remove secrets and use environment variables instead
git add [affected-files]
git commit -m "Remove hardcoded secrets"
git push
```

### 3. Clean Git History

To completely remove secrets from git history:

```bash
# For specific files
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch PATH_TO_FILE" \
  --prune-empty --tag-name-filter cat -- --all

# Force push the changes
git push origin --force --all
```

### 4. Rotate Compromised Credentials

For each type of exposed credential:

#### AWS Credentials
- Go to AWS IAM Console
- Disable the exposed access keys
- Create new access keys
- Update applications with new keys

#### GitHub Tokens
- Go to GitHub Settings → Developer settings → Personal access tokens
- Delete the exposed token
- Generate a new token with appropriate permissions
- Update any applications/scripts using the token

#### Database Credentials
- Access your database management system
- Update user passwords
- Update connection strings in your applications

#### API Keys (Google, etc.)
- Go to the relevant platform's developer console
- Revoke the exposed API key
- Generate a new key with proper restrictions
- Update applications with the new key

#### Private Keys
- Generate new key pairs
- Replace the old keys everywhere they're used
- Revoke old certificates if applicable

### 5. Implement Secret Management

Replace hardcoded secrets with environment variables or a secrets management solution:

```python
# Python example
import os
api_key = os.environ.get("API_KEY")
```

```javascript
// JavaScript example
const apiKey = process.env.API_KEY;
```

For GitHub Actions, use repository secrets:

```yaml
steps:
  - name: Use secret
    env:
      API_KEY: ${{ secrets.API_KEY }}
    run: |
      # Your code here
```

## Best Practices

### Prevention

1. **Never commit secrets**: Use environment variables or secret management solutions
2. **Use .gitignore**: Add patterns to exclude sensitive files
3. **Use pre-commit hooks**: Set up GitLeaks as a pre-commit hook
4. **Educate team members**: Train all developers on secure coding practices

### Configuration

1. **Custom rules**: Add organization-specific patterns to detect
2. **Allowlists**: Configure exceptions for known false positives
3. **Regular updates**: Keep GitLeaks and rules up-to-date

### Monitoring

1. **Regular scanning**: Run scans on a schedule (daily or weekly)
2. **PR checks**: Block PRs that introduce secrets
3. **Audit logs**: Keep records of scan results

## Troubleshooting

### Common Issues

1. **False positives**: High-entropy strings that aren't actually secrets
   - Solution: Add to allowlist in `.gitleaks.toml`

2. **Scan takes too long**: Large repositories can take a long time to scan
   - Solution: Use depth-limited scans for regular checks, full scans less frequently

3. **SARIF upload issues**: SARIF format validation errors
   - Solution: Use simpler output formats or fix region data in the SARIF output

4. **GitHub token permissions**: Issues creating GitHub issues automatically
   - Solution: Ensure the GitHub token has the right permissions (issues:write)

## References

- [GitLeaks GitHub Repository](https://github.com/zricethezav/gitleaks)
- [GitLeaks Documentation](https://github.com/zricethezav/gitleaks/wiki)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [OWASP Secret Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Git Filter-Branch Documentation](https://git-scm.com/docs/git-filter-branch)