/*
 * The tools through which a work reaches a person, in one place: the job's gate offers them to Claude Code, and the
 * gateway offers them to a Managed Agents session. Plain, erasable TypeScript with no imports, so Node runs it in the job
 * as it is. Calling either ends the work; the Cockpit reads what was asked from the work's requests.
 */

export const ASK_PERSON = 'ask_person';
export const REQUEST_DATA = 'request_data';

/** What the agent is told when it asks a person: the work ends, and the answer starts the next. */
export const ASKED = 'Recorded. The run ends now; the answer starts the next run.';
/** What the agent is told when it asks for data: the work ends, and a person decides whether it is read. */
export const DATA_ASKED =
  'Recorded. The run ends now. A person decides whether this is read; the next run receives the data, or is told it was refused.';

/** The tools as both runners describe them: a name, what the model reads, and its input as JSON Schema. */
export const PERSON_TOOLS = [
  {
    name: ASK_PERSON,
    description:
      'Ask the person one short question with two or three options; they answer only by choosing one. Ask only when you ' +
      'cannot go on without their decision. The run ends and continues with the option they chose.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 3,
          description: 'Each a complete answer the person can pick as it is',
        },
      },
      required: ['question', 'options'],
    },
  },
  {
    name: REQUEST_DATA,
    description:
      "Ask to read data of the project's shop, such as products or pages, of a type the task lists as readable. A person " +
      'confirms each read; the run ends and the next run receives the data. Name the type as given (source/type), the ' +
      'ids when you know them (else the first few are read), and why the task needs it.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'A readable type, such as shopify/Product' },
        ids: { type: 'array', items: { type: 'string' }, description: 'The ids to read; leave out to read the first few' },
        why: { type: 'string', description: 'What the task needs it for, in one sentence' },
      },
      required: ['type', 'why'],
    },
  },
] as const;

/** What the agent is told after calling one of these tools; null for a name that is none of them. */
export const recordedOf = (name: string): string | null => {
  if (name === ASK_PERSON) return ASKED;
  if (name === REQUEST_DATA) return DATA_ASKED;
  return null;
};
