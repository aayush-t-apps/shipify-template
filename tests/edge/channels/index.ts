// Every chat channel adapter's fixtures, by its id: the conformance suite refuses an adapter in
// edge/src/channels/index.ts that has none here.
import type { ChannelFixture } from "./fixture.ts";
import { telegram } from "./telegram.ts";
import { web } from "./web.ts";

export const FIXTURES: Record<string, ChannelFixture> = { telegram, web };
