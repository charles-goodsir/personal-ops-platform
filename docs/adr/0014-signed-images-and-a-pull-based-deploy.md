# 14. Signed images and a pull-based deploy

Status: accepted

## Context

Until now a deploy meant me running `git pull`, `docker compose build` and `up -d` on the mini PC. That builds whatever is on `main` on the box itself, so nothing checks that the image is the one CI tested, and nothing scans it. The repo is public, so a pull request can come from anyone, and a dependency or base image can be compromised without my code changing. I wanted three things: to know a dependency problem when it appears, to deploy only an image that my own workflow built and scanned, and for the box to recover by itself if a new image does not stay up.

## Decision

- **A dependency audit as its own workflow.** `pnpm audit --prod --audit-level=high` runs on every pull request and push, and weekly, because a quiet repo gets no pull requests and would never notice a new advisory. It is separate from the required check, so an npm registry outage cannot block a merge.
- **Dependabot version updates, with a cooldown.** Weekly for npm, GitHub Actions, the Dockerfile and the compose file. A release less than 7 days old is not taken, because a compromised release is usually found within days. I merge every update myself. Three ignore rules keep it on what I run: no major `@types/node` (the runtime is Node 24), no major `node` image (24 is the long term support line), and no major or minor `ollama` image (it is before 1.0 and CI never runs it).
- **A release workflow that builds, scans, pushes and signs.** On `main` only, never on a pull request. It builds the image, scans it with Trivy (a high or critical finding that has a fix stops the release), pushes `sha-<commit>` and `main` to GHCR, signs the digest with cosign keyless (the certificate names this workflow on `main`, so no key is stored) and verifies its own signature with the check the box will make. It uses no third party actions: Trivy and cosign are downloaded at pinned versions and checked against a pinned checksum, as the gitleaks step already was.
- **The box pulls; nothing pushes to it.** `scripts/update.sh` runs nightly from a systemd timer at 03:30 NZ, after the 03:00 backup. It reads the digest of `main`, verifies the signature against this repo's release workflow on `main`, and does so by digest, so the bytes that were verified are the bytes that are pulled. It tags the image as `personal-ops:local` (compose is unchanged), keeps the one that was running as `personal-ops:previous`, runs `docker compose up -d`, and waits for every service to stay up for 60 seconds with no restart loop. If they do not, it puts the previous image back, marks the digest as rejected and skips it until a newer one appears.
- **Every outcome is visible.** The updater records an `image-update` heartbeat that `/status` and the watchdog use (26 hour limit), and sends one Telegram message with a short digest and no log text. A refused signature, a failed update and a rollback all send one.
- **No self-hosted runner on a public repo.** A pull request from anyone could then run code on the box.

## Alternatives I did not take

- **Auto-merging Dependabot.** CI passing says the code builds, not that a release is safe. One of the updates I looked at described an upstream compromise that was reverted before publishing. I want to read each one.
- **A push deploy from CI over SSH.** It needs a deploy key that can run commands on the box, held by a CI system that runs code from pull requests.
- **Watchtower or another auto-updater.** It follows a tag and does not check who built the image.
- **GitHub's build attestations and `gh attestation verify`.** It needs the gh CLI signed in on the box. Cosign verifies from public data.
- **A key pair for signing.** A key is a secret to store and rotate. Keyless signing ties the signature to the workflow's identity.

## Consequences

- **The database is not rolled back.** A migration that has run stays, so a migration has to work with the release before it. The 03:00 backup is the way back for data.
- **Someone who can repoint the `main` tag at an older signed image could roll the box back.** GHCR write access is limited to the workflow, and I accepted the rest.
- **The updater runs as a user in the docker group, which is root-equivalent.** The box is trusted not to be the thing that is attacked from outside, and it makes only outbound calls.
- **A signature proves where an image came from, not that the code is safe.** A malicious dependency that is not in an advisory database yet can pass the audit, the scan and the cooldown.
- **The image now differs from its base.** The final stage removes npm, npx and corepack (nothing runs them, and the copies in the base image carried seven high advisories) and upgrades `perl-base` to the Debian fix that the newest `node:24-slim` did not have. The build is no longer exactly the base image's.
- **Cosign is installed on the box by hand,** at the version CI uses.
- The [threat model](../threat-model.md) has a new section F, with the results in [security testing](../security-testing.md).
