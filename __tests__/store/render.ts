import React from 'react';

const { act, create } = require('react-test-renderer');

export { act };

/** Renders an element and waits for its effects. */
export async function render(el: React.ReactElement) {
  let tree: any;
  await act(async () => {
    tree = create(el);
  });
  return tree;
}

const textOf = (n: any): string =>
  (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');

/** All text in the tree, joined by newlines. */
export const allText = (tree: any): string[] =>
  tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => textOf(n));

const buttonNodes = (tree: any, title: string) =>
  tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n) === title);

export const hasButton = (tree: any, title: string) => buttonNodes(tree, title).length > 0;

export async function press(tree: any, title: string) {
  const nodes = buttonNodes(tree, title);
  if (!nodes.length) throw new Error(`No button "${title}". Text: ${allText(tree).join(' | ')}`);
  await act(async () => {
    await nodes[0].props.onPress();
  });
}

export async function type(tree: any, label: string, value: string) {
  const nodes = tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
  if (!nodes.length) throw new Error(`No input "${label}"`);
  await act(async () => {
    nodes[0].props.onChangeText(value);
  });
}

export async function toggle(tree: any, label: string, value: boolean) {
  const nodes = tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onValueChange === 'function');
  if (!nodes.length) throw new Error(`No switch "${label}"`);
  await act(async () => {
    nodes[0].props.onValueChange(value);
  });
}

/** Presses a list row whose text starts with `label` (rows also hold a detail line and a chevron). */
export async function pressRow(tree: any, label: string) {
  const nodes = tree.root.findAll(
    (n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n).startsWith(label),
  );
  if (!nodes.length) throw new Error(`No row "${label}"`);
  await act(async () => {
    await nodes[0].props.onPress();
  });
}
