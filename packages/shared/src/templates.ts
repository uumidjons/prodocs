import type { JSONContent } from '@tiptap/core';

/**
 * SYSTEM TEMPLATES — the definitive list of pre-built, product-provided templates
 * (task §1/§2). These are the ONLY things that may appear in the "From template"
 * picker; a user's own documents are never templates.
 *
 * Each template is a SOURCE document with a fixed id, seeded server-side (see the
 * server's `modules/documents/templates.ts`). Creating "from a template" produces a
 * brand-new, independent user document whose content is copied from the template —
 * the template itself is never modified and never appears in a user's Documents.
 *
 * Content uses ONLY the shared editor schema (headings, paragraphs, lists, marks),
 * so it seeds/serializes through Yjs exactly like any other document.
 *
 * The ids are fixed (deterministic) so seeding is idempotent: re-running startup or
 * a test's re-seed inserts with ON CONFLICT DO NOTHING and never duplicates.
 */

export interface SystemTemplate {
  /** Fixed document id (also the row id in `documents`). */
  id: string;
  /** Stable machine key (useful for tests/logging; not shown to users). */
  key: string;
  /** The title given to the template AND to documents created from it. */
  title: string;
  /** A short description shown in the Templates gallery. */
  description: string;
  /** The ProseMirror/Tiptap content seeded as the template's body. */
  content: JSONContent;
}

const heading = (text: string): JSONContent => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
});

const paragraph = (text = ''): JSONContent =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };

const bullets = (items: string[]): JSONContent => ({
  type: 'bulletList',
  content: items.map((text) => ({
    type: 'listItem',
    content: [text ? paragraph(text) : { type: 'paragraph' }],
  })),
});

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    key: 'meeting-notes',
    title: 'Meeting Notes',
    description: 'Agenda, discussion, and action items for a focused meeting.',
    content: {
      type: 'doc',
      content: [
        paragraph('Date: '),
        paragraph('Participants: '),
        heading('Agenda'),
        bullets(['First topic', 'Second topic']),
        heading('Discussion'),
        paragraph('Summarize the key points raised during the meeting.'),
        heading('Action Items'),
        bullets(['Owner — task — due date']),
      ],
    },
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    key: 'project-brief',
    title: 'Project Brief',
    description: 'Objective, scope, and requirements to kick off a project.',
    content: {
      type: 'doc',
      content: [
        heading('Objective'),
        paragraph('Describe the goal this project is meant to achieve.'),
        heading('Scope'),
        paragraph('Outline what is in scope — and explicitly what is not.'),
        heading('Requirements'),
        bullets(['Requirement one', 'Requirement two', 'Requirement three']),
        heading('Notes'),
        paragraph('Add any additional context, links, or open questions here.'),
      ],
    },
  },
];
