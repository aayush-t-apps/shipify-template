# Scenarios: systematic-debugging

## Loads it
- "the tests fail and I don't know why"
- "the run lost communication, fix it"

## Not this one
- "remember: I like dark mode"
- "add a button to the page"

## Cases

### 1. A box reset read as a code bug
- **Ask:** a self-hosted run lost communication; find out why.
- **Without it:** the agent searched the code for the cause, but the box had reset.
- **Done well:** check the box's uptime and reset cause (on a Pi, the bootloader `rsts` value) before you suspect the code.

### 2. A key that never arrived
- **Ask:** a tool's key "looks wrong"; find out why.
- **Without it:** the agent blamed the setting and changed it, but the tool's process had received a placeholder.
- **Done well:** check the value the tool's process received first. A placeholder like `${NAME}` means the key never reached it.

### 3. A generic error guessed at
- **Ask:** a page shows a generic error, a list is empty, a screenshot differs, or a check fails only in CI.
- **Without it:** the agent guessed at the code. The cause was in the browser console, a GET with a body, a stale client, or the runner's image.
- **Done well:** read the console, watch the network, check the client's version, compare runner images and reproduce in a container.

### 4. A fix that covered one caller
- **Ask:** fix a failing step that many paths share.
- **Without it:** the fix covered one caller and passed one check. Other callers and checks on the path still failed. A stale output file also passed as the result.
- **Done well:** find every caller, run the fix through every check on its path, and remove the old output file before a step that may not write.

### 5. A generic OS error
- **Ask:** a command fails with a generic OS error.
- **Without it:** the agent guessed at the cause from the message.
- **Done well:** read the vendor's source for what raises it.
