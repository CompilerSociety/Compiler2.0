# Deployment

Vercel serves root API functions from `api/`. Browser assets are physically stored under `web/` and exposed through `vercel.json` rewrites. GitHub Actions generates DB files and requires repository secrets; `service-account.json` is reconstructed only at workflow runtime.
