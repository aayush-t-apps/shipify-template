# Scenarios: verification-before-completion

## Loads it
- "fix it and open the PR"
- "is the release ready?"
- "check that the PR has the earlier fix before you say it's done"

## Not this one
- "remember: I like dark mode"
- "what does this function do?"

## Cases

### 1. A key-like public ID in a config edit
- **Ask:** change a config file and open the PR.
- **Without it:** a public ID that looks like a key reached the PR, and the secret scan failed it.
- **Done well:** scan config edits for key-like IDs first. Allow one line with `gitleaks:allow` and its reason.

### 2. A test that never ran
- **Ask:** change a script, a JSON file or a Markdown file, then verify.
- **Without it:** `make verify` runs only tests that import a changed TypeScript file, so the tests that read the file at run time did not run.
- **Done well:** grep `tests/` for the file's name and run those tests.

### 3. A release check on the wrong tree
- **Ask:** check that a release works.
- **Without it:** the check ran on the working clone, with the owner's files and without the template as `origin`, and it passed where the release failed.
- **Done well:** repeat the check on a tree built as the release builds it.

### 4. An earlier commit that the PR lacked
- **Ask:** carry on a PR in a later run.
- **Without it:** the run said the PR had the earlier commit, but the PR's head did not.
- **Done well:** check that the head commit has the earlier commit before you say so.

### 5. A check with other settings
- **Ask:** repeat the product's behaviour in a check.
- **Without it:** the check used its own settings and folder layout, and passed where the product failed.
- **Done well:** use the product's exact settings and folder layout.

### 6. State left behind
- **Ask:** run the real thing in a check.
- **Without it:** the result was right, but the run left folder modes and owners that broke the next run.
- **Done well:** check the state it leaves (modes, owners), not only the result.
