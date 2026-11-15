import type { ValidationIssue } from '@resellpilot/shared';
import { CircleAlert } from 'lucide-react';

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
    <div role="alert" className="flex animate-rise gap-3 rounded-2xl border border-pink/30 bg-pink-soft px-4 py-3 text-sm">
      <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-pink" />
      <div className="min-w-0">
        <p className="font-semibold text-pink">{problem.message}</p>
        {shown.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-ink">
            {shown.map((issue, index) => (
              <li key={index}>
                <span className="text-muted">{issue.path}:</span> {issue.message}
              </li>
            ))}
            {hidden > 0 && <li className="text-muted">…y {hidden} más.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
