# Scenarios: security-and-hardening

## Loads it
- "add a login callback path to the app"
- "check this upload form for holes"
- "audit the dependencies for risk"

## Not this one
- "make the status page look better" (frontend-design)
- "why did main's CI fail?" (systematic-debugging)
- "write the release notes"

## Cases

### 1. A new path inside a service worker's scope
- **Ask:** "add an API path to the app".
- **Without it:** the path sat inside the service worker's scope, and the worker served it from the cache or the offline page.
- **Done well:** check the worker's scope and fetch handler before you add the path.
