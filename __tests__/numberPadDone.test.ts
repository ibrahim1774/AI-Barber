// L4: every file that opens a no-Return number pad on a raw input wires the Done bar.
import fs from 'fs';
import path from 'path';

const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.tsx') ? [path.join(d, e.name)] : []));

test('files with a raw number-pad TextInput use the Done bar', () => {
  const raw = ['ButtonSheet.tsx', 'HomePrompts.tsx', 'ServicesSheet.tsx', 'ContactSheet.tsx'];
  const files = walk(path.join(__dirname, '..', 'src')).filter((f) => raw.includes(path.basename(f)));
  expect(files).toHaveLength(raw.length);
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    expect(s).toContain('useDoneBar(');
    expect(s).toContain('inputAccessoryViewID={doneBar.id}');
    expect(s).toContain('{doneBar.bar}');
  }
});
