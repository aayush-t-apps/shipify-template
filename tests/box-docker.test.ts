// A box in Docker (ADR 0056): the image is the box setup.sh makes, its entry point registers once
// then runs the slots, and nothing gives a task the host. Read as text here; the image itself is
// built and checked by the release (ci.yml's image job).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const dockerfile = read("box/Dockerfile");
const entry = read("box/container.sh");
const setup = read("box/setup.sh");
const compose = parse(read("compose.yml")) as {
  services: Record<string, Record<string, unknown>>;
  volumes: Record<string, unknown>;
};

describe("the image (box/Dockerfile)", () => {
  it("is the box setup.sh makes, on Ubuntu 24.04 LTS, under tini, its registration in a volume", () => {
    expect(dockerfile).toMatch(/^FROM ubuntu:24\.04$/m);
    expect(dockerfile).toContain("SHIPIFY_IMAGE=1 bash /opt/shipify/setup.sh");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "/opt/shipify/container.sh"]');
    expect(dockerfile).toContain("VOLUME /home/shipify");
  });

  it("takes only the box's own files: no key, no one's data (.dockerignore)", () => {
    const ignore = read(".dockerignore")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(ignore[0]).toBe("*");
    expect(ignore.slice(1).sort()).toEqual(
      ["!box/container.sh", "!box/here.sh", "!box/prep.tsv", "!box/setup.sh"].sort(),
    );
  });

  it("setup.sh's image stops before anything a box keeps: no SSH, updates, runners or services", () => {
    const stop = setup.indexOf('if [ -n "$IMAGE" ]; then\n  say "The runner\'s libraries"');
    expect(stop).toBeGreaterThan(0);
    expect(setup.indexOf('say "The GitHub runners')).toBeGreaterThan(stop);
    expect(setup.slice(stop, setup.indexOf("fi", stop + 300))).toContain("exit 0");
  });
});

describe("its entry point (box/container.sh)", () => {
  it("registers through here.sh --container, which needs a terminal for your approval", () => {
    expect(entry).toContain('exec bash "$HERE" --container "$@"');
    expect(read("box/here.sh")).toContain("--container) CONTAINER=1 ;;");
  });

  it("unregistered, it waits and says so: --restart never starts it over and over", () => {
    expect(entry).toMatch(/This box isn't registered yet[\s\S]*exec sleep infinity/);
  });

  it("runs each slot as the user shipify, umask 077, as a box's service; one container per volume", () => {
    expect(entry).toContain(
      "umask 077 && exec setpriv --reuid=shipify --regid=shipify --init-groups",
    );
    expect(entry).toContain("./bin/runsvc.sh");
    expect(entry).toContain("flock -n 9");
    // docker stop: each runner asked to cancel its job and stop, as systemd's SIGTERM does.
    expect(entry).toMatch(/trap stop TERM INT/);
    // Never ignored on the way: a runner started with TERM ignored could never hear docker stop.
    expect(entry).not.toMatch(/trap '' TERM/);
  });

  it("is valid bash, and shellcheck-clean where shellcheck is installed", () => {
    expect(spawnSync("bash", ["-n", join(ROOT, "box/container.sh")]).status).toBe(0);
    if (spawnSync("shellcheck", ["--version"]).status === 0)
      expect(spawnSync("shellcheck", [join(ROOT, "box/container.sh")]).status).toBe(0);
  });
});

describe("compose.yml", () => {
  const box = compose.services.box ?? {};
  it("never gives a task the host: no privileged mode, no Docker socket, no added capability", () => {
    const text = read("compose.yml");
    expect(box.privileged).toBeUndefined();
    expect(box.cap_add).toBeUndefined();
    expect(text).not.toContain("docker.sock");
    expect(box.volumes).toEqual(["box:/home/shipify"]);
  });

  it("runs after every reboot, and gives each runner a box's 5 minutes to stop", () => {
    expect(box.restart).toBe("unless-stopped");
    expect(box.stop_grace_period).toBe("5m");
    expect(String(box.image)).toMatch(/shipify-box:latest/);
  });
});
