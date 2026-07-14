export type GoalMode = "build" | "fix" | "test" | "review" | "refactor";

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
const FIX_WORDS = /\b(fix|debug|bug|broken|error|issue|repair|patch|troubleshoot)\b/i;
const BUILD_WORDS = /\b(build|create|add|implement|make|design|scaffold|setup|set up)\b/i;

const FRONTEND_WORDS =
  /\b(page|ui|frontend|component|button|screen|view|layout|css|tailwind|react|vue|website|site|portfolio|graph|chart|visualization|social|landing|navbar|hero)\b/i;
const AUTH_WORDS = /\b(auth|authentication|oauth|jwt|session management)\b/i;
const BACKEND_WORDS =
  /\b(api|backend|server|database|endpoint|route|middleware|jwt|session|oauth|graphql|postgres|mysql)\b/i;

/** Classify a natural-language goal — drives which steps exist, not which agent runs them. */
export function analyzeGoal(goal: string): GoalAnalysis {
  const trimmed = goal.trim();
  const wantsTests = TEST_WORDS.test(trimmed);
  const wantsReview = REVIEW_WORDS.test(trimmed) || REFACTOR_WORDS.test(trimmed);
  const isFix = FIX_WORDS.test(trimmed);
  const isRefactor = REFACTOR_WORDS.test(trimmed);
  const isBuild = BUILD_WORDS.test(trimmed);

  let mode: GoalMode = "build";
  if (wantsTests && !isBuild && !FRONTEND_WORDS.test(trimmed)) {
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
