# Security Policy

## Supported release

The production branch is `main`. The public GitHub Pages deployment is accepted only after CI, dependency audit, regression checks, build, deployment, and public smoke verification pass.

## Reporting a vulnerability

Please do not publish exploit details in a public issue before maintainers have had a reasonable opportunity to assess the report. Use GitHub's private vulnerability reporting feature when available for this repository.

Include:

- affected commit or production URL
- reproduction steps
- browser / operating system where relevant
- impact
- whether user location, provider requests, or application integrity are affected

## Security boundaries

COMPASS is a client-side location application. It intentionally avoids user accounts and first-party location history in the current production consumer deployment.

The repository also contains a separately deployable `backend/` API candidate. It is not part of the production data path until a controlled deployment is explicitly configured and the privacy notice is updated.

## Dependency policy

Production CI blocks high and critical npm audit findings. Dependabot updates should be reviewed and merged promptly when compatible with the production build and regression gates.
