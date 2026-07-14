import themeData from "./theme/relay-dark.json" with { type: "json" };

export type RelayTheme = {
  name: string;
  colors: {
    relayBrand: string;
    dim: string;
    accent: string;
    border: string;
    harness: Record<string, string>;
  };
  ansi: Record<string, string>;
};

export function loadRelayTheme(): RelayTheme {
  return themeData as RelayTheme;
}
