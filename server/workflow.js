// How a manager works through a task: the roles it can hand work to (passed to claude as custom
// agents with --agents) and the stages it follows. The team setting picks the workflow:
//  - plan-build-review: planner -> builders (up to the team's limit at once) -> reviewer
//  - plan-build: the same without the review
//  - direct: no stages; the manager delegates as it sees fit
// Desks show each agent's role (its agent type in the hook events).

const READ_ONLY = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"];

const ROLES = {
  planner: {
    description: "Plans a task before any change: reads the code it touches and splits the work into independent parts, each with the files involved and how to check it. Changes nothing.",
    prompt:
      "You are the planner of a small team. Read what the task touches and write a short plan: the parts that can be done independently (one line each, with the files involved), the order when parts depend on each other, and how to check the result (tests, commands, what to look at). Do not change any file. Be brief.",
    tools: READ_ONLY,
  },
  builder: {
    description: "Does one part of a planned task: edits files, runs commands and checks its own part works.",
    prompt:
      "You are a builder on a small team. Do exactly the part you were given, following the project's existing style. Check your part works (run the relevant tests or commands) and report what you changed and how you checked it. Do not touch work outside your part.",
  },
  reviewer: {
    description: "Reviews finished work with fresh eyes: reads the changes, runs the tests and reports real problems. Changes nothing.",
    prompt:
      "You are the reviewer of a small team. Look at what changed (git diff, the files named in the task), run the tests or checks the plan named, and report only real problems: bugs, missing pieces, broken behaviour, with file and line. If everything is fine, say so in one line. Do not change any file.",
    tools: [...READ_ONLY, "Bash"],
  },
};

const WORKFLOWS = {
  "plan-build-review": ["plan", "build", "review"],
  "plan-build": ["plan", "build"],
  direct: [],
};
const DEFAULT_WORKFLOW = "plan-build-review";
const ROLE_OF_STAGE = { plan: "planner", build: "builder", review: "reviewer" };

function stagesOf(team) {
  return WORKFLOWS[team.workflow] || WORKFLOWS[DEFAULT_WORKFLOW];
}

function managerPrompt(team) {
  const stages = stagesOf(team);
  const intro = [
    "You are the manager of this project inside Rebo Studios, the user's dashboard that shows their projects as an office.",
    "The user sends you tasks from there; report back briefly in the user's language.",
  ];
  const limit = team.maxAgents === 1 ? "one agent at a time" : `at most ${team.maxAgents} agents at the same time`;
  if (!stages.length) {
    return [...intro, `When a task has independent parts, delegate them to subagents (Agent tool), ${limit}. Do small tasks yourself.`].join(" ");
  }
  const steps = [
    "1. Plan: ask the planner agent for a plan split into independent parts.",
    `2. Build: give each part to a builder agent, ${limit}; parts that depend on each other go one after another.`,
  ];
  if (stages.includes("review")) steps.push("3. Review: ask the reviewer agent to check the result. If it reports real problems, send a builder to fix them, then report.");
  return [
    ...intro,
    "Work in stages, using your team's agents (Agent tool with subagent_type planner, builder, reviewer):",
    ...steps,
    "For a question or a trivial change, skip the stages and answer or do it yourself.",
  ].join("\n");
}

// The custom agents for this workflow (all of them for staged work, none for direct).
function agentsJson(team) {
  const stages = stagesOf(team);
  if (!stages.length) return null;
  const agents = {};
  for (const stage of stages) agents[ROLE_OF_STAGE[stage]] = ROLES[ROLE_OF_STAGE[stage]];
  return JSON.stringify(agents);
}

// Arguments for one run of the manager (claude -p, prompt on stdin).
function buildArgs(project, team, latestChat) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", team.permissionMode, "--append-system-prompt", managerPrompt(team), "-n", project.name];
  const agents = agentsJson(team);
  if (agents) args.push("--agents", agents);
  if (team.sessionId) args.push("--resume", team.sessionId);
  else if (latestChat && !team.startFresh) args.push("--resume", latestChat.id, "--fork-session");
  return args;
}

module.exports = { ROLES, WORKFLOWS, DEFAULT_WORKFLOW, stagesOf, managerPrompt, agentsJson, buildArgs };
