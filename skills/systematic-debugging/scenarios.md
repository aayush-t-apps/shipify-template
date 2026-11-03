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
