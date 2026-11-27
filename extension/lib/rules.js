// The detection rules and the engine that runs them. Everything happens in this browser:
// the text being checked is never sent anywhere. Pure functions, unit-tested in Node.

export const RULE_ACTIONS = Object.freeze(['off', 'warn', 'block']);
export const CATEGORIES = Object.freeze(['PII', 'FINANCIAL', 'CREDENTIALS', 'INTELLECTUAL_PROPERTY', 'CUSTOM']);
/** Longer text is checked up to here (the page script uses the same limit). */
export const SCAN_LIMIT = 100000;
export const MAX_CUSTOM_RULES = 100;
export const MAX_PATTERN_LENGTH = 500;
const MAX_MATCHES_PER_RULE = 200;

const digitsOf = (text) => text.replace(/\D/g, '');

/** A real calendar date in a 6-digit YYMMDD (the century does not matter for this check). */
function validYymmdd(six) {
  const month = Number(six.slice(2, 4));
  const day = Number(six.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Luhn check, as printed on payment cards. */
export function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** Check digit of a Korean business registration number. */
export function validBusinessNumber(digits) {
  if (digits.length !== 10) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * weights[i];
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(digits[9]);
}

/** Corporate registration number (법인등록번호): 13 digits, the last one a check digit. */
function validCorporateNumber(digits) {
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(digits[i]) * (i % 2 ? 2 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

/**
 * The rules that come with the extension. `action` is what a new install does; settings
 * can turn each one off or change it. Numbers are matched with "no digit before or after"
 * instead of a word boundary, so they are found next to Korean text as well.
 */
export const BUILTIN_RULES = Object.freeze([
  {
    id: 'kr-resident-number', name: 'Resident registration number (KR)', nameKo: '주민등록번호',
    category: 'PII', action: 'block',
    regex: /(?<!\d)\d{6}[-\s]?[1-4]\d{6}(?!\d)/g,
    // Numbers issued since October 2020 carry no check digit, so only the date is checked.
    valid: (m) => validYymmdd(digitsOf(m)),
  },
  {
    id: 'kr-foreigner-number', name: 'Foreigner registration number (KR)', nameKo: '외국인등록번호',
    category: 'PII', action: 'block',
    regex: /(?<!\d)\d{6}[-\s]?[5-8]\d{6}(?!\d)/g,
    valid: (m) => validYymmdd(digitsOf(m)),
  },
  {
    id: 'kr-passport', name: 'Passport number (KR)', nameKo: '여권번호',
    category: 'PII', action: 'warn',
    regex: /(?<![A-Za-z0-9])[MSRODG](?:\d{8}|\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g,
  },
  {
    id: 'kr-driver-licence', name: 'Driver licence number (KR)', nameKo: '운전면허번호',
    category: 'PII', action: 'warn',
    regex: /(?<!\d)\d{2}-\d{2}-\d{6}-\d{2}(?!\d)/g,
  },
  {
    id: 'kr-mobile-phone', name: 'Mobile phone number (KR)', nameKo: '휴대전화번호',
    category: 'PII', action: 'warn',
    regex: /(?<!\d)01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g,
  },
  {
    // Area codes (02, 031-064) and 070 numbers; a separator is asked for, to leave other numbers alone.
    id: 'kr-landline-phone', name: 'Landline phone number (KR)', nameKo: '유선전화번호',
    category: 'PII', action: 'off',
    regex: /(?<!\d)0(?:2|[3-6][1-5]|70)[-.\s]\d{3,4}[-.\s]\d{4}(?!\d)/g,
  },
  {
    id: 'email-address', name: 'E-mail address', nameKo: '이메일 주소',
    category: 'PII', action: 'off',
    regex: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}(?![A-Za-z0-9-])/g,
  },
  {
    id: 'payment-card', name: 'Payment card number', nameKo: '카드번호',
    category: 'FINANCIAL', action: 'block',
    regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    valid: (m) => luhn(digitsOf(m)),
  },
  {
    id: 'kr-business-number', name: 'Business registration number (KR)', nameKo: '사업자등록번호',
    category: 'FINANCIAL', action: 'off',
    regex: /(?<!\d)\d{3}-\d{2}-\d{5}(?!\d)/g,
    valid: (m) => validBusinessNumber(digitsOf(m)),
  },
  {
    id: 'kr-corporate-number', name: 'Corporate registration number (KR)', nameKo: '법인등록번호',
    category: 'FINANCIAL', action: 'off',
    regex: /(?<!\d)\d{6}-\d{7}(?!\d)/g,
    valid: (m) => validCorporateNumber(digitsOf(m)),
  },
  {
    id: 'private-key', name: 'Private key', nameKo: '개인 키',
    category: 'CREDENTIALS', action: 'block',
    regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  {
    id: 'aws-access-key', name: 'AWS access key', nameKo: 'AWS 액세스 키',
    category: 'CREDENTIALS', action: 'block',
    regex: /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g,
  },
  {
    id: 'api-token', name: 'API key or token', nameKo: 'API 키 또는 토큰',
    category: 'CREDENTIALS', action: 'block',
    regex: /(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})/g,
  },
  {
    id: 'json-web-token', name: 'JSON Web Token', nameKo: 'JWT 토큰',
    category: 'CREDENTIALS', action: 'warn',
    regex: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    id: 'password-assignment', name: 'Password written out', nameKo: '비밀번호 기재',
    category: 'CREDENTIALS', action: 'warn',
    regex: /(?:password|passwd|pwd|비밀번호|패스워드|암호)\s{0,3}[:=]\s{0,3}\S{6,}/gi,
  },
  {
    // The markings public bodies put on documents: 대외비, and Ⅰ·Ⅱ·Ⅲ급 비밀 in any of their spellings.
    id: 'kr-security-marking', name: 'Security marking (KR)', nameKo: '보안 등급 표시',
    category: 'INTELLECTUAL_PROPERTY', action: 'warn',
    regex: /대외비|(?:[ⅠⅡⅢ]|III|II|I|[1-3])\s?급\s?비밀|군사\s?기밀/g,
  },
]);

const asciiWord = (ch) => /[A-Za-z0-9_]/.test(ch);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The expression for a keyword rule: comma-separated words, any letter case. A word
 * boundary is asked for only on a side where the keyword starts or ends with an ASCII
 * letter, digit or underscore: around Korean, Japanese or Chinese text there is none, and
 * those languages attach particles to a word.
 */
export function keywordRegex(pattern) {
  const terms = String(pattern ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => (asciiWord(term[0]) ? '\\b' : '') + escapeRegex(term) + (asciiWord(term[term.length - 1]) ? '\\b' : ''));
  return terms.length ? new RegExp(terms.join('|'), 'gi') : null;
}

/** Where a group is opened: the length of its opening, "(", "(?:", "(?<name>" or a look-around. */
function groupOpening(source, at) {
  if (source[at + 1] !== '?') return 1;
  const named = /^\(\?<(?![=!])[^>]*>/.exec(source.slice(at));
  if (named) return named[0].length;
  return source.startsWith('(?<=', at) || source.startsWith('(?<!', at) ? 4 : 3;
}

/**
 * True when a repeated group itself holds a repeat, like (a+)+ or (\w*x)*: the shape that
 * can backtrack without end. Such rules are refused outright; a trial alone can miss them.
 */
export function nestedRepeat(source) {
  const groups = [{ repeats: false }];
  let last = null; // the group just closed, which a quantifier would apply to
  for (let at = 0; at < source.length;) {
    const ch = source[at];
    if (ch === '\\') {
      last = null;
      at += 2;
    } else if (ch === '[') {
      let end = at + 1;
      if (source[end] === '^') end += 1;
      if (source[end] === ']') end += 1;
      while (end < source.length && source[end] !== ']') end += source[end] === '\\' ? 2 : 1;
      last = null;
      at = end + 1;
    } else if (ch === '(') {
      groups.push({ repeats: false });
      last = null;
      at += groupOpening(source, at);
    } else if (ch === ')') {
      last = groups.length > 1 ? groups.pop() : null;
      if (last?.repeats) groups[groups.length - 1].repeats = true;
      at += 1;
    } else if (ch === '*' || ch === '+' || (ch === '{' && /^\{\d+(?:,\d*)?\}/.test(source.slice(at)))) {
      // {3} or {2,5} repeats a bounded number of times; *, + and {2,} without end.
      const braces = ch === '{' ? /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at)) : null;
      const endless = !braces || (braces[2] !== undefined && braces[3] === '');
      const most = braces ? Number(braces[3] || braces[1]) : Infinity;
      if (last?.repeats && (endless || most > 1)) return true;
      if (endless) groups[groups.length - 1].repeats = true;
      last = null;
      at = ch === '{' ? at + braces[0].length : at + 1;
      if (source[at] === '?') at += 1;
    } else {
      last = null;
      at += 1;
    }
  }
  return false;
}

/**
 * How long an expression takes on text made to be slow for it. Run before a rule written
 * by a person is saved: one that backtracks without end would freeze every check. The text
 * is built from every character and every run of letters in the expression (all of them: a
 * cap could be filled with harmless ones ahead of the slow part), grows step by step, and the
 * trial stops at the first slow step. An expression slow on every text without being slow on
 * any one is caught by the trial's total time.
 *
 * @returns {boolean} true when the expression is too slow to use
 */
export function tooSlow(regex, { budgetMs = 25, totalMs = 500, now = () => performance.now() } = {}) {
  const literal = regex.source.replace(/\\[dDwWsSbB]/g, ' ');
  const characters = literal.replace(/[^A-Za-z0-9가-힣@._ -]/g, '');
  const runs = literal.match(/[A-Za-z0-9가-힣@._-]{2,}/g) ?? [];
  const seeds = [...new Set(['a', '1', ' ', '-', '.', 'a1', 'a ', '가', ...characters, ...runs])];
  const deadline = now() + totalMs;
  for (const seed of seeds) {
    for (const length of [16, 22, 28, 34, 2000, 20000]) {
      const text = `${seed.repeat(Math.ceil(length / seed.length))}\u0000`;
      const probe = new RegExp(regex.source, regex.flags);
      const started = now();
      probe.test(text);
      const ended = now();
      if (ended - started > budgetMs || ended > deadline) return true;
    }
  }
  return false;
}

/**
 * Checks a rule written by a person and returns it ready to run.
 *
 * @returns {{ok: true, rule: object}|{ok: false, error: 'name'|'pattern'|'tooLong'|'invalid'|'slow'|'empty'}}
 */
export function compileCustomRule(raw, options) {
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 80) : '';
  const pattern = typeof raw?.pattern === 'string' ? raw.pattern.trim() : '';
  const type = raw?.type === 'regex' ? 'regex' : 'keyword';
  if (!name) return { ok: false, error: 'name' };
  if (!pattern) return { ok: false, error: 'pattern' };
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, error: 'tooLong' };
  let regex;
  if (type === 'keyword') {
    regex = keywordRegex(pattern);
    if (!regex) return { ok: false, error: 'pattern' };
  } else {
    try {
      regex = new RegExp(pattern, 'g');
    } catch {
      return { ok: false, error: 'invalid' };
    }
    if (regex.test('')) return { ok: false, error: 'empty' };
    if (nestedRepeat(pattern) || tooSlow(regex, options)) return { ok: false, error: 'slow' };
  }
  return {
    ok: true,
    rule: {
      id: typeof raw.id === 'string' && raw.id ? raw.id : `custom-${name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-')}`,
      name, nameKo: name, category: 'CUSTOM', custom: true, type, pattern,
      action: RULE_ACTIONS.includes(raw.action) ? raw.action : 'warn',
      regex,
    },
  };
}

/**
 * The rules in force: the built-in ones with the settings' choices applied, then the
 * person's own. Rules that are off, and own rules that no longer compile, are left out.
 *
 * @param {{rules?: Record<string, string>, customRules?: object[]}} settings
 */
export function activeRules(settings, options) {
  const out = [];
  for (const rule of BUILTIN_RULES) {
    const chosen = settings?.rules?.[rule.id];
    const action = RULE_ACTIONS.includes(chosen) ? chosen : rule.action;
    if (action !== 'off') out.push({ ...rule, action });
  }
  for (const raw of (settings?.customRules ?? []).slice(0, MAX_CUSTOM_RULES)) {
    const compiled = compileCustomRule(raw, options);
    if (compiled.ok && compiled.rule.action !== 'off') out.push(compiled.rule);
  }
  return out;
}

// Characters that show nothing: zero-width spaces and joiners, the soft hyphen, direction marks.
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const WIDE = /[！-～　]/;
// Three or more single characters, each one space or tab apart: "9 0 0 1 0 1", "p a s s".
const SPACED_OUT = /(?<!\S)\S(?:[ \t]\S){2,}(?!\S)/u;

/**
 * The text as the rules should see it when someone tried to hide a value: invisible
 * characters taken out, full-width letters and digits made ordinary, and characters typed
 * one space apart put back together. Ordinary text is left alone: "1.2", "a b" and
 * "010 1234 5678" do not change. `at[i]` is where character i came from in the original,
 * so findings can be masked there.
 *
 * @returns {{text: string, at: number[]}|null} null when there is nothing to undo
 */
export function foldForScan(input) {
  if (!INVISIBLE.test(input) && !WIDE.test(input) && !SPACED_OUT.test(input)) return null;
  const chars = [];
  const at = [];
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (INVISIBLE.test(ch)) continue;
    const code = ch.charCodeAt(0);
    chars.push(code === 0x3000 ? ' ' : code >= 0xFF01 && code <= 0xFF5E ? String.fromCharCode(code - 0xFEE0) : ch);
    at.push(i);
  }
  const unhidden = chars.join('');
  const keep = new Array(unhidden.length).fill(true);
  for (const run of unhidden.matchAll(new RegExp(SPACED_OUT.source, 'gu'))) {
    for (let i = run.index; i < run.index + run[0].length; i += 1) {
      if (unhidden[i] === ' ' || unhidden[i] === '\t') keep[i] = false;
    }
  }
  const folded = [];
  const foldedAt = [];
  for (let i = 0; i < unhidden.length; i += 1) {
    if (keep[i]) {
      folded.push(unhidden[i]);
      foldedAt.push(at[i]);
    }
  }
  const text = folded.join('');
  return text === input ? null : { text, at: foldedAt };
}

