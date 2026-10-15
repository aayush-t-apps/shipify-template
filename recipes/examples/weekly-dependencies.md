---
when: every Monday at 9
---
Look through each project's dependencies (its package.json, or whatever its stack uses) and list
what's outdated: the package, the version in use and the newest, with a one-line note when the
newest is a major version. Change nothing and ask for no PR: the list is the answer. If everything
is current, finish quiet.
