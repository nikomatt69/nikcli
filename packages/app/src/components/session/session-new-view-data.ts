export const WORK_SUGGESTIONS = [
  {
    icon: "magnifying-glass",
    title: "Explore the codebase",
    description: "Map the architecture and explain how the important pieces fit together.",
    prompt: "Explore this codebase, map its architecture, and explain how the important pieces fit together.",
  },
  {
    icon: "code",
    title: "Build a feature",
    description: "Turn an idea into production-ready code with tests.",
    prompt:
      "Build a production-ready feature in this project. Start by inspecting the existing patterns and then implement it with tests.",
  },
  {
    icon: "checklist",
    title: "Review the code",
    description: "Find concrete risks and recommend focused improvements.",
    prompt:
      "Review this codebase for correctness, maintainability, and security risks. Prioritize concrete findings and propose focused fixes.",
  },
  {
    icon: "brain",
    title: "Debug a problem",
    description: "Trace a failure to its root cause and fix it.",
    prompt:
      "Investigate the current failures in this project, identify the root cause, and implement and verify the fix.",
  },
] as const
