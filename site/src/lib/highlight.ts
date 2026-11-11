// A small Python highlighter using VS Code's "Dark+" colours. It runs at build
// time, so visitors download plain coloured HTML, not a highlighting library.

const CTRL = new Set(["import", "from", "as", "for", "in", "return", "if", "else", "elif", "while", "with", "is", "not", "and", "or"]);
const DECL = new Set(["def", "class", "lambda", "None", "True", "False"]);
const MODS = new Set(["pd", "np", "sm"]);
const BUILTIN = new Set(["print", "len", "round", "abs", "range", "dict", "list", "max", "min", "sum"]);

export type Token = { t: string; c: string };

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /(#.*$)|(f?"(?:[^"\\]|\\.)*"|f?'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_]\w*)|(\s+)|([\s\S])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let c = "tk-p";
    if (m[1]) c = "tk-c";
    else if (m[2]) c = "tk-s";
    else if (m[3]) c = "tk-n";
    else if (m[4]) {
      const w = m[4];
      const next = src.slice(re.lastIndex).match(/^\s*(\S)/);
      if (CTRL.has(w)) c = "tk-k";
      else if (DECL.has(w)) c = "tk-d";
      else if (MODS.has(w)) c = "tk-m";
      else if (BUILTIN.has(w) || (next && next[1] === "(")) c = "tk-f";
      else c = "tk-v";
    } else if (m[5]) c = "";
    out.push({ t: m[0], c });
  }
  return out;
}
