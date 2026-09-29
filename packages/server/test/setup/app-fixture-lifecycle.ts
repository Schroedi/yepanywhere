import type { Supervisor } from "../../src/supervisor/Supervisor.js";

const supervisors = new Set<Supervisor>();

export function trackFixtureSupervisor(supervisor: Supervisor): void {
  // Browser fixtures use the same pure app factory and dispose explicitly.
  if (process.env.VITEST) supervisors.add(supervisor);
}

export async function drainFixtureSupervisors(): Promise<void> {
  const results = await Promise.allSettled(
    Array.from(supervisors, (supervisor) => supervisor.stopBackgroundTasks()),
  );
  supervisors.clear();
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "Full-app fixture background cleanup failed",
    );
}
