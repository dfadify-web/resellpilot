import type { ValidationIssue } from '@resellpilot/shared';

export interface Problem {
  message: string;
  issues: ValidationIssue[];
}

const MAX_ISSUES = 12;

/** Aviso de error con la lista de problemas de validación. */
export function ErrorNote({ problem }: { problem: Problem | null }) {
  if (!problem) return null;
  const shown = problem.issues.slice(0, MAX_ISSUES);
  const hidden = problem.issues.length - shown.length;
  return (
    <div role="alert" className="border border-accent px-3 py-2 text-sm">
      <p className="font-semibold text-accent">{problem.message}</p>
      {shown.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-paper">
          {shown.map((issue, index) => (
            <li key={index}>
              <span className="text-muted">{issue.path}:</span> {issue.message}
            </li>
          ))}
          {hidden > 0 && <li className="text-muted">…y {hidden} más.</li>}
        </ul>
      )}
    </div>
  );
}
