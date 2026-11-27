import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  BUILTIN_RULES, activeRules, compileCustomRule, foldForScan, keywordRegex, luhn, maskText, nestedRepeat, scanText, tooSlow, validBusinessNumber,
} from '../extension/lib/rules.js';

const defaults = activeRules({});
const all = activeRules({ rules: Object.fromEntries(BUILTIN_RULES.map((r) => [r.id, 'warn'])) });
const ids = (text, rules = all) => scanText(text, rules).findings.map((f) => f.id);

describe('built-in rules', () => {
  it('finds a resident registration number, also next to Korean text', () => {
    assert.deepEqual(ids('주민번호는 900101-1234567입니다'), ['kr-resident-number']);
    assert.deepEqual(ids('9001011234567'), ['kr-resident-number']);
    assert.deepEqual(ids('foreigner 900101-5234567'), ['kr-foreigner-number']);
  });

  it('does not take a number with an impossible date, or part of a longer number', () => {
    assert.deepEqual(ids('order 901301-1234567'), []);
    assert.deepEqual(ids('900132-1234567'), []);
    assert.deepEqual(ids('19001011234567890'), []);
  });

  it('finds a payment card number only when its check digit is right', () => {
    assert.deepEqual(ids('card 4111 1111 1111 1111 exp 12/29'), ['payment-card']);
    assert.deepEqual(ids('card 4111-1111-1111-1112'), []);
    assert.equal(luhn('4111111111111111'), true);
    assert.equal(luhn('1234'), false);
  });

  it('finds phone, passport, licence and business numbers', () => {
    assert.deepEqual(ids('연락처 010-1234-5678'), ['kr-mobile-phone']);
    assert.deepEqual(ids('passport M12345678'), ['kr-passport']);
    assert.deepEqual(ids('면허 11-23-123456-78'), ['kr-driver-licence']);
    assert.equal(validBusinessNumber('1248100998'), true);
    assert.deepEqual(ids('사업자번호 124-81-00998'), ['kr-business-number']);
    assert.deepEqual(ids('사업자번호 124-81-00999'), []);
  });

  it('finds keys, tokens and written-out passwords', () => {
    assert.deepEqual(ids('-----BEGIN RSA PRIVATE KEY-----\nMIIE'), ['private-key']);
    assert.deepEqual(ids('-----BEGIN PRIVATE KEY-----'), ['private-key']);
    assert.deepEqual(ids('aws AKIAIOSFODNN7EXAMPLE here'), ['aws-access-key']);
    assert.deepEqual(ids(`token ghp_${'a1B2'.repeat(9)}`), ['api-token']);
    assert.deepEqual(ids(`key sk-proj-${'x'.repeat(30)}`), ['api-token']);
    assert.deepEqual(ids('비밀번호: hunter2!!'), ['password-assignment']);
    assert.deepEqual(ids('Password = s3cretValue'), ['password-assignment']);
    assert.deepEqual(ids('the task-list is long, ask-me later'), []);
  });

  it('leaves e-mail addresses and business numbers alone unless they are turned on', () => {
    assert.deepEqual(ids('mail kim@example.com, 사업자 124-81-00998', defaults), []);
    assert.deepEqual(ids('mail kim@example.com'), ['email-address']);
  });

  it('blocks when any finding blocks, warns otherwise, and counts what it found', () => {
    assert.equal(scanText('plain text', defaults).action, 'allow');
    assert.equal(scanText('call 010-1234-5678', defaults).action, 'warn');
    const both = scanText('010-1234-5678 and 010-9999-0000 and 900101-1234567', defaults);
    assert.equal(both.action, 'block');
    assert.equal(both.findings.find((f) => f.id === 'kr-mobile-phone').count, 2);
    assert.ok(!JSON.stringify(both.findings).includes('1234567'), 'findings never hold the text');
  });

  it('applies the settings: a rule can be turned off or changed', () => {
    const rules = activeRules({ rules: { 'kr-resident-number': 'off', 'kr-mobile-phone': 'block', 'email-address': 'bogus' } });
    assert.equal(rules.some((r) => r.id === 'kr-resident-number'), false);
    assert.equal(rules.find((r) => r.id === 'kr-mobile-phone').action, 'block');
    assert.equal(rules.some((r) => r.id === 'email-address'), false, 'an unknown choice keeps the default (off)');
  });
});

