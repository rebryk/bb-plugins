export const experimentalSettings = {
  threadEta: {
    type: "boolean",
    label: "Thread ETA",
    description: "An agent's estimate of the time left counts down on its thread in the sidebar.",
    default: true,
  },
  threadPrefetch: {
    type: "boolean",
    label: "Preload Threads",
    description: "Preload the latest part of recent and newly completed threads.",
    default: true,
  },
} as const;
