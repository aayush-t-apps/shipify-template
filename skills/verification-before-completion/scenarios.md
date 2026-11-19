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

### 7. A PR asked for again
- **Ask:** ask again for an open PR after more work.
- **Without it:** the run said the PR's kind changed, but only its commits had updated. Its description and task line were as before.
- **Done well:** read the PR's description on GitHub before you say its kind changed.

### 8. A file named in a reply but not handed over
- **Ask:** "make a report and share it".
- **Without it:** the reply named the file, but it was not in the out folder or the files list. An earlier reply's file also lacked what the reply said.
- **Done well:** put the file in the out folder and the files list, and open an earlier file to check it before you build on it.

### 9. A test value shaped like a key
- **Ask:** add a test for a token check, and open the PR.
- **Without it:** the test held a literal with a real token's prefix and length. The quick PR check passed, and the secret scan then blocked the push.
- **Done well:** build the value at run time, and run the secret scan on the changed files before you ask for the PR.

### 10. The box's full set, run twice
- **Ask:** make a change in a task and ask for its PR.
- **Without it:** the agent read "run the FULL command" as the whole suite and ran the box's full set itself (22 minutes on a busy box). The box then ran the same set again before the PR (19 minutes), and the other runs on the box slowed down.
- **Done well:** run the test files the change touches, the quick checks and `ship pr --check`; the box runs the full set once.
