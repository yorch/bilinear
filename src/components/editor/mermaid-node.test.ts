// @vitest-environment jsdom
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { DOMSerializer, DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { MermaidNode, mermaidRenderSpec } from './mermaid-node';

describe('mermaid node serialisation', () => {
  it('render spec has no content hole (leaf nodes must not have one)', () => {
    const spec = mermaidRenderSpec('graph TD; A-->B');
    expect(spec).toEqual(['div', { 'data-code': 'graph TD; A-->B', 'data-type': 'mermaid' }]);
    expect(spec).toHaveLength(2);
  });

  it('serialises a document containing a diagram without throwing and keeps the source', () => {
    const schema = getSchema([Document, Text, MermaidNode]);
    const node = schema.nodes.mermaid.create({ code: 'graph TD; A-->B' });
    const doc = schema.nodes.doc.create(null, [node]);
    const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    const el = dom.firstChild as HTMLElement;
    expect(el.getAttribute('data-type')).toBe('mermaid');
    expect(el.getAttribute('data-code')).toBe('graph TD; A-->B');
  });

  it('round-trips the source through parseHTML and stores it once', () => {
    const schema = getSchema([Document, Text, MermaidNode]);
    const node = schema.nodes.mermaid.create({ code: 'graph TD; A-->B' });
    const doc = schema.nodes.doc.create(null, [node]);
    const dom = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
    const holder = document.createElement('div');
    holder.appendChild(dom);
    // No duplicate bare `code` attribute alongside `data-code`.
    expect((holder.firstChild as HTMLElement).hasAttribute('code')).toBe(false);
    const parsed = PMDOMParser.fromSchema(schema).parse(holder);
    expect(parsed.firstChild?.attrs.code).toBe('graph TD; A-->B');
  });

  it('prefers data-code over a stale legacy code attribute when parsing', () => {
    const schema = getSchema([Document, Text, MermaidNode]);
    const holder = document.createElement('div');
    holder.innerHTML = '<div code="old" data-code="new" data-type="mermaid"></div>';
    const parsed = PMDOMParser.fromSchema(schema).parse(holder);
    expect(parsed.firstChild?.attrs.code).toBe('new');
  });
});
