export type Tab = "media" | "albums" | "location" | "sets";

export type TabSelection = { count: number; label: string };

export type SelectionTab = { submitSelection: () => void };
