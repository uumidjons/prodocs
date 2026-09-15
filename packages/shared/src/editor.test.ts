import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { buildBaseExtensions } from './editor.js';

/**
 * The base schema is shared by the client editor and the server seeding/template
 * path. These guard that the manual page break (task §3) is part of that shared
 * schema, so a document containing a page break maps cleanly through Yjs on both
 * sides (a schema mismatch would corrupt the CRDT content).
 */
describe('shared editor schema', () => {
  const schema = getSchema(buildBaseExtensions());

  it('includes the block-level pageBreak node', () => {
    expect(schema.nodes.pageBreak).toBeDefined();
    expect(schema.nodes.pageBreak!.spec.group).toContain('block');
    expect(schema.nodes.pageBreak!.isAtom).toBe(true);
  });

  it('marks the pageBreak as NOT selectable (a structural marker, not an object)', () => {
    // Selectability is the root cause of the "giant blue rectangle": a selectable
    // atom decorated to full-page height gets NodeSelected on click / first Backspace.
    // A non-selectable break resolves clicks to text positions and is removed via the
    // node's Backspace/Delete shortcuts instead.
    expect(schema.nodes.pageBreak!.spec.selectable).toBe(false);
    // A concrete instance is therefore not selectable (what actually blocks the
    // NodeSelection); ProseMirror derives this from `spec.selectable !== false`.
    expect(schema.nodes.pageBreak!.create().type.spec.selectable).toBe(false);
  });

  it('allows a page break between block content in a valid document', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('before')]),
      schema.node('pageBreak'),
      schema.node('paragraph', null, [schema.text('after')]),
    ]);
    // A structurally invalid doc would throw in check().
    expect(() => doc.check()).not.toThrow();
    expect(doc.childCount).toBe(3);
  });

  it('includes the underline mark (shared so client + server agree)', () => {
    expect(schema.marks.underline).toBeDefined();
  });

  it('exposes a textAlign attribute on paragraphs and headings only', () => {
    expect(schema.nodes.paragraph!.spec.attrs?.textAlign).toBeDefined();
    expect(schema.nodes.heading!.spec.attrs?.textAlign).toBeDefined();
    // Alignment must NOT leak onto nodes the MVP did not opt in (e.g. lists / breaks).
    expect(schema.nodes.bulletList?.spec.attrs?.textAlign).toBeUndefined();
    expect(schema.nodes.listItem?.spec.attrs?.textAlign).toBeUndefined();
    expect(schema.nodes.pageBreak?.spec.attrs?.textAlign).toBeUndefined();
  });

  it('round-trips an underlined, center-aligned paragraph as a valid document', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', { textAlign: 'center' }, [
        schema.text('hi', [schema.marks.underline!.create()]),
      ]),
    ]);
    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild!.attrs.textAlign).toBe('center');
  });

  it('includes the strike, code, and link inline marks (StarterKit + Link)', () => {
    // strike + code ship inside StarterKit, so they have always been part of the
    // shared schema; link is the new mark added this phase. All three are shared so
    // client and server agree.
    expect(schema.marks.strike).toBeDefined();
    expect(schema.marks.code).toBeDefined();
    expect(schema.marks.link).toBeDefined();
  });

  it('includes the blockquote block node (StarterKit)', () => {
    expect(schema.nodes.blockquote).toBeDefined();
    expect(schema.nodes.blockquote!.spec.group).toContain('block');
  });

  it('includes the taskList / taskItem nodes with a document-level checked attribute', () => {
    expect(schema.nodes.taskList).toBeDefined();
    expect(schema.nodes.taskItem).toBeDefined();
    // `checked` is a NODE ATTRIBUTE → it is document/CRDT state, not React state.
    expect(schema.nodes.taskItem!.spec.attrs?.checked).toBeDefined();
    expect(schema.nodes.taskItem!.create().attrs.checked).toBe(false);
  });

  it('round-trips a checked task item as a valid document', () => {
    const doc = schema.node('doc', null, [
      schema.node('taskList', null, [
        schema.node('taskItem', { checked: true }, [
          schema.node('paragraph', null, [schema.text('done')]),
        ]),
      ]),
    ]);
    expect(() => doc.check()).not.toThrow();
    expect(doc.firstChild!.firstChild!.attrs.checked).toBe(true);
  });

  it('round-trips a blockquote and a linked/struck/coded run as a valid document', () => {
    const doc = schema.node('doc', null, [
      schema.node('blockquote', null, [schema.node('paragraph', null, [schema.text('quoted')])]),
      schema.node('paragraph', null, [
        schema.text('x', [schema.marks.strike!.create()]),
        schema.text('y', [schema.marks.code!.create()]),
        schema.text('z', [schema.marks.link!.create({ href: 'https://example.com' })]),
      ]),
    ]);
    expect(() => doc.check()).not.toThrow();
  });

  it('includes the media block node carrying only a reference (never a binary)', () => {
    expect(schema.nodes.media).toBeDefined();
    expect(schema.nodes.media!.spec.group).toContain('block');
    expect(schema.nodes.media!.isAtom).toBe(true);
    // The node exposes ONLY reference/hint + layout attributes — no data/base64 attribute.
    const attrs = schema.nodes.media!.spec.attrs ?? {};
    expect(Object.keys(attrs).sort()).toEqual([
      'align',
      'alt',
      'height',
      'layout',
      'mediaId',
      'mime',
      'width',
    ]);
  });

  it('includes the comment mark (an anchor carrying a commentId)', () => {
    expect(schema.marks.comment).toBeDefined();
    // Not inclusive: typing right after a commented word does not extend the comment.
    expect(schema.marks.comment!.spec.inclusive).toBe(false);
  });

  it('round-trips a media node and a commented run as a valid document', () => {
    const doc = schema.node('doc', null, [
      schema.node('media', {
        mediaId: '00000000-0000-4000-8000-000000000000',
        mime: 'image/png',
        width: 10,
        height: 8,
        alt: 'a picture',
      }),
      schema.node('paragraph', null, [
        schema.text('commented', [schema.marks.comment!.create({ commentId: 'c1' })]),
      ]),
    ]);
    expect(() => doc.check()).not.toThrow();
    // The media node holds no binary — only the reference id.
    expect(doc.firstChild!.attrs.mediaId).toBe('00000000-0000-4000-8000-000000000000');
    expect(JSON.stringify(doc.toJSON())).not.toContain('base64');
  });
});
