export type GoalMode = "build" | "chat" | "fix" | "test" | "review" | "refactor";

export type GoalAnalysis = {
  mode: GoalMode;
  layers: { frontend: boolean; backend: boolean };
  /** User explicitly asked for tests in the goal. */
  wantsTests: boolean;
  /** User explicitly asked for review or architecture work. */
  wantsReview: boolean;
};

const TEST_WORDS = /\b(test|tests|vitest|jest|mocha|coverage|tdd|unit test)\b/i;
const REVIEW_WORDS = /\b(review|audit|architecture|risk|assess)\b/i;
const REFACTOR_WORDS = /\b(refactor|restructure|migrate|redesign)\b/i;
const SECURITY_WORDS = /\b(security|vulnerability|cve|pentest|secure|hardening)\b/i;

/** Single-file / simple-script goals that need only one implement step. */
const TRIVIAL_SCRIPT_FILE =
  /\b(?:create|write|make|add)\s+(?:a\s+)?[\w.-]+\.(?:sh|bash|zsh|py)\b/i;
const TRIVIAL_ONE_FILE_FIX =
  /\b(?:fix|update|edit|change|patch)\b(?:\s+\w+){0,4}\s+(?:\w+\/)*[\w.-]+\.\w{1,8}\b/i;
const TRIVIAL_ONE_FUNCTION =
  /\b(?:add|create|write|implement)\s+(?:a\s+)?(?:single\s+)?function\b/i;
const TRIVIAL_SIMPLE_SCRIPT = /\b(?:simple|small|quick|tiny)\s+(?:shell\s+)?script\b/i;
const TRIVIAL_HELLO_SH = /\bhello\.sh\b/i;
const FIX_WORDS = /\b(fix|debug|bug|broken|error|issue|repair|patch|troubleshoot)\b/i;
const BUILD_WORDS = /\b(build|create|add|implement|make|design|scaffold|setup|set up)\b/i;
const CHAT_GREETINGS = /^(?:hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice)[!.?]*$/i;
const CHAT_QUESTIONS =
  /^(?:what|why|how|when|where|who|can you explain|tell me|show me)\b/i;

const FRONTEND_WORDS =
  /\b(page|ui|frontend|component|button|screen|view|layout|css|tailwind|react|vue|website|site|portfolio|graph|chart|visualization|social|landing|navbar|hero)\b/i;
const AUTH_WORDS = /\b(auth|authentication|oauth|jwt|session management)\b/i;
const BACKEND_WORDS =
  /\b(api|backend|server|database|endpoint|route|middleware|jwt|session|oauth|graphql|postgres|mysql)\b/i;

/** Classify a natural-language goal — drives which steps exist, not which agent runs them. */
export function analyzeGoal(goal: string): GoalAnalysis {
  const trimmed = goal.trim();
  const wantsTests = TEST_WORDS.test(trimmed);
  const wantsReview =
    REVIEW_WORDS.test(trimmed) ||
    REFACTOR_WORDS.test(trimmed) ||
    SECURITY_WORDS.test(trimmed);
  const isFix = FIX_WORDS.test(trimmed);
  const isRefactor = REFACTOR_WORDS.test(trimmed);
  const isBuild = BUILD_WORDS.test(trimmed);

  let mode: GoalMode = "build";
  if (!isBuild && !isFix && !isRefactor && !wantsTests && !wantsReview && isConversationalGoal(trimmed)) {
    mode = "chat";
  } else if (wantsTests && !isBuild && !FRONTEND_WORDS.test(trimmed)) {
    mode = "test";
  } else if (isRefactor) {
    mode = "refactor";
  } else if (wantsReview && !isBuild) {
    mode = "review";
  } else if (isFix && !isBuild) {
    mode = "fix";
  }

  return {
    mode,
    layers: {
      frontend: FRONTEND_WORDS.test(trimmed),
      backend: BACKEND_WORDS.test(trimmed) || AUTH_WORDS.test(trimmed),
    },
    wantsTests,
    wantsReview: wantsReview || isRefactor,
  };
}

export function isConversationalGoal(goal: string): boolean {
  const trimmed = goal.trim();
  if (!trimmed) return false;
  return CHAT_GREETINGS.test(trimmed) || CHAT_QUESTIONS.test(trimmed);
}

/** True when the goal is a single-file or simple-script task (no test/review wave). */
export function isTrivialGoal(goal: string): boolean {
  const trimmed = goal.trim();
  if (!trimmed) return false;

  const analysis = analyzeGoal(trimmed);
  if (analysis.layers.frontend && analysis.layers.backend) return false;
  if (analysis.wantsTests || analysis.wantsReview) return false;

  return (
    TRIVIAL_HELLO_SH.test(trimmed) ||
    TRIVIAL_SCRIPT_FILE.test(trimmed) ||
    TRIVIAL_ONE_FILE_FIX.test(trimmed) ||
    TRIVIAL_ONE_FUNCTION.test(trimmed) ||
    TRIVIAL_SIMPLE_SCRIPT.test(trimmed)
  );
}

export const STEP_TASK_TYPES = [
  "implement",
  "implement-frontend",
  "implement-backend",
  "chat",
  "test",
  "fix",
  "refactor",
  "review",
] as const;

export type StepTaskType = (typeof STEP_TASK_TYPES)[number];

const STEP_TASK_TYPE_SET = new Set<string>(STEP_TASK_TYPES);

/** Map a plan step id (or task text) to a blended-routing task type. */
export function classifyStepTask(stepId: string, task: string): StepTaskType {
  if (STEP_TASK_TYPE_SET.has(stepId)) {
    return stepId as StepTaskType;
  }

  const analysis = analyzeGoal(task);
  if (analysis.mode === "test") return "test";
  if (analysis.mode === "chat") return "chat";
  if (analysis.mode === "fix") return "fix";
  if (analysis.mode === "refactor") return "refactor";
  if (analysis.mode === "review") return "review";
  if (analysis.layers.frontend && !analysis.layers.backend) return "implement-frontend";
  if (analysis.layers.backend && !analysis.layers.frontend) return "implement-backend";
  return "implement";
}

export function buildStepTask(kind: string, goal: string): string {
  switch (kind) {
    case "implement-frontend":
      return `Implement the frontend/UI: ${goal}`;
    case "implement-backend":
      return `Implement the backend/API: ${goal}`;
    case "fix":
      return `Debug and fix: ${goal}`;
    case "test":
      return `Write unit tests for: ${goal}`;
    case "review":
      return `Review and assess: ${goal}`;
    default:
      return goal;
  }
}
