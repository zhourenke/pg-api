# Security Policy

This repository is a personal, single-maintainer downstream fork of
[new-api](https://github.com/QuantumNous/new-api). It is not the upstream project and it
is not a distribution or support channel for it.

## Reporting a vulnerability

This fork has no security advisories channel, no issue tracker and no pull request flow,
and it runs no response desk: there is no acknowledgement window, no disclosure timeline
and no credit programme. Do not open a draft security advisory, an issue or a pull
request against this repository, and do not use the upstream project's addresses for a
report about this fork.

If a vulnerability affects this fork:

- fix it here and commit it to `main`, or
- send the details directly to the repository owner.

If a vulnerability affects the upstream project, report it to
[upstream](https://github.com/QuantumNous/new-api/security/policy) under upstream's own
policy. Upstream's handling, timelines and credit do not apply to this fork.

## Supported versions

Only the current state of `main`, and the newest build taken from it, are in scope. This
fork makes no backport or long-term-support commitment.

| Version                  | Supported          |
| ------------------------ | ------------------ |
| Newest build from `main` | :white_check_mark: |
| Anything older           | :x:                |

## Deploying this fork

The advice below is about self-hosting the software, not about this repository's
process.

### Deployment

- Serve the console and the API over HTTPS only.
- Open the minimum set of ports, and keep the management interface off the public internet.
- Track `main` and rebuild to pick up fixes.
- Use separate database and Redis instances in production.

### API keys

- Never place keys in client-side code or in a public repository.
- Issue one key per purpose and follow least privilege.
- Rotate keys on a schedule.
- Watch key usage for anomalies.

### Database

- Use strong, unique credentials for the database user.
- Do not expose the database port publicly.
- Take regular backups and verify that they restore.
- Grant the database user only the privileges it needs.

### Configuration

- `SESSION_SECRET` — a long random value.
- `SQL_DSN` — a connection string that does not leak credentials.
- `REDIS_CONN_STRING` — TLS where the network is not trusted.

## Disclaimer

This software is provided "as is", without warranty of any kind. Assess the security of
your own deployment.