/** Each rule's matches in a text: rule id -> {rule, count, spans}. */
function matchRules(input, rules) {
  const out = new Map();
  for (const rule of rules) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`);
    const spans = [];
    for (let match = regex.exec(input); match && spans.length < MAX_MATCHES_PER_RULE; match = regex.exec(input)) {
      if (match[0] === '') {
        regex.lastIndex += 1;
        continue;
      }
      if (rule.valid && !rule.valid(match[0])) continue;
      spans.push({ start: match.index, end: match.index + match[0].length, rule });
    }
    if (spans.length) out.set(rule.id, { rule, count: spans.length, spans });
  }
  return out;
}

/**
 * Runs the rules over a text, and over its folded form (foldForScan) when that differs, so
 * a value with a zero-width space, full-width digits or spaces between its characters is
 * still found. A value found both ways counts once.
 *
 * @returns {{action: 'allow'|'warn'|'block', findings: {id, name, nameKo, category, action, count}[],
 *   spans: {start, end, rule}[]}} `spans` say where in the text as given, for masking; nothing
 *   in the result holds the text itself.
 */
export function scanText(text, rules) {
  const input = String(text ?? '').slice(0, SCAN_LIMIT);
  const plain = matchRules(input, rules);
  const fold = foldForScan(input);
  const folded = fold ? matchRules(fold.text, rules) : new Map();
  const findings = [];
  const spans = [];
  for (const rule of rules) {
    const a = plain.get(rule.id);
    const b = folded.get(rule.id);
    if (!a && !b) continue;
    const seen = new Set();
    const mapped = (b?.spans ?? []).map((s) => ({ start: fold.at[s.start], end: fold.at[s.end - 1] + 1, rule }));
    for (const span of [...(a?.spans ?? []), ...mapped]) {
      const key = `${span.start}:${span.end}`;
      if (!seen.has(key)) {
        seen.add(key);
        spans.push(span);
      }
    }
    const count = Math.max(a?.count ?? 0, b?.count ?? 0);
    findings.push({ id: rule.id, name: rule.name, nameKo: rule.nameKo, category: rule.category, action: rule.action, count });
  }
  const action = findings.some((f) => f.action === 'block') ? 'block' : findings.length ? 'warn' : 'allow';
  return { action, findings, spans };
}

/**
 * The text with every finding replaced by its rule's name in brackets. Where findings
 * overlap, the one that starts first (then the longer one) covers the others.
 */
export function maskText(text, spans, label = (rule) => rule.name) {
  const input = String(text ?? '');
  const ordered = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let at = 0;
  for (const span of ordered) {
    if (span.start < at) {
      // Overlaps what was just masked: extend the cover, add no second label.
      at = Math.max(at, span.end);
      continue;
    }
    out += `${input.slice(at, span.start)}[${label(span.rule)}]`;
    at = span.end;
  }
  return out + input.slice(at);
}
