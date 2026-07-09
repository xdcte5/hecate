export function gateProFeature(feature: string, enabled: boolean): never | void {
  if (!enabled) return;
  console.error("");
  console.error(`Relay Pro — ${feature}`);
  console.error("This feature is coming in v0.2 (Pro tier, $19/mo).");
  console.error("OSS routing remains fully deterministic via relay handoff --to auto.");
  console.error("");
  process.exit(1);
}