describe('own rules', () => {
  const found = (pattern, text) => [...text.matchAll(keywordRegex(pattern))].map((m) => m[0]);

  it('matches a Korean keyword alone and with a particle attached', () => {
    assert.deepEqual(found('대외비', '이 문서는 대외비 입니다'), ['대외비']);
    assert.deepEqual(found('대외비', '대외비를 보내지 마세요'), ['대외비']);
    assert.deepEqual(found('機密', 'これは機密です'), ['機密']);
  });

  it('matches an English keyword as a whole word, in any letter case', () => {
    assert.deepEqual(found('secret', 'the Secret plan'), ['Secret']);
    assert.deepEqual(found('secret', 'secretary and topsecrets'), []);
    assert.deepEqual(found('apollo, 대외비', 'apollo계획은 대외비'), ['apollo', '대외비']);
    assert.deepEqual(found('a.b', 'aXb a.b'), ['a.b'], 'punctuation in a keyword is literal');
    assert.equal(keywordRegex(' , '), null);
  });

  it('refuses a rule that is incomplete, invalid, matches nothing or is slow', () => {
    assert.equal(compileCustomRule({ name: '', pattern: 'x' }).error, 'name');
    assert.equal(compileCustomRule({ name: 'n', pattern: ' ' }).error, 'pattern');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: 'a'.repeat(501) }).error, 'tooLong');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: '(' }).error, 'invalid');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: 'a*' }).error, 'empty');
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: '(a+)+$' }).error, 'slow');
    assert.equal(tooSlow(/PRJ-\d{4}/g), false);
  });

  it('refuses a slow rule whose slow part uses letters found late in the expression', () => {
    // Passed the trial before: only the first six letters of an expression were tried.
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: 'bcdefg|(h+)+i' }).error, 'slow');
    assert.equal(tooSlow(/bcdefg|(?:h|hh)+i/g), true);
    // Many harmless characters ahead of the slow part must not push it out of the trial.
    const filler = Array.from({ length: 120 }, (_, i) => String.fromCharCode(0xAC03 + i * 3)).join('');
    assert.equal(tooSlow(new RegExp(`${filler}|(?:힣|힣힣)+i`, 'g')), true);
  });

  it('refuses a repeated group that holds a repeat, and keeps bounded or simple ones', () => {
    for (const slow of ['(a+)+', '(\\w*x)*y', '(?:[a-z]+\\s?){2,}', '(?<word>\\d+-)+$', '((ab)+c)*', '(x+){1,30}']) {
      assert.equal(nestedRepeat(slow), true, slow);
    }
    for (const fine of ['PRJ-\\d{4}', '(\\d{3}-){2}\\d{4}', '(foo|bar)+baz', '(?<!\\d)\\d{6}(?!\\d)', '[(+*)]+', '\\(a+\\)+', '(a{3})+', 'x+(y+)']) {
      assert.equal(nestedRepeat(fine), false, fine);
    }
    assert.equal(compileCustomRule({ name: 'n', type: 'regex', pattern: '(\\d{3}-){2}\\d{4}' }).ok, true);
  });

  it('checks nothing past its limit, so the page script sends longer text in pieces', () => {
    const key = `sk-${'A'.repeat(30)}`;
    assert.equal(scanText(key, defaults).action, 'block');
    assert.equal(scanText('x'.repeat(100000) + key, defaults).action, 'allow');
    const script = readFileSync(new URL('../extension/content/prompt.js', import.meta.url), 'utf8');
    assert.match(script, /askAll\('scanPrompt'/);
    assert.match(script, /askAll\('scanFile'/);
    // No answer from the worker warns instead of sending unchecked (it used to send).
    assert.match(script, /UNCHECKED = Object\.freeze\(\{ action: 'warn'/);
    assert.doesNotMatch(script, /\|\| \{ action: 'allow' \}/);
  });

  it('finds the markings and numbers public bodies use, when those rules are on', () => {
    const rules = activeRules({ rules: { 'kr-corporate-number': 'warn', 'kr-landline-phone': 'warn' } });
    const ids = (text) => scanText(text, rules).findings.map((f) => f.id);
    for (const marked of ['본 문서는 대외비임', 'Ⅱ급 비밀', '3급비밀', 'II급비밀', '군사 기밀']) assert.deepEqual(ids(marked), ['kr-security-marking'], marked);
    assert.deepEqual(ids('고급 비밀 레시피와 비밀번호 변경 안내'), []);
    assert.deepEqual(ids('법인등록번호 130111-0006246'), ['kr-corporate-number']);
    assert.deepEqual(ids('법인등록번호 130111-0006247'), [], 'a wrong check digit');
    assert.deepEqual(ids('대표전화 02-2039-8160, 팩스 031-123-4567, 070-1234-5678'), ['kr-landline-phone']);
    assert.equal(scanText('02-2039-8160', rules).findings[0].count, 1);
    assert.deepEqual(ids('2026-11-24 12:30, 제2026-1234호, 0212345678'), []);
    // Off unless turned on; the marking warns from the start.
    assert.deepEqual(scanText('130111-0006246, 02-2039-8160, 대외비', activeRules({})).findings.map((f) => [f.id, f.action]), [['kr-security-marking', 'warn']]);
  });

  it('runs an own rule with the built-in ones', () => {
    const rules = activeRules({
      customRules: [
        { id: 'custom-a', name: 'Project code', type: 'regex', pattern: 'PRJ-\\d{4}', action: 'block' },
        { id: 'custom-b', name: 'Internal', type: 'keyword', pattern: '대외비, confidential', action: 'warn' },
        { id: 'custom-c', name: 'Broken', type: 'regex', pattern: '(', action: 'block' },
        { id: 'custom-d', name: 'Off', type: 'keyword', pattern: 'x', action: 'off' },
      ],
    });
    const result = scanText('PRJ-2041 is Confidential, 대외비임', rules);
    assert.equal(result.action, 'block');
    assert.deepEqual(result.findings.map((f) => [f.id, f.category, f.count]), [['kr-security-marking', 'INTELLECTUAL_PROPERTY', 1], ['custom-a', 'CUSTOM', 1], ['custom-b', 'CUSTOM', 2]]);
  });
});

describe('hidden values', () => {
  const key = `sk-${'A'.repeat(30)}`;

  it('finds a value with an invisible character, full-width digits or spaces between its characters', () => {
    // Each of these passed before: the rules ran on the text exactly as typed.
    assert.equal(scanText(`key sk-​${'A'.repeat(30)}`, defaults).action, 'block');
    assert.equal(scanText(`key s­k-${'A'.repeat(30)}`, defaults).action, 'block');
    assert.deepEqual(ids('주민번호 9 0 0 1 0 1 - 1 2 3 4 5 6 7'), ['kr-resident-number']);
    assert.deepEqual(ids('주민번호 ９００１０１－１２３４５６７'), ['kr-resident-number']);
    assert.deepEqual(ids('p a s s w o r d : hunter2!!'), ['password-assignment']);
  });

  it('leaves ordinary text as it is', () => {
    for (const text of ['1.2 and a b', 'call 010 1234 5678', 'plain text', '한국어 문장입니다', key]) {
      assert.equal(foldForScan(text), null, text);
    }
    assert.deepEqual(ids('a b c d'), []);
    assert.equal(scanText('version 1 2 3 of the plan', defaults).action, 'allow');
  });

  it('counts a value found both ways once, and masks it where it is in the text as given', () => {
    assert.equal(scanText('call 010-1234-5678', all).findings[0].count, 1);
    const two = scanText('010-1234-5678 or 0​10-9999-0000', all);
    assert.equal(two.findings.find((f) => f.id === 'kr-mobile-phone').count, 2);
    const text = `key sk-​${'A'.repeat(30)} end`;
    assert.equal(maskText(text, scanText(text, defaults).spans), 'key [API key or token] end');
    const spaced = 'id 9 0 0 1 0 1 - 1 2 3 4 5 6 7 ok';
    assert.equal(maskText(spaced, scanText(spaced, defaults).spans), 'id [Resident registration number (KR)] ok');
  });
});

describe('masking', () => {
  it('replaces each finding with the name of its rule', () => {
    const text = 'call 010-1234-5678 or mail kim@example.com';
    const { spans } = scanText(text, all);
    assert.equal(maskText(text, spans), 'call [Mobile phone number (KR)] or mail [E-mail address]');
    assert.equal(maskText(text, spans, (rule) => rule.nameKo), 'call [휴대전화번호] or mail [이메일 주소]');
  });

  it('covers overlapping findings once and leaves nothing of them behind', () => {
    const text = 'password: 010-1234-5678 end';
    const { spans, findings } = scanText(text, all);
    assert.equal(findings.length, 2);
    const masked = maskText(text, spans);
    assert.equal(masked, '[Password written out] end');
    assert.equal(scanText(masked, all).action, 'allow', 'the masked text passes the same rules');
  });
});
