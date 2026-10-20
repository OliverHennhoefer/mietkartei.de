import type { TaskInput } from '../server/tasks';
import { FormParser, type FieldErrors } from './fields';

// Parses the task form. The link is one select over properties and leases, so its value carries
// the kind: `property:<id>` or `lease:<id>`. Whether the id belongs to the account is checked by
// the server module, not here.

/** The fields of the form: the task's columns plus the combined link select. */
export type TaskForm = TaskInput & { link: string };

export type TaskFormErrors = FieldErrors<TaskForm>;

/** The success branch keeps the raw values too, so an action can re-render after a later refusal. */
export type TaskParseResult =
	| { ok: true; data: TaskInput; values: Record<string, string> }
	| { ok: false; errors: TaskFormErrors; values: Record<string, string> };

export const linkValue = (kind: 'property' | 'lease', id: string) => `${kind}:${id}`;

export function parseTask(form: FormData): TaskParseResult {
	const parser = new FormParser<TaskForm>(form);

	const title = parser.text('title');
	const dueDate = parser.date('dueDate', { required: false });
	const note = parser.optionalText('note', 2000);

	const link = parser.raw('link');
	let propertyId: string | null = null;
	let leaseId: string | null = null;
	if (link) {
		const match = /^(property|lease):([\w-]{1,64})$/.exec(link);
		if (!match) parser.fail('link', 'Bitte wähle einen gültigen Eintrag aus.');
		else if (match[1] === 'property') propertyId = match[2];
		else leaseId = match[2];
	}

	if (parser.hasErrors) return { ok: false, errors: parser.errors, values: parser.values };
	return { ok: true, data: { title, dueDate, propertyId, leaseId, note }, values: parser.values };
}
