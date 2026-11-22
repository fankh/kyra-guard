// The detection rules and the engine that runs them. Everything happens in this browser:
// the text being checked is never sent anywhere. Pure functions, unit-tested in Node.

export const RULE_ACTIONS = Object.freeze(['off', 'warn', 'block']);
export const CATEGORIES = Object.freeze(['PII', 'FINANCIAL', 'CREDENTIALS', 'CUSTOM']);
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

/**
 * How long an expression takes on text made to be slow for it. Run before a rule written
 * by a person is saved: one that backtracks without end would freeze every check. The text
 * grows step by step and the trial stops at the first slow step, so the trial itself is short.
 *
 * @returns {boolean} true when the expression is too slow to use
 */
export function tooSlow(regex, { budgetMs = 25, now = () => performance.now() } = {}) {
  const fromPattern = [...new Set(regex.source.replace(/\\[dDwWsSbB]/g, '').replace(/[^A-Za-z0-9가-힣@._ -]/g, ''))];
  const seeds = [...new Set(['a', '1', ' ', '-', '.', 'a1', 'a ', '가', ...fromPattern.slice(0, 6)])];
  for (const seed of seeds) {
    for (const length of [16, 22, 28, 34, 2000, 20000]) {
      const text = `${seed.repeat(Math.ceil(length / seed.length))}\u0000`;
      const probe = new RegExp(regex.source, regex.flags);
      const started = now();
      probe.test(text);
      if (now() - started > budgetMs) return true;
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
    if (tooSlow(regex, options)) return { ok: false, error: 'slow' };
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

/**
 * Runs the rules over a text.
 *
 * @returns {{action: 'allow'|'warn'|'block', findings: {id, name, nameKo, category, action, count}[],
 *   spans: {start, end, rule}[]}} `spans` say where, for masking; nothing in the result
 *   holds the text itself.
 */
export function scanText(text, rules) {
  const input = String(text ?? '').slice(0, SCAN_LIMIT);
  const findings = [];
  const spans = [];
  for (const rule of rules) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags.includes('g') ? rule.regex.flags : `${rule.regex.flags}g`);
    let count = 0;
    for (let match = regex.exec(input); match && count < MAX_MATCHES_PER_RULE; match = regex.exec(input)) {
      if (match[0] === '') {
        regex.lastIndex += 1;
        continue;
      }
      if (rule.valid && !rule.valid(match[0])) continue;
      count += 1;
      spans.push({ start: match.index, end: match.index + match[0].length, rule });
    }
    if (count) {
      findings.push({ id: rule.id, name: rule.name, nameKo: rule.nameKo, category: rule.category, action: rule.action, count });
    }
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
