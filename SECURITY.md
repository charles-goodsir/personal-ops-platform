# Security policy

This is a personal project that runs on my own home network, so there is no hosted service to attack and no customer data. If you find a problem in the code, such as a way around the bot's allowlist, an MCP auth bypass, or a secret committed by mistake, I want to hear about it.

## Reporting

Use GitHub's private vulnerability reporting: open the **Security** tab of this repo and choose **Report a vulnerability**. Please do not open a public issue for a vulnerability.

I will read reports on a best-effort basis and reply when I can. This is a one-person learning project, so I cannot promise a response time.

## Scope

- The code and configuration in this repo.
- Please do not scan, probe or send traffic to my home network or accounts. A report that needs the running system should describe the steps and let me reproduce them myself.

## Supported versions

Only the current `main` branch.

## Repo protections

Changes to `main` go through a pull request that must pass CI, and force pushes and deletion are blocked. Secret scanning with push protection and Dependabot alerts are on. See the [risk assessment](RISK_ASSESSMENT.md) for what is protected and what I have accepted.
